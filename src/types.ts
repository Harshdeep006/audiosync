export type RoomRole = 'host' | 'participant';

export type AudioChannelRole = 
  | 'full' 
  | 'left' 
  | 'right' 
  | 'bass' 
  | 'vocals' 
  | 'treble' 
  | 'ambient';

export interface Participant {
  id: string;
  name: string;
  role: RoomRole;
  channelRole: AudioChannelRole;
  rttMs: number;
  clockOffsetMs: number;
  isSynced: boolean;
  isBuffering: boolean;
  batteryLevel?: number;
  volume: number;
  deviceType: 'mobile' | 'desktop' | 'tablet';
  joinedAt: number;
}

export interface AudioTrack {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number; // in seconds
  coverUrl: string;
  audioUrl: string;
  genre: string;
  isCustom?: boolean;
}

export interface PlaybackState {
  track: AudioTrack | null;
  isPlaying: boolean;
  position: number; // current audio time in seconds
  serverScheduledTimestamp: number; // UTC timestamp (ms) on server when playback starts
  startPositionOffset: number; // position in track when playback started
  playbackRate: number;
}

export interface Room {
  code: string;
  name: string;
  hostId: string;
  createdAt: number;
  participants: Record<string, Participant>;
  playback: PlaybackState;
  queue: AudioTrack[];
  settings: {
    autoSyncEnabled: boolean;
    maxAllowedDriftMs: number;
    bufferDurationMs: number;
    allowParticipantControl: boolean;
  };
}

export interface ClockSyncResult {
  clientSendTime: number;
  serverTime: number;
  clientReceiveTime: number;
  rttMs: number;
  clockOffsetMs: number;
}

export type WSMessageType =
  | 'CLOCK_PING'
  | 'CLOCK_PONG'
  | 'CREATE_ROOM'
  | 'JOIN_ROOM'
  | 'ROOM_JOINED'
  | 'ROOM_STATE_UPDATE'
  | 'PLAYBACK_COMMAND'
  | 'ROLE_UPDATE'
  | 'LATENCY_REPORT'
  | 'QUEUE_UPDATE'
  | 'USER_LEFT'
  | 'ERROR'
  | 'CALIBRATE_REQUEST';

export interface WSMessage {
  type: WSMessageType;
  payload: any;
  timestamp?: number;
}

export interface PerformanceMetrics {
  ping: number;
  jitter: number;
  offset: number;
  driftRate: number;
  packetLoss: number;
  bufferHealthPct: number;
  audioContextState: AudioContextState;
}
