import { audioEngine } from './audioEngine';
import { ClockSyncResult, Room, WSMessage, WSMessageType } from '../types';

type MessageHandler = (msg: WSMessage) => void;

class SocketClient {
  private ws: WebSocket | null = null;
  private listeners: Set<MessageHandler> = new Set();
  private pingIntervalId: any = null;
  private latencyReportIntervalId: any = null;
  private isConnected: boolean = false;
  private roomCode: string | null = null;
  private myClientId: string | null = null;

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
        // Reconnect after 2 seconds
        setTimeout(() => this.connect(), 2000);
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
      // performance.now() is specified as sub-millisecond and monotonic,
      // where Date.now() is only guaranteed to millisecond resolution and
      // has historically been quantized much more coarsely on some systems
      // (Windows in particular, ~15.6ms ticks under default timer settings).
      // performance.timeOrigin + performance.now() gives the same
      // wall-clock-referenced value Date.now() would, at meaningfully finer
      // precision — directly tightening the input to the RTT/offset math.
      const clientReceiveTime = performance.timeOrigin + performance.now();
      const { clientSendTime, serverTime } = payload;
      const rttMs = clientReceiveTime - clientSendTime;
      // Cristian's algorithm: estimated server time when client receives = serverTime + (rtt / 2)
      // Clock Offset = (serverTime + rtt/2) - clientReceiveTime
      const estimatedServerTime = serverTime + rttMs / 2;
      const clockOffsetMs = estimatedServerTime - clientReceiveTime;

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

    // Initial rapid burst of 10 pings for fast first-pass calibration —
    // the very first pings after a fresh connection tend to be noisy
    // (TLS handshake overhead, a cold server waking up), so more samples
    // up front means outliers get outvoted quickly instead of lingering.
    for (let i = 0; i < 10; i++) {
      setTimeout(() => this.sendClockPing(), i * 200);
    }

    // Fast warm-up cadence for the first ~10 seconds while the offset is
    // still settling, then ease back to a lighter steady-state interval.
    let warmupPings = 0;
    const warmupIntervalId = setInterval(() => {
      this.sendClockPing();
      warmupPings++;
      if (warmupPings >= 12) {
        clearInterval(warmupIntervalId);
      }
    }, 800);

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
        clientSendTime: performance.timeOrigin + performance.now()
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

  public getRoomCode(): string | null {
    return this.roomCode;
  }
}

export const socketClient = new SocketClient();
