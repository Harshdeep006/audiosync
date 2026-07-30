import React, { useState } from 'react';
import { X, Cpu, Database, Server, Wifi, Terminal, Layers, Activity, FileText, Check } from 'lucide-react';

interface ArchitectureModalProps {
  isOpen: boolean;
  onClose: () => void;
  isDarkMode: boolean;
}

export const ArchitectureModal: React.FC<ArchitectureModalProps> = ({ isOpen, onClose, isDarkMode }) => {
  const [activeTab, setActiveTab] = useState<'arch' | 'ntp' | 'db' | 'ws' | 'docker'>('arch');
  const [copiedCode, setCopiedCode] = useState<string | null>(null);

  if (!isOpen) return null;

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedCode(id);
    setTimeout(() => setCopiedCode(null), 2000);
  };

  const subtle = isDarkMode ? 'text-zinc-500' : 'text-zinc-500';
  const box = isDarkMode ? 'bg-black/30 border-white/10' : 'bg-zinc-50 border-zinc-200';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className={`relative w-full max-w-3xl h-[85vh] flex flex-col rounded-xl border overflow-hidden ${
        isDarkMode ? 'bg-[#0e0e10] border-white/10 text-white' : 'bg-white border-zinc-200 text-zinc-900'
      }`}>

        <div className={`p-5 border-b flex items-center justify-between shrink-0 ${isDarkMode ? 'border-white/10' : 'border-zinc-200'}`}>
          <div className="flex items-center gap-3">
            <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
              isDarkMode ? 'bg-white/5 text-zinc-300' : 'bg-zinc-100 text-zinc-700'
            }`}>
              <Layers size={18} />
            </div>
            <div>
              <h3 className="text-base font-semibold tracking-tight">System architecture</h3>
              <p className={`text-xs ${subtle}`}>Distributed audio engineering & clock alignment</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className={`p-1.5 rounded-md transition ${
              isDarkMode ? 'text-zinc-500 hover:text-white hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'
            }`}
          >
            <X size={18} />
          </button>
        </div>

        <div className={`flex items-center gap-1 px-5 pt-2 border-b shrink-0 overflow-x-auto ${isDarkMode ? 'border-white/10' : 'border-zinc-200'}`}>
          {[
            { id: 'arch', label: 'Architecture', icon: Server },
            { id: 'ntp', label: 'Clock sync', icon: Cpu },
            { id: 'db', label: 'Database', icon: Database },
            { id: 'ws', label: 'WebSocket', icon: Wifi },
            { id: 'docker', label: 'Deployment', icon: Terminal },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3 py-2.5 text-xs font-medium border-b-2 transition whitespace-nowrap ${
                  active
                    ? (isDarkMode ? 'border-white text-white' : 'border-zinc-900 text-zinc-900')
                    : `border-transparent ${subtle} hover:text-zinc-300`
                }`}
              >
                <Icon size={14} />
                {tab.label}
              </button>
            );
          })}
        </div>

        <div className="p-5 overflow-y-auto flex-1 text-sm space-y-5">

          {activeTab === 'arch' && (
            <div className="space-y-5">
              <div className={`p-4 rounded-lg border ${box}`}>
                <h4 className="font-medium mb-1 flex items-center gap-2 text-sm">
                  <Activity size={15} /> Distributed audio engine topology
                </h4>
                <p className={`text-xs leading-relaxed ${subtle}`}>
                  AudioSync connects heterogeneous client devices through a central Node.js Express & WebSocket server, which acts as the authoritative clock source and playback scheduler.
                </p>
              </div>

              <div className={`p-4 rounded-lg border font-mono text-xs space-y-3 ${box}`}>
                <div className={`font-medium uppercase tracking-wide text-[11px] ${subtle}`}>System workflow</div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-center">
                  <div className={`p-3 rounded-lg border ${isDarkMode ? 'border-white/10 bg-white/[0.02]' : 'border-zinc-200 bg-white'}`}>
                    <p className="font-medium mb-1">Host device</p>
                    <p className={`text-[11px] ${subtle}`}>Chooses a track and triggers play; sends a command to the server.</p>
                  </div>
                  <div className={`p-3 rounded-lg border ${isDarkMode ? 'border-white/10 bg-white/[0.02]' : 'border-zinc-200 bg-white'}`}>
                    <p className="font-medium mb-1">WebSocket server</p>
                    <p className={`text-[11px] ${subtle}`}>Calculates a future scheduled timestamp for playback to start.</p>
                  </div>
                  <div className={`p-3 rounded-lg border ${isDarkMode ? 'border-white/10 bg-white/[0.02]' : 'border-zinc-200 bg-white'}`}>
                    <p className="font-medium mb-1">Participant speakers</p>
                    <p className={`text-[11px] ${subtle}`}>Pre-buffer audio and schedule playback at the exact target time.</p>
                  </div>
                </div>
              </div>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <div className={`p-4 rounded-lg border ${box}`}>
                  <h5 className="font-medium text-sm mb-2">Frontend</h5>
                  <ul className={`list-disc list-inside text-xs space-y-1.5 ${subtle}`}>
                    <li>React + TypeScript + Vite</li>
                    <li>Web Audio API (AudioContext, BiquadFilterNode)</li>
                    <li>Tailwind CSS</li>
                    <li>QR code generation via qrcode</li>
                  </ul>
                </div>
                <div className={`p-4 rounded-lg border ${box}`}>
                  <h5 className="font-medium text-sm mb-2">Backend & realtime</h5>
                  <ul className={`list-disc list-inside text-xs space-y-1.5 ${subtle}`}>
                    <li>Node.js + Express HTTP API</li>
                    <li>WebSocket server (ws)</li>
                    <li>In-memory room state</li>
                    <li>Synthetic audio streaming API</li>
                  </ul>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'ntp' && (
            <div className="space-y-5">
              <div className={`p-4 rounded-lg border ${box}`}>
                <h4 className="font-medium mb-1 text-sm">Clock alignment & drift compensation</h4>
                <p className={`text-xs leading-relaxed ${subtle}`}>
                  To sync across devices with unsynchronized clocks, AudioSync runs a continuous WebSocket timestamp exchange.
                </p>
              </div>

              <div className={`p-4 rounded-lg border font-mono text-xs space-y-3 ${box}`}>
                <p className="font-medium">1. Network round-trip time (RTT)</p>
                <div className={`p-2.5 rounded-md border ${isDarkMode ? 'border-white/10 bg-black/30' : 'border-zinc-200 bg-white'}`}>
                  RTT = T_client_receive - T_client_send
                </div>

                <p className="font-medium mt-3">2. Estimated clock offset (θ)</p>
                <div className={`p-2.5 rounded-md border ${isDarkMode ? 'border-white/10 bg-black/30' : 'border-zinc-200 bg-white'}`}>
                  θ = (T_server + RTT/2) - T_client_receive
                </div>

                <p className="font-medium mt-3">3. Future execution target</p>
                <div className={`p-2.5 rounded-md border ${isDarkMode ? 'border-white/10 bg-black/30' : 'border-zinc-200 bg-white'}`}>
                  Target = AudioCtx.currentTime + ((T_scheduled_server - Estimated_Server_Time) / 1000)
                </div>
              </div>

              <p className={`text-xs ${subtle}`}>
                A rolling median filter discards network spike outliers, keeping the smoothed offset within roughly ±2ms.
              </p>
            </div>
          )}

          {activeTab === 'db' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className={`text-xs ${subtle}`}>Database schema for rooms, tracks, and sessions</p>
                <button
                  onClick={() => copyToClipboard(SQL_SCHEMA, 'db-schema')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                    isDarkMode ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-zinc-700'
                  }`}
                >
                  {copiedCode === 'db-schema' ? <Check size={13} /> : <FileText size={13} />} Copy
                </button>
              </div>

              <pre className={`p-4 rounded-lg border text-xs font-mono overflow-x-auto leading-relaxed ${box}`}>
{SQL_SCHEMA}
              </pre>
            </div>
          )}

          {activeTab === 'ws' && (
            <div className="space-y-3">
              <p className={`text-xs ${subtle}`}>WebSocket message events for real-time synchronization</p>

              <div className="space-y-2 font-mono text-xs">
                <div className={`p-3 rounded-lg border ${box}`}>
                  <span className="font-medium">CLOCK_PING / CLOCK_PONG</span>
                  <pre className={`mt-1 ${subtle}`}>{`{ "type": "CLOCK_PING", "payload": { "clientSendTime": 1753868000000 } }`}</pre>
                </div>

                <div className={`p-3 rounded-lg border ${box}`}>
                  <span className="font-medium">PLAYBACK_COMMAND</span>
                  <pre className={`mt-1 ${subtle}`}>{`{ "type": "PLAYBACK_COMMAND", "payload": { "action": "PLAY", "position": 0 } }`}</pre>
                </div>

                <div className={`p-3 rounded-lg border ${box}`}>
                  <span className="font-medium">ROLE_UPDATE</span>
                  <pre className={`mt-1 ${subtle}`}>{`{ "type": "ROLE_UPDATE", "payload": { "channelRole": "bass", "volume": 1.0 } }`}</pre>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'docker' && (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <p className={`text-xs ${subtle}`}>Production Dockerfile</p>
                <button
                  onClick={() => copyToClipboard(DOCKERFILE_CODE, 'docker')}
                  className={`flex items-center gap-1 px-2.5 py-1.5 rounded-md text-xs font-medium transition ${
                    isDarkMode ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-zinc-700'
                  }`}
                >
                  {copiedCode === 'docker' ? <Check size={13} /> : <FileText size={13} />} Copy
                </button>
              </div>

              <pre className={`p-4 rounded-lg border text-xs font-mono overflow-x-auto leading-relaxed ${box}`}>
{DOCKERFILE_CODE}
              </pre>
            </div>
          )}

        </div>

      </div>
    </div>
  );
};

const SQL_SCHEMA = `-- AudioSync database schema

CREATE TABLE users (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    username VARCHAR(50) NOT NULL UNIQUE,
    email VARCHAR(255) NOT NULL UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE rooms (
    code VARCHAR(10) PRIMARY KEY,
    name VARCHAR(100) NOT NULL,
    host_id UUID REFERENCES users(id) ON DELETE CASCADE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
    max_participants INT DEFAULT 50
);

CREATE TABLE tracks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(255) NOT NULL,
    artist VARCHAR(255) NOT NULL,
    album VARCHAR(255),
    duration_sec INT NOT NULL,
    audio_url TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

CREATE TABLE room_participants (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    room_code VARCHAR(10) REFERENCES rooms(code) ON DELETE CASCADE,
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    channel_role VARCHAR(20) DEFAULT 'full',
    joined_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);`;

const DOCKERFILE_CODE = `# Production multi-stage Dockerfile for AudioSync

FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=builder /app/package*.json ./
COPY --from=builder /app/dist ./dist
RUN npm ci --only=production

EXPOSE 3000
CMD ["node", "dist/server.cjs"]`;
