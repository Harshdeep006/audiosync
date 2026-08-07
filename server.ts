import express from 'express';
import http from 'http';
import path from 'path';
import os from 'os';
import { WebSocketServer, WebSocket } from 'ws';
import { createServer as createViteServer } from 'vite';

interface ClientConnection {
  ws: WebSocket;
  id: string;
  roomCode: string | null;
  name: string;
  role: 'host' | 'participant';
}

interface AudioTrackServer {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number;
  coverUrl: string;
  audioUrl: string;
  genre: string;
}

interface RoomServer {
  code: string;
  name: string;
  hostId: string;
  createdAt: number;
  participants: Map<string, {
    id: string;
    name: string;
    role: 'host' | 'participant';
    channelRole: string;
    rttMs: number;
    clockOffsetMs: number;
    isSynced: boolean;
    isBuffering: boolean;
    clientCompensationMs?: number;
    clientNudgeMs?: number;
    volume: number;
    deviceType: string;
    joinedAt: number;
  }>;
  playback: {
    track: AudioTrackServer | null;
    isPlaying: boolean;
    position: number;
    serverScheduledTimestamp: number;
    startPositionOffset: number;
    playbackRate: number;
    // "Prepare" phase: a track everyone must confirm they've fully downloaded
    // and decoded before we commit to a synchronized start time. Nobody
    // starts playing anything on a guess about how long that should take.
    pendingTrack: AudioTrackServer | null;
    pendingStartPositionOffset: number;
  };
  queue: AudioTrackServer[];
  settings: {
    autoSyncEnabled: boolean;
    maxAllowedDriftMs: number;
    bufferDurationMs: number;
    allowParticipantControl: boolean;
  };
  // Server-only bookkeeping for the readiness barrier — never sent to clients
  // directly; only a derived ready/total count is included in broadcasts.
  pendingReadyClientIds: Set<string>;
  pendingReadyTimeout: NodeJS.Timeout | null;
}

const DEFAULT_TRACKS: AudioTrackServer[] = [
  {
    id: 'track-1',
    title: 'Joy',
    artist: 'BeatsNecker',
    album: 'BeatsNecker Originals',
    duration: 32,
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
    audioUrl: '/audio/joy.mp3',
    genre: 'Instrumental'
  },
  {
    id: 'track-2',
    title: 'Me',
    artist: 'BeatsNecker',
    album: 'BeatsNecker Originals',
    duration: 27,
    coverUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80',
    audioUrl: '/audio/me.mp3',
    genre: 'Instrumental'
  },
  {
    id: 'track-3',
    title: 'Pure Heart',
    artist: 'BeatsNecker',
    album: 'BeatsNecker Originals',
    duration: 34,
    coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80',
    audioUrl: '/audio/pure-heart.mp3',
    genre: 'Instrumental'
  },
  {
    id: 'track-4',
    title: 'Those Eyes',
    artist: 'BeatsNecker',
    album: 'BeatsNecker Originals',
    duration: 40,
    coverUrl: 'https://images.unsplash.com/photo-1493225457124-a3eb161ffa5f?auto=format&fit=crop&w=600&q=80',
    audioUrl: '/audio/those-eyes.mp3',
    genre: 'Instrumental'
  }
];

const rooms = new Map<string, RoomServer>();
const clients = new Map<string, ClientConnection>();
const uploadedAudioFiles = new Map<string, { data: Buffer; contentType: string }>();

// Date.now() only guarantees millisecond resolution, and on some systems
// (older Windows timer defaults especially) can be quantized far coarser
// than that in practice. process.hrtime is a high-resolution monotonic
// clock but isn't wall-clock-anchored by itself, so we capture one Date.now()
// reading alongside an hrtime reading once at startup, then use the
// monotonic clock's fine-grained ticking relative to that anchor for every
// subsequent "current wall time" read — giving sub-millisecond precision
// server timestamps for the one thing that actually benefits from it: the
// value each client's clock-offset calculation is measured against.
const serverTimeAnchorDateMs = Date.now();
const serverTimeAnchorHrtimeNs = process.hrtime.bigint();

function getHighResServerTime(): number {
  const elapsedNs = process.hrtime.bigint() - serverTimeAnchorHrtimeNs;
  return serverTimeAnchorDateMs + Number(elapsedNs) / 1e6;
}

