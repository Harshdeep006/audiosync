import express from 'express';
import http from 'http';
import path from 'path';
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
  };
  queue: AudioTrackServer[];
  settings: {
    autoSyncEnabled: boolean;
    maxAllowedDriftMs: number;
    bufferDurationMs: number;
    allowParticipantControl: boolean;
  };
}

const DEFAULT_TRACKS: AudioTrackServer[] = [
  {
    id: 'track-1',
    title: 'Neon Horizon (Synthesized Electro)',
    artist: 'AudioSync Engine',
    album: 'Distributed Sound Vol. 1',
    duration: 180,
    coverUrl: 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80',
    audioUrl: '/api/audio/synth-groove.mp3',
    genre: 'Electronic'
  },
  {
    id: 'track-2',
    title: 'Midnight Bass Drive',
    artist: 'Cyber Pulse',
    album: 'Frequency Spectrum',
    duration: 210,
    coverUrl: 'https://images.unsplash.com/photo-1514525253161-7a46d19cd819?auto=format&fit=crop&w=600&q=80',
    audioUrl: '/api/audio/bass-pulse.mp3',
    genre: 'Synthwave'
  },
  {
    id: 'track-3',
    title: 'Acoustic Waves & Harmonics',
    artist: 'Spatial Audio Collective',
    album: 'Multi-Channel Acoustic',
    duration: 195,
    coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80',
    audioUrl: '/api/audio/chill-ambient.mp3',
    genre: 'Ambient'
  }
];

const rooms = new Map<string, RoomServer>();
const clients = new Map<string, ClientConnection>();

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

  app.get('/api/health', (_req, res) => {
    res.json({
      status: 'ok',
      activeRooms: rooms.size,
      connectedClients: clients.size,
      serverTime: Date.now()
    });
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

    const participantList = Array.from(room.participants.values());
    const payload = {
      code: room.code,
      name: room.name,
      hostId: room.hostId,
      createdAt: room.createdAt,
      participants: participantList,
      playback: room.playback,
      queue: room.queue,
      settings: room.settings
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
              serverTime: Date.now()
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
              playbackRate: 1.0
            },
            queue: [...DEFAULT_TRACKS],
            settings: {
              autoSyncEnabled: true,
              maxAllowedDriftMs: 15,
              bufferDurationMs: 1500,
              allowParticipantControl: false
            }
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
          const currentServerTime = Date.now();
          const bufferDelayMs = room.settings.bufferDurationMs || 1500;

          if (action === 'PLAY') {
            room.playback.isPlaying = true;
            room.playback.startPositionOffset = position !== undefined ? position : room.playback.position;
            room.playback.serverScheduledTimestamp = currentServerTime + bufferDelayMs;
            room.playback.position = room.playback.startPositionOffset;
          } else if (action === 'PAUSE') {
            // Calculate elapsed audio position before pausing
            if (room.playback.isPlaying && room.playback.serverScheduledTimestamp > 0) {
              const elapsedSec = Math.max(0, (currentServerTime - room.playback.serverScheduledTimestamp) / 1000);
              room.playback.position = room.playback.startPositionOffset + elapsedSec;
            }
            room.playback.isPlaying = false;
            room.playback.serverScheduledTimestamp = 0;
          } else if (action === 'SEEK') {
            const seekPos = position || 0;
            room.playback.startPositionOffset = seekPos;
            room.playback.position = seekPos;
            if (room.playback.isPlaying) {
              room.playback.serverScheduledTimestamp = currentServerTime + bufferDelayMs;
            }
          } else if (action === 'CHANGE_TRACK') {
            if (track) {
              room.playback.track = track;
              room.playback.startPositionOffset = 0;
              room.playback.position = 0;
              room.playback.isPlaying = true;
              room.playback.serverScheduledTimestamp = currentServerTime + bufferDelayMs;
            }
          }

          if (playbackRate !== undefined) {
            room.playback.playbackRate = playbackRate;
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

          const p = room.participants.get(clientId);
          if (p) {
            if (payload.channelRole) p.channelRole = payload.channelRole;
            if (payload.volume !== undefined) p.volume = payload.volume;
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
          if (room.participants.size === 0) {
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
  });
}

startServer();
