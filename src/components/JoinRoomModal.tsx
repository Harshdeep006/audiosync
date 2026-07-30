import React, { useState } from 'react';
import { X, Users } from 'lucide-react';
import { AudioChannelRole } from '../types';

interface JoinRoomModalProps {
  isOpen: boolean;
  initialCode?: string;
  onClose: () => void;
  onSubmit: (data: { roomCode: string; userName: string; channelRole: AudioChannelRole; deviceType: string }) => void;
  isDarkMode: boolean;
}

const ROLES = [
  { id: 'full', title: 'Full stereo', desc: 'All frequencies' },
  { id: 'bass', title: 'Subwoofer', desc: 'Lowpass filter' },
  { id: 'vocals', title: 'Center vocal', desc: 'Bandpass filter' },
  { id: 'treble', title: 'High tweeter', desc: 'Highpass filter' },
  { id: 'left', title: 'Left channel', desc: 'Left panned' },
  { id: 'right', title: 'Right channel', desc: 'Right panned' }
];

export const JoinRoomModal: React.FC<JoinRoomModalProps> = ({
  isOpen,
  initialCode = '',
  onClose,
  onSubmit,
  isDarkMode
}) => {
  const [roomCode, setRoomCode] = useState<string>(initialCode || '');
  const [userName, setUserName] = useState<string>('Guest Device');
  const [channelRole, setChannelRole] = useState<AudioChannelRole>('full');
  const [deviceType, setDeviceType] = useState<string>('mobile');

  React.useEffect(() => {
    if (initialCode) {
      setRoomCode(initialCode.toUpperCase());
    }
  }, [initialCode, isOpen]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (roomCode.trim() && userName.trim()) {
      onSubmit({
        roomCode: roomCode.trim().toUpperCase(),
        userName,
        channelRole,
        deviceType
      });
    }
  };

  const inputClass = `w-full px-3 py-2.5 rounded-lg border text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 transition ${
    isDarkMode ? 'bg-black/30 border-white/10 text-white placeholder-zinc-600' : 'bg-zinc-50 border-zinc-200 text-zinc-900'
  }`;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4">
      <div className={`relative w-full max-w-md rounded-xl border p-6 ${
        isDarkMode ? 'bg-[#0e0e10] border-white/10 text-white' : 'bg-white border-zinc-200 text-zinc-900'
      }`}>
        <button
          onClick={onClose}
          className={`absolute top-4 right-4 p-1.5 rounded-md transition ${
            isDarkMode ? 'text-zinc-500 hover:text-white hover:bg-white/5' : 'text-zinc-400 hover:text-zinc-900 hover:bg-zinc-100'
          }`}
        >
          <X size={18} />
        </button>

        <div className="flex items-center gap-3 mb-6">
          <div className={`w-9 h-9 rounded-lg flex items-center justify-center ${
            isDarkMode ? 'bg-white/5 text-zinc-300' : 'bg-zinc-100 text-zinc-700'
          }`}>
            <Users size={18} />
          </div>
          <div>
            <h3 className="text-base font-semibold tracking-tight">Join a room</h3>
            <p className={`text-xs ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>Connect this device to the room</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className={`block text-xs font-medium uppercase tracking-wide mb-1.5 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
              Room code
            </label>
            <input
              type="text"
              required
              maxLength={6}
              value={roomCode}
              onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
              placeholder="e.g. SYNC88"
              className={`${inputClass} font-mono tracking-widest text-center text-base font-medium uppercase`}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium uppercase tracking-wide mb-1.5 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
              Your device name
            </label>
            <input
              type="text"
              required
              value={userName}
              onChange={(e) => setUserName(e.target.value)}
              placeholder="e.g. Sam's Galaxy S24"
              className={inputClass}
            />
          </div>

          <div>
            <label className={`block text-xs font-medium uppercase tracking-wide mb-2 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
              Speaker role
            </label>
            <div className="grid grid-cols-2 gap-2">
              {ROLES.map((role) => (
                <button
                  key={role.id}
                  type="button"
                  onClick={() => setChannelRole(role.id as AudioChannelRole)}
                  className={`p-2.5 rounded-lg border text-left transition ${
                    channelRole === role.id
                      ? (isDarkMode ? 'border-blue-500/50 bg-blue-500/10 text-blue-300' : 'border-blue-300 bg-blue-50 text-blue-700')
                      : (isDarkMode ? 'border-white/5 bg-white/[0.02] text-zinc-400 hover:bg-white/5' : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50')
                  }`}
                >
                  <p className="text-xs font-medium">{role.title}</p>
                  <p className={`text-[10px] ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{role.desc}</p>
                </button>
              ))}
            </div>
          </div>

          <div className="pt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={onClose}
              className={`px-3 py-2 rounded-lg text-sm font-medium transition ${
                isDarkMode ? 'text-zinc-500 hover:text-white' : 'text-zinc-500 hover:text-zinc-900'
              }`}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={!roomCode.trim()}
              className={`px-4 py-2 rounded-lg text-sm font-medium transition disabled:opacity-40 ${
                isDarkMode ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-zinc-700'
              }`}
            >
              Join room
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