// Once every device has confirmed it's fully buffered, the only remaining
// question is how much lead time the final "start now" message itself needs
// to reliably arrive everywhere before the target instant. A fixed constant
// either wastes time on a fast LAN or risks being too tight on a slow one —
// sizing it from each room's actual currently-measured round trips lets a
// hotspot/LAN session commit almost immediately while a slower internet
// session still gets a safe margin, automatically, with no manual mode switch.
function computeCommitLeadMs(room: RoomServer): number {
  const observedRtts = Array.from(room.participants.values())
    .map((p) => p.rttMs)
    .filter((rtt) => rtt > 0);
  const worstRtt = observedRtts.length > 0 ? Math.max(...observedRtts) : 150;
  
  // Calculate dynamic scheduling delay based on max RTT
  const dynamicDelay = Math.max(400, worstRtt * 1.5 + 200);
  const baseDelayMs = Math.min(dynamicDelay, 3000);

  // Get max compensation (output latency + manual nudge) across all clients
  const maxCompensation = Math.max(0, ...Array.from(room.participants.values()).map(p => 
    (p.clientCompensationMs || 0) + (p.clientNudgeMs || 0)
  ));
  
  // Ensure enough headroom for the client with the largest local compensation
  return Math.max(baseDelayMs, maxCompensation + 200);
}

