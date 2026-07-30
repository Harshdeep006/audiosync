import React, { useEffect, useState } from 'react';
import { Volume2, Wifi, Sun, Moon, Layers, Users } from 'lucide-react';
import { socketClient } from '../lib/socketClient';
import { audioEngine } from '../lib/audioEngine';

interface NavbarProps {
  currentRoomCode: string | null;
  onOpenArchitecture: () => void;
  isDarkMode: boolean;
  onToggleTheme: () => void;
  participantCount?: number;
}

export const Navbar: React.FC<NavbarProps> = ({
  currentRoomCode,
  onOpenArchitecture,
  isDarkMode,
  onToggleTheme,
  participantCount = 0
}) => {
  const [isConnected, setIsConnected] = useState<boolean>(socketClient.getIsConnected());
  const [pingMs, setPingMs] = useState<number>(0);

  useEffect(() => {
    const interval = setInterval(() => {
      setIsConnected(socketClient.getIsConnected());
      setPingMs(Math.round(audioEngine.getSmoothedRTT()));
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <header className={`sticky top-0 z-40 w-full border-b transition-colors ${
      isDarkMode
        ? 'bg-[#0b0b0c]/90 backdrop-blur-md border-white/10 text-white'
        : 'bg-white/90 backdrop-blur-md border-zinc-200 text-zinc-900'
    }`}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-14 flex items-center justify-between">

        {/* Brand */}
        <div className="flex items-center gap-2.5">
          <div className={`w-7 h-7 rounded-md flex items-center justify-center ${
            isDarkMode ? 'bg-white text-black' : 'bg-zinc-900 text-white'
          }`}>
            <Volume2 className="w-4 h-4" />
          </div>
          <span className="font-semibold text-sm tracking-tight">AudioSync</span>
        </div>

        {/* Status & Actions */}
        <div className="flex items-center gap-2 sm:gap-3">

          {currentRoomCode && (
            <div className={`flex items-center gap-2 px-2.5 py-1 rounded-md text-xs border ${
              isDarkMode ? 'border-white/10 text-zinc-300' : 'border-zinc-200 text-zinc-600'
            }`}>
              <span className="font-mono tracking-wide">{currentRoomCode}</span>
              {participantCount > 0 && (
                <span className="flex items-center gap-1 opacity-70 border-l pl-2 border-current/20">
                  <Users size={12} /> {participantCount}
                </span>
              )}
            </div>
          )}

          <div className={`hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-mono border ${
            isDarkMode ? 'border-white/10 text-zinc-400' : 'border-zinc-200 text-zinc-500'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-zinc-500'}`} />
            <Wifi size={12} />
            {pingMs}ms
          </div>

          <button
            onClick={onOpenArchitecture}
            className={`hidden sm:flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs border transition ${
              isDarkMode
                ? 'border-white/10 hover:bg-white/5 text-zinc-300'
                : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'
            }`}
            title="System architecture"
          >
            <Layers size={14} />
            Architecture
          </button>

          <button
            onClick={onToggleTheme}
            className={`p-1.5 rounded-md border transition ${
              isDarkMode
                ? 'border-white/10 hover:bg-white/5 text-zinc-300'
                : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'
            }`}
            aria-label="Toggle theme"
          >
            {isDarkMode ? <Sun size={16} /> : <Moon size={16} />}
          </button>
        </div>

      </div>
    </header>
  );
};
