import { audioEngine } from './audioEngine';
import { ClockSyncResult, Room, WSMessage, WSMessageType } from '../types';

type MessageHandler = (msg: WSMessage) => void;

// ---------------------------------------------------------------------------
// Exported server-clock offset (NTP-style Cristian's Algorithm)
//
// `serverOffset` is updated every time a ping_offset round-trip completes.
// Usage: const serverNow = Date.now() + serverOffset;
// ---------------------------------------------------------------------------
export let serverOffset: number = 0;

// Expose a getter so audioEngine (imported before first sync completes) always
// reads the live value without capturing a stale copy.
export function getServerOffset(): number {
  return serverOffset;
}

class SocketClient {
  private ws: WebSocket | null = null;
  private listeners: Set<MessageHandler> = new Set();
  private pingIntervalId: any = null;
  private latencyReportIntervalId: any = null;
  private isConnected: boolean = false;
  private roomCode: string | null = null;
  private myClientId: string | null = null;

  // Track pending ping_offset requests (clientSendTime keyed by sequence id)
  private pendingPingOffsets: Map<number, number> = new Map();
  private pingOffsetSeq: number = 0;

  constructor() {
    // Lazy initialization — connect() must be called explicitly
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
        // Run an initial rapid burst of syncClock() calls for fast calibration
        for (let i = 0; i < 5; i++) {
          setTimeout(() => this.syncClock(), i * 150);
        }
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

  // -------------------------------------------------------------------------
  // syncClock() — NTP-style ping_offset / pong_offset round-trip
  //
  // Emits a `ping_offset` message containing the client's current timestamp
  // and a sequence ID so multiple in-flight pings can be tracked independently.
  // When the server's `pong_offset` arrives, the RTT is measured and the
  // Cristian's Algorithm clock offset is calculated:
  //
  //   clockOffset = (serverTime + rtt/2) - clientReceiveTime
  //
  // The result is averaged into `serverOffset` using an exponential moving
  // average (α = 0.15) so occasional outliers don't cause jarring jumps.
  // -------------------------------------------------------------------------
  public syncClock(): void {
    if (!this.isConnected || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;

    const seq = ++this.pingOffsetSeq;
    const clientSendTime = Date.now();
    this.pendingPingOffsets.set(seq, clientSendTime);

    // Prune any pings that never received a response (> 5 s old) to avoid leaks
    const staleThreshold = clientSendTime - 5000;
    this.pendingPingOffsets.forEach((sendTime, key) => {
      if (sendTime < staleThreshold) this.pendingPingOffsets.delete(key);
    });

    this.ws.send(
      JSON.stringify({
        type: 'ping_offset',
        payload: { seq, clientSendTime },
        timestamp: clientSendTime
      })
    );
  }

  // Handle the pong_offset response from the server
  private handlePongOffset(payload: { seq: number; serverTime: number }): void {
    const clientReceiveTime = Date.now();
    const { seq, serverTime } = payload;

    const clientSendTime = this.pendingPingOffsets.get(seq);
    if (clientSendTime === undefined) return; // Unknown or already pruned
    this.pendingPingOffsets.delete(seq);

    const rttMs = clientReceiveTime - clientSendTime;
    // Cristian's Algorithm: best estimate of server time at receive moment
    const estimatedServerTimeAtReceive = serverTime + rttMs / 2;
    const measuredOffset = estimatedServerTimeAtReceive - clientReceiveTime;

    // Exponential Moving Average — down-weight outliers while staying responsive
    const alpha = 0.15;
    serverOffset = serverOffset === 0
      ? measuredOffset                            // First sample: seed directly
      : serverOffset + alpha * (measuredOffset - serverOffset);

    // Also feed the existing audioEngine NTP pipeline for drift correction
    const sample: ClockSyncResult = {
      clientSendTime,
      serverTime,
      clientReceiveTime,
      rttMs,
      clockOffsetMs: measuredOffset
    };
    audioEngine.recordClockMeasurement(sample);
  }

  private handleIncomingMessage(msg: WSMessage): void {
    const { type, payload } = msg;

    // ---- New "Play At" scheduling event ----
    if (type === 'pong_offset') {
      this.handlePongOffset(payload);
      return;
    }

    // ---- Legacy NTP clock sync (kept for backward compat & audioEngine) ----
    if (type === 'CLOCK_PONG') {
      const clientReceiveTime = Date.now();
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

    // Initial rapid burst of 5 CLOCK_PINGs for immediate audioEngine calibration
    for (let i = 0; i < 5; i++) {
      setTimeout(() => this.sendClockPing(), i * 150);
    }

    // Continuous NTP clock alignment every 2.5 seconds (legacy CLOCK_PING)
    this.pingIntervalId = setInterval(() => {
      this.sendClockPing();
      // Also refresh the ping_offset path on the same cadence
      this.syncClock();
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

  public getRoomCode(): string | null {
    return this.roomCode;
  }
}

export const socketClient = new SocketClient();