function getLocalNetworkAddresses(): string[] {
  const interfaces = os.networkInterfaces();
  const addresses: string[] = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] || []) {
      // IPv4, non-internal (skips 127.0.0.1) — these are the addresses other
      // devices on the same WiFi/LAN can actually reach this machine at.
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

function generateRoomCode(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
}

async function startServer() {
  const app = express();
  const PORT = Number(process.env.PORT) || 3000;
  const server = http.createServer(app);

  app.use(express.json());

  // API endpoints
  app.get('/api/tracks', (_req, res) => {
    res.json(DEFAULT_TRACKS);
  });

  // Lets the frontend show "guests on your WiFi can join at ..." when this
  // server is being run locally (e.g. on a host's own laptop) rather than
  // deployed to a public host like Render — same code, either way.
  app.get('/api/local-network-info', (req, res) => {
    const addresses = getLocalNetworkAddresses();
    res.json({
      addresses,
      port: PORT,
      isLikelyLocal: req.hostname === 'localhost' || addresses.includes(req.hostname)
    });
  });

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      activeRooms: rooms.size,
      connectedClients: clients.size,
      serverTime: Date.now()
    });
  });

  // Accept a custom-uploaded audio file and store it in memory so every
  // connected device (not just the uploader) can fetch it back over the network.
  app.post('/api/upload', express.raw({ type: '*/*', limit: '25mb' }), (req, res) => {
    if (!req.body || !(req.body instanceof Buffer) || req.body.length === 0) {
      res.status(400).json({ message: 'No file data received.' });
      return;
    }

    const id = 'upload_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8);
    const contentType = req.headers['content-type']?.toString() || 'audio/mpeg';
    uploadedAudioFiles.set(id, { data: req.body, contentType });

    res.json({ id, url: `/api/uploads/${id}` });
  });

  app.get('/api/uploads/:id', (req, res) => {
    const file = uploadedAudioFiles.get(req.params.id);
    if (!file) {
      res.status(404).send('Upload not found — it may have been cleared by a server restart.');
      return;
    }

    res.setHeader('Content-Type', file.contentType);
    res.setHeader('Content-Length', file.data.length.toString());
    res.setHeader('Accept-Ranges', 'bytes');
    res.send(file.data);
  });

  // Simple WAV audio generator for synthetic test tracks if requested
  app.get('/api/audio/:filename', (req, res) => {
    // Generate a simple PCM WAV audio response dynamically so playback works out-of-the-box
    const sampleRate = 44100;
    const duration = 180; // 3 minutes
    const numSamples = sampleRate * duration;
    const dataSize = numSamples * 2 * 2; // 16-bit stereo
    const headerSize = 44;
    const totalSize = headerSize + dataSize;
    
    const buffer = Buffer.alloc(headerSize);
    
    // RIFF header
    buffer.write('RIFF', 0);
    buffer.writeUInt32LE(totalSize - 8, 4);
    buffer.write('WAVE', 8);
    buffer.write('fmt ', 12);
    buffer.writeUInt32LE(16, 16); // PCM chunk size
    buffer.writeUInt16LE(1, 20);  // Format PCM
    buffer.writeUInt16LE(2, 22);  // Channels (2)
    buffer.writeUInt32LE(sampleRate, 24);
    buffer.writeUInt32LE(sampleRate * 4, 28); // Byte rate
    buffer.writeUInt16LE(4, 32);  // Block align
    buffer.writeUInt16LE(16, 34); // Bits per sample
    buffer.write('data', 36);
    buffer.writeUInt32LE(dataSize, 40);

    res.setHeader('Content-Type', 'audio/wav');
    res.setHeader('Content-Length', totalSize.toString());
    res.setHeader('Accept-Ranges', 'bytes');
    
    res.write(buffer);

    // Stream tone & synth melody buffer chunks
    const chunkSize = 4096;
    let sampleOffset = 0;

    const streamInterval = setInterval(() => {
      if (sampleOffset >= numSamples) {
        clearInterval(streamInterval);
        res.end();
        return;
      }

      const chunkSamples = Math.min(chunkSize, numSamples - sampleOffset);
      const chunkBuffer = Buffer.alloc(chunkSamples * 4);

      for (let i = 0; i < chunkSamples; i++) {
        const currentSample = sampleOffset + i;
        const t = currentSample / sampleRate;

        // Base frequency sequence based on requested filename
        let baseFreq = 220; // A3
        if (req.params.filename.includes('bass')) baseFreq = 110;
        if (req.params.filename.includes('chill')) baseFreq = 165;

        // Simple chord progression synth melody
        const noteIndex = Math.floor(t * 2) % 4;
        const scale = [1, 1.25, 1.5, 1.875]; // Major chord ratios
        const freq = baseFreq * scale[noteIndex];

        // Beat kick & snare synthesis
        const beatT = t % 0.5;
        const kick = Math.sin(2 * Math.PI * 60 * (1 - beatT * 2)) * Math.exp(-beatT * 10);
        
        // Synth melody sine wave with subtle chord harmonic
        const synth = Math.sin(2 * Math.PI * freq * t) * 0.3 + Math.sin(2 * Math.PI * freq * 2 * t) * 0.1;

        // Combine
        let leftSample = Math.max(-1, Math.min(1, synth + kick * 0.4));
        let rightSample = Math.max(-1, Math.min(1, synth * 0.8 + kick * 0.4));

        const leftInt = Math.floor(leftSample * 32767);
        const rightInt = Math.floor(rightSample * 32767);

        chunkBuffer.writeInt16LE(leftInt, i * 4);
        chunkBuffer.writeInt16LE(rightInt, i * 4 + 2);
      }

      sampleOffset += chunkSamples;
      res.write(chunkBuffer);
    }, 10);

    req.on('close', () => {
      clearInterval(streamInterval);
    });
  });

  // WebSocket Server Setup attached to HTTP server
  const wss = new WebSocketServer({ server });

  function broadcastRoomState(roomCode: string) {
    const room = rooms.get(roomCode);
    if (!room) return;

    const participantsById: Record<string, any> = {};
    room.participants.forEach((p, id) => {
      participantsById[id] = p;
    });

    const payload = {
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      createdAt: room.createdAt,
      participants: participantsById,
      playback: room.playback,
      queue: room.queue,
      settings: room.settings,
      readiness: {
        readyCount: room.pendingReadyClientIds.size,
        totalCount: room.participants.size
      }
    };

    const messageStr = JSON.stringify({
      type: 'ROOM_STATE_UPDATE',
      payload,
      timestamp: Date.now()
    });

    clients.forEach((client) => {
      if (client.roomCode === roomCode && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(messageStr);
      }
    });
  }

  wss.on('connection', (ws: WebSocket) => {
    const clientId = 'client_' + Math.random().toString(36).substring(2, 10);
    const connection: ClientConnection = {
      ws,
      id: clientId,
      roomCode: null,
      name: 'User ' + clientId.substring(7),
      role: 'participant'
    };

    clients.set(clientId, connection);

    ws.on('message', (data: string) => {
      try {
        const msg = JSON.parse(data.toString());
        const { type, payload } = msg;

        // 1. Clock Sync Ping/Pong
        if (type === 'CLOCK_PING') {
          ws.send(JSON.stringify({
            type: 'CLOCK_PONG',
            payload: {
              clientSendTime: payload.clientSendTime,
              serverTime: getHighResServerTime()
            },
            timestamp: Date.now()
          }));
          return;
        }

        // 2. Create Room
        if (type === 'CREATE_ROOM') {
          let code = generateRoomCode();
          while (rooms.has(code)) {
            code = generateRoomCode();
          }

          const userName = payload.userName || 'Host Device';
          connection.name = userName;
          connection.role = 'host';
          connection.roomCode = code;

          const newRoom: RoomServer = {
            code,
            name: payload.roomName || `${userName}'s Party`,
            hostId: clientId,
            createdAt: Date.now(),
            participants: new Map(),
            playback: {
              track: DEFAULT_TRACKS[0],
              isPlaying: false,
              position: 0,
              serverScheduledTimestamp: 0,
              startPositionOffset: 0,
              playbackRate: 1.0,
              pendingTrack: null,
              pendingStartPositionOffset: 0
            },
            queue: [...DEFAULT_TRACKS],
            settings: {
              autoSyncEnabled: true,
              maxAllowedDriftMs: 15,
              bufferDurationMs: 4500,
              allowParticipantControl: false
            },
            pendingReadyClientIds: new Set(),
            pendingReadyTimeout: null
          };

          newRoom.participants.set(clientId, {
            id: clientId,
            name: userName,
            role: 'host',
            channelRole: payload.channelRole || 'full',
            rttMs: 0,
            clockOffsetMs: 0,
            isSynced: true,
            isBuffering: false,
            volume: 1.0,
            deviceType: payload.deviceType || 'mobile',
            joinedAt: Date.now()
          });

          rooms.set(code, newRoom);

          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            payload: {
              roomCode: code,
              clientId,
              role: 'host'
            },
            timestamp: Date.now()
          }));

          broadcastRoomState(code);
          return;
        }

        // 3. Join Room
        if (type === 'JOIN_ROOM') {
          const roomCode = (payload.roomCode || '').toUpperCase().trim();
          const room = rooms.get(roomCode);

          if (!room) {
            ws.send(JSON.stringify({
              type: 'ERROR',
              payload: { message: `Room ${roomCode} not found. Check the room code.` }
            }));
            return;
          }

          const userName = payload.userName || 'Device ' + Math.floor(Math.random() * 100);
          connection.name = userName;
          connection.role = 'participant';
          connection.roomCode = roomCode;

          room.participants.set(clientId, {
            id: clientId,
            name: userName,
            role: 'participant',
            channelRole: payload.channelRole || 'full',
            rttMs: payload.rttMs || 0,
            clockOffsetMs: payload.clockOffsetMs || 0,
            isSynced: true,
            isBuffering: false,
            volume: 1.0,
            deviceType: payload.deviceType || 'mobile',
            joinedAt: Date.now()
          });

          ws.send(JSON.stringify({
            type: 'ROOM_JOINED',
            payload: {
              roomCode,
              clientId,
              role: 'participant'
            },
            timestamp: Date.now()
          }));

          broadcastRoomState(roomCode);
          return;
        }

        // 4. Playback Commands (Play, Pause, Seek, Track Change)
        if (type === 'PLAYBACK_COMMAND') {
          const roomCode = connection.roomCode;
          if (!roomCode) return;
          const room = rooms.get(roomCode);
          if (!room) return;

          // Check permissions: host or allowParticipantControl
          if (connection.role !== 'host' && !room.settings.allowParticipantControl) {
            ws.send(JSON.stringify({
              type: 'ERROR',
              payload: { message: 'Only the host can control playback.' }
            }));
            return;
          }

          const { action, track, position, playbackRate } = payload;
          const currentServerTime = getHighResServerTime();

          // Commits a prepared track to an actual synchronized start time —
          // called once every device has confirmed it's fully buffered, or
          // the safety timeout fires and we proceed without stragglers.
          const commitPendingPlayback = (rc: string) => {
            const r = rooms.get(rc);
            if (!r || !r.playback.pendingTrack) return;
            if (r.pendingReadyTimeout) {
              clearTimeout(r.pendingReadyTimeout);
              r.pendingReadyTimeout = null;
            }
            r.playback.track = r.playback.pendingTrack;
            r.playback.startPositionOffset = r.playback.pendingStartPositionOffset;
            r.playback.position = r.playback.pendingStartPositionOffset;
            r.playback.isPlaying = true;
            // Everyone confirmed ready (or we gave up waiting), so the only
            // remaining lead time needed is for this message itself to
            // arrive — sized to actual measured conditions in this room,
            // not a one-size-fits-all guess.
            r.playback.serverScheduledTimestamp = getHighResServerTime() + computeCommitLeadMs(r);
            r.playback.pendingTrack = null;
            r.pendingReadyClientIds.clear();
            broadcastRoomState(rc);
          };

          // Starts the prepare phase: broadcasts the pending track so every
          // client begins downloading/decoding it, and waits for everyone to
          // report PLAYBACK_READY before actually scheduling a start time.
          const beginPreparePhase = (newTrack: any, startPosSec: number) => {
            if (room.pendingReadyTimeout) {
              clearTimeout(room.pendingReadyTimeout);
            }
            room.playback.pendingTrack = newTrack;
            room.playback.pendingStartPositionOffset = startPosSec;
            room.playback.isPlaying = false;
            room.playback.serverScheduledTimestamp = 0;
            room.pendingReadyClientIds.clear();

            room.pendingReadyTimeout = setTimeout(() => {
              commitPendingPlayback(roomCode);
            }, 12000); // safety net — don't let one stuck device hold up the room forever

            broadcastRoomState(roomCode);
          };

          if (action === 'PLAY') {
            const startPos = position !== undefined ? position : room.playback.position;
            beginPreparePhase(room.playback.track, startPos);
          } else if (action === 'PAUSE') {
            // Calculate elapsed audio position before pausing
            if (room.playback.isPlaying && room.playback.serverScheduledTimestamp > 0) {
              const elapsedSec = Math.max(0, (currentServerTime - room.playback.serverScheduledTimestamp) / 1000);
              room.playback.position = room.playback.startPositionOffset + elapsedSec;
            }
            room.playback.isPlaying = false;
            room.playback.serverScheduledTimestamp = 0;
            if (room.pendingReadyTimeout) {
              clearTimeout(room.pendingReadyTimeout);
              room.pendingReadyTimeout = null;
            }
            room.playback.pendingTrack = null;
            room.pendingReadyClientIds.clear();
          } else if (action === 'SEEK') {
            // Track is already loaded on every device by this point (it's
            // already playing) — no re-download needed, so this only needs
            // the same short adaptive lead time as any other commit, not
            // the full track-buffering allowance.
            const seekPos = position || 0;
            room.playback.startPositionOffset = seekPos;
            room.playback.position = seekPos;
            if (room.playback.isPlaying) {
              room.playback.serverScheduledTimestamp = getHighResServerTime() + computeCommitLeadMs(room);
            }
          } else if (action === 'CHANGE_TRACK') {
            if (track) {
              beginPreparePhase(track, 0);
            }
          }

          if (playbackRate !== undefined) {
            room.playback.playbackRate = playbackRate;
          }

          broadcastRoomState(roomCode);
          return;
        }

        // 4b. A client confirms it has fully downloaded and decoded the
        // pending track and is ready for the synchronized start to be
        // scheduled.
        if (type === 'PLAYBACK_READY') {
          const roomCode = connection.roomCode;
          if (!roomCode) return;
          const room = rooms.get(roomCode);
          if (!room || !room.playback.pendingTrack) return;

          room.pendingReadyClientIds.add(clientId);

          if (room.pendingReadyClientIds.size >= room.participants.size) {
            if (room.pendingReadyTimeout) {
              clearTimeout(room.pendingReadyTimeout);
              room.pendingReadyTimeout = null;
            }
            room.playback.track = room.playback.pendingTrack;
            room.playback.startPositionOffset = room.playback.pendingStartPositionOffset;
            room.playback.position = room.playback.pendingStartPositionOffset;
            room.playback.isPlaying = true;
            room.playback.serverScheduledTimestamp = getHighResServerTime() + computeCommitLeadMs(room);
            room.playback.pendingTrack = null;
            room.pendingReadyClientIds.clear();
          }

          broadcastRoomState(roomCode);
          return;
        }

        // 5. Role or Channel Update
        if (type === 'ROLE_UPDATE') {
          const roomCode = connection.roomCode;
          if (!roomCode) return;
          const room = rooms.get(roomCode);
          if (!room) return;

          const isSenderHost = room.hostId === clientId;
          const targetId = (payload.targetClientId && isSenderHost) ? payload.targetClientId : clientId;

          const p = room.participants.get(targetId);
          if (p) {
            if (payload.channelRole) p.channelRole = payload.channelRole;
            if (payload.volume !== undefined && targetId === clientId) p.volume = payload.volume;
            broadcastRoomState(roomCode);
          }
          return;
        }

        // 6. Latency & Diagnostics Report from client
        if (type === 'LATENCY_REPORT') {
          const roomCode = connection.roomCode;
          if (!roomCode) return;
          const room = rooms.get(roomCode);
          if (!room) return;

          const p = room.participants.get(clientId);
          if (p) {
            p.rttMs = payload.rttMs || 0;
            p.clockOffsetMs = payload.clockOffsetMs || 0;
            p.isSynced = Math.abs(p.clockOffsetMs) <= room.settings.maxAllowedDriftMs;
            p.isBuffering = payload.isBuffering || false;
            p.clientCompensationMs = payload.clientCompensationMs;
            p.clientNudgeMs = payload.clientNudgeMs;
            broadcastRoomState(roomCode);
          }
          return;
        }

        // 7. Queue Update
        if (type === 'QUEUE_UPDATE') {
          const roomCode = connection.roomCode;
          if (!roomCode) return;
          const room = rooms.get(roomCode);
          if (!room) return;

          if (payload.queue) {
            room.queue = payload.queue;
            broadcastRoomState(roomCode);
          }
          return;
        }

      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    });

    ws.on('close', () => {
      const roomCode = connection.roomCode;
      clients.delete(clientId);

      if (roomCode) {
        const room = rooms.get(roomCode);
        if (room) {
          room.participants.delete(clientId);
          room.pendingReadyClientIds.delete(clientId);
          if (room.participants.size === 0) {
            if (room.pendingReadyTimeout) clearTimeout(room.pendingReadyTimeout);
            rooms.delete(roomCode);
          } else {
            // If host left, assign new host
            if (room.hostId === clientId) {
              const nextHost = Array.from(room.participants.values())[0];
              if (nextHost) {
                room.hostId = nextHost.id;
                nextHost.role = 'host';
                const nextClient = clients.get(nextHost.id);
                if (nextClient) nextClient.role = 'host';
              }
            }
            // If everyone remaining is now ready (the person we were still
            // waiting on just left), don't leave the room stuck waiting.
            if (room.playback.pendingTrack && room.pendingReadyClientIds.size >= room.participants.size) {
              if (room.pendingReadyTimeout) {
                clearTimeout(room.pendingReadyTimeout);
                room.pendingReadyTimeout = null;
              }
              room.playback.track = room.playback.pendingTrack;
              room.playback.startPositionOffset = room.playback.pendingStartPositionOffset;
              room.playback.position = room.playback.pendingStartPositionOffset;
              room.playback.isPlaying = true;
              room.playback.serverScheduledTimestamp = getHighResServerTime() + computeCommitLeadMs(room);
              room.playback.pendingTrack = null;
              room.pendingReadyClientIds.clear();
            }
            broadcastRoomState(roomCode);
          }
        }
      }
    });
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa'
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.log(`AudioSync full-stack server running on http://0.0.0.0:${PORT}`);
    const lanAddresses = getLocalNetworkAddresses();
    if (lanAddresses.length > 0) {
      console.log('Devices on your WiFi/LAN can join at:');
      lanAddresses.forEach((addr) => console.log(`  http://${addr}:${PORT}`));
    }
  });
}

startServer();
