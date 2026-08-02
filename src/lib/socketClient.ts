import { audioEngine } from './audioEngine';
import { ClockSyncResult, WSMessage, WSMessageType } from '../types';

type MessageHandler = (msg: WSMessage) => void;

class SocketClient {
  private ws: WebSocket | null = null;
  private listeners: Set<MessageHandler> = new Set();
  private pingIntervalId: any = null;
  private latencyReportIntervalId: any = null;
  private isConnected: boolean = false;
  private roomCode: string | null = null;
  private myClientId: string | null = null;
  private reconnectAttempt: number = 0;
  
  // Keep recent RTTs for statistical outlier rejection (IQR)
  private recentRtts: number[] = [];

  constructor() {
    // Auto initialize socket on startup
  }

  public connect(): void {
    if (this.ws && (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING)) {
      return;
    }

    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const host = window.location.host;
    const wsUrl = `${protocol}//${host}`;

    try {
      this.ws = new WebSocket(wsUrl);

      this.ws.onopen = () => {
        this.isConnected = true;
        this.reconnectAttempt = 0;
        this.startClockSyncLoop();
        this.startLatencyReportingLoop();
      };

      this.ws.onmessage = (event: MessageEvent) => {
        try {
          const msg: WSMessage = JSON.parse(event.data);
          this.handleIncomingMessage(msg);
        } catch (err) {
          console.error('Failed to parse WS message:', err);
        }
      };

      this.ws.onclose = () => {
        this.isConnected = false;
        this.stopLoops();
        // Exponential backoff: 2s, 4s, 8s, 16s, capped at 30s
        const delay = Math.min(30000, 2000 * Math.pow(2, this.reconnectAttempt));
        this.reconnectAttempt++;
        setTimeout(() => this.connect(), delay);
      };

      this.ws.onerror = (err) => {
        console.error('WebSocket connection error:', err);
      };
    } catch (e) {
      console.error('Failed to instantiate WebSocket:', e);
    }
  }

  private handleIncomingMessage(msg: WSMessage): void {
    const { type, payload } = msg;

    if (type === 'CLOCK_PONG') {
      const clientReceiveTime = Date.now();
      const { clientSendTime, serverTime } = payload;
      const rttMs = clientReceiveTime - clientSendTime;
      // Cristian's algorithm: estimated server time when client receives = serverTime + (rtt / 2)
      // Clock Offset = (serverTime + rtt/2) - clientReceiveTime
      const estimatedServerTime = serverTime + rttMs / 2;
      const clockOffsetMs = estimatedServerTime - clientReceiveTime;

      // Statistical Outlier Rejection using Interquartile Range (IQR)
      // On the open internet, random routing hiccups can cause a ping to take
      // 500ms when the average is 50ms. If we let that into the clock model,
      // it skews the regression. We identify and drop these spikes entirely.
      this.recentRtts.push(rttMs);
      if (this.recentRtts.length > 20) {
        this.recentRtts.shift();
      }

      if (this.recentRtts.length >= 10) {
        const sorted = [...this.recentRtts].sort((a, b) => a - b);
        const q1 = sorted[Math.floor(sorted.length * 0.25)];
        const q3 = sorted[Math.floor(sorted.length * 0.75)];
        const iqr = q3 - q1;
        // Strict upper bound for latency spikes (1.5x IQR is standard)
        const upperBound = q3 + 1.5 * iqr;
        
        if (rttMs > upperBound && rttMs > 100) {
          // Reject this sample, it's a network lag spike
          return;
        }
      }

      const sample: ClockSyncResult = {
        clientSendTime,
        serverTime,
        clientReceiveTime,
        rttMs,
        clockOffsetMs
      };

      audioEngine.recordClockMeasurement(sample);
      return;
    }

    if (type === 'ROOM_JOINED') {
      this.roomCode = payload.roomCode;
      this.myClientId = payload.clientId;
    }

    // Forward message to active component listeners
    this.listeners.forEach((listener) => listener(msg));
  }

  private startClockSyncLoop(): void {
    if (this.pingIntervalId) clearInterval(this.pingIntervalId);

    // Initial rapid burst of 20 pings for fast first-pass calibration —
    // The Linear Regression model needs points to draw a line. A faster,
    // larger initial burst warms up the PID controller much faster.
    for (let i = 0; i < 20; i++) {
      setTimeout(() => this.sendClockPing(), i * 100);
    }

    // Fast warm-up cadence for the first ~15 seconds while the regression
    // settles, then ease back to a lighter steady-state interval.
    let warmupPings = 0;
    const warmupIntervalId = setInterval(() => {
      this.sendClockPing();
      warmupPings++;
      if (warmupPings >= 20) {
        clearInterval(warmupIntervalId);
      }
    }, 700);

    // Continuous NTP clock alignment every 2.5 seconds, ongoing
    this.pingIntervalId = setInterval(() => {
      this.sendClockPing();
    }, 2500);
  }

  private startLatencyReportingLoop(): void {
    if (this.latencyReportIntervalId) clearInterval(this.latencyReportIntervalId);

    this.latencyReportIntervalId = setInterval(() => {
      if (this.isConnected && this.roomCode) {
        this.send('LATENCY_REPORT', {
          rttMs: audioEngine.getSmoothedRTT(),
          clockOffsetMs: audioEngine.getSmoothedOffset(),
          audioDriftMs: audioEngine.getLastMeasuredDriftMs(),
          isBuffering: audioEngine.getIsLoadingTrack()
        });
      }
    }, 3000);
  }

  private stopLoops(): void {
    if (this.pingIntervalId) clearInterval(this.pingIntervalId);
    if (this.latencyReportIntervalId) clearInterval(this.latencyReportIntervalId);
  }

  public sendClockPing(): void {
    if (this.isConnected && this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.send('CLOCK_PING', {
        clientSendTime: Date.now()
      });
    }
  }

  public send(type: WSMessageType, payload: any): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type,
        payload,
        timestamp: Date.now()
      }));
    }
  }

  public subscribe(listener: MessageHandler): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public getIsConnected(): boolean {
    return this.isConnected;
  }

  public getMyClientId(): string | null {
    return this.myClientId;
  }

  public leaveRoom(): void {
    if (this.roomCode) {
      this.send('LEAVE_ROOM', { roomCode: this.roomCode });
      this.roomCode = null;
    }
  }

  public getRoomCode(): string | null {
    return this.roomCode;
  }
}

export const socketClient = new SocketClient();
