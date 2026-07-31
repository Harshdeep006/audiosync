import React, { useState } from 'react';
import { Radio, QrCode, Sliders, Cpu, ArrowRight, Play, Pause, ShieldCheck } from 'lucide-react';
import { audioEngine } from '../lib/audioEngine';
import { AudioChannelRole } from '../types';

interface LandingPageProps {
  onCreateRoom: () => void;
  onJoinRoom: (code?: string) => void;
  onQuickDemo: () => void;
  isDarkMode: boolean;
}

const ROLES: { role: AudioChannelRole; label: string; desc: string }[] = [
  { role: 'full', label: 'Full range', desc: 'Standard stereo' },
  { role: 'bass', label: 'Subwoofer', desc: 'Lowpass < 220Hz' },
  { role: 'vocals', label: 'Vocal lead', desc: 'Mid-band 1200Hz' },
  { role: 'treble', label: 'High tweeter', desc: 'Highpass > 2500Hz' },
  { role: 'left', label: 'Left speaker', desc: 'Pan 100% left' },
  { role: 'right', label: 'Right speaker', desc: 'Pan 100% right' },
];

export const LandingPage: React.FC<LandingPageProps> = ({
  onCreateRoom,
  onJoinRoom,
  onQuickDemo,
  isDarkMode
}) => {
  const [joinInputCode, setJoinInputCode] = useState<string>('');
  const [isPlayingSampler, setIsPlayingSampler] = useState<boolean>(false);
  const [samplerRole, setSamplerRole] = useState<AudioChannelRole>('full');

  const handleToggleSampler = async () => {
    if (isPlayingSampler) {
      audioEngine.stopPlayback();
      setIsPlayingSampler(false);
    } else {
      audioEngine.initAudioContext();
      audioEngine.setChannelRole(samplerRole);
      await audioEngine.schedulePlayback(
        '/audio/joy.mp3',
        'demo-sampler',
        Date.now() + 200,
        0,
        1.0
      );
      setIsPlayingSampler(true);
    }
  };

  const handleSelectRole = (role: AudioChannelRole) => {
    setSamplerRole(role);
    audioEngine.setChannelRole(role);
  };

  const handleJoinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (joinInputCode.trim()) {
      onJoinRoom(joinInputCode.trim().toUpperCase());
    }
  };

  const card = isDarkMode
    ? 'border-white/10 bg-white/[0.02]'
    : 'border-zinc-200 bg-white';

  return (
    <div className={`min-h-[calc(100vh-3.5rem)] transition-colors ${
      isDarkMode ? 'bg-[#0b0b0c] text-zinc-100' : 'bg-zinc-50 text-zinc-900'
    }`}>
      {/* Hero */}
      <section className="pt-16 pb-16 px-4 sm:px-6">
        <div className="max-w-3xl mx-auto text-center">

          <p className={`text-xs font-medium uppercase tracking-wider mb-4 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
            Distributed audio engine
          </p>

          <h1 className="text-3xl sm:text-5xl font-semibold tracking-tight leading-[1.1]">
            Turn any phones into one synchronized speaker system
          </h1>

          <p className={`mt-5 text-base sm:text-lg max-w-xl mx-auto ${isDarkMode ? 'text-zinc-400' : 'text-zinc-500'}`}>
            Sync playback across phones, tablets, and laptops to within milliseconds using clock-aligned WebSocket scheduling.
          </p>

          {/* Actions */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-2 gap-4 max-w-xl mx-auto text-left">

            <div className={`p-5 rounded-xl border ${card}`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${
                isDarkMode ? 'bg-white/5 text-zinc-300' : 'bg-zinc-100 text-zinc-700'
              }`}>
                <Radio size={18} />
              </div>
              <h3 className="text-sm font-semibold">Host a room</h3>
              <p className={`text-xs mt-1 mb-4 leading-relaxed ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
                Pick tracks, share a room code, and control playback across every connected device.
              </p>
              <button
                onClick={onCreateRoom}
                className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg font-medium text-sm transition ${
                  isDarkMode ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-zinc-700'
                }`}
              >
                Create room <ArrowRight size={15} />
              </button>
            </div>

            <div className={`p-5 rounded-xl border ${card}`}>
              <div className={`w-9 h-9 rounded-lg flex items-center justify-center mb-3 ${
                isDarkMode ? 'bg-white/5 text-zinc-300' : 'bg-zinc-100 text-zinc-700'
              }`}>
                <QrCode size={18} />
              </div>
              <h3 className="text-sm font-semibold">Join a room</h3>
              <p className={`text-xs mt-1 mb-3 leading-relaxed ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
                Enter a room code to join as a synchronized speaker.
              </p>
              <form onSubmit={handleJoinSubmit} className="space-y-2">
                <input
                  type="text"
                  maxLength={6}
                  placeholder="e.g. SYNC88"
                  value={joinInputCode}
                  onChange={(e) => setJoinInputCode(e.target.value.toUpperCase())}
                  className={`w-full px-3 py-2 rounded-lg font-mono text-center tracking-widest text-sm border focus:outline-none focus:ring-1 focus:ring-blue-500 transition ${
                    isDarkMode ? 'bg-black/40 border-white/10 text-white placeholder-zinc-600' : 'bg-zinc-50 border-zinc-200 text-zinc-900'
                  }`}
                />
                <button
                  type="submit"
                  disabled={!joinInputCode.trim()}
                  className={`w-full px-4 py-2 rounded-lg font-medium text-sm border transition disabled:opacity-40 ${
                    isDarkMode ? 'border-white/10 hover:bg-white/5 text-zinc-200' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-700'
                  }`}
                >
                  Join room
                </button>
              </form>
            </div>

          </div>

          <button
            onClick={onQuickDemo}
            className={`mt-6 text-xs font-medium underline underline-offset-4 transition ${
              isDarkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-500 hover:text-zinc-700'
            }`}
          >
            Try an instant demo room
          </button>
        </div>
      </section>

      {/* Channel sampler */}
      <section className={`py-14 border-y ${isDarkMode ? 'border-white/10' : 'border-zinc-200'}`}>
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-6">
            <h2 className="text-lg font-semibold">Speaker channel preview</h2>
            <p className={`text-sm mt-1 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
              Each phone can play a filtered role — bass, vocal, treble, or a stereo channel.
            </p>
          </div>

          <div className={`max-w-lg mx-auto p-5 rounded-xl border ${card}`}>
            <div className="flex items-center justify-between gap-4 mb-5">
              <div className="flex items-center gap-3">
                <button
                  onClick={handleToggleSampler}
                  className={`w-10 h-10 rounded-full flex items-center justify-center transition shrink-0 ${
                    isDarkMode ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-zinc-700'
                  }`}
                >
                  {isPlayingSampler ? <Pause size={16} /> : <Play size={16} className="ml-0.5" />}
                </button>
                <div>
                  <p className="font-medium text-sm">Channel preview</p>
                  <p className={`text-xs ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
                    Role: <span className="font-mono uppercase">{samplerRole}</span>
                  </p>
                </div>
              </div>
              <span className={`px-2 py-1 rounded-md text-xs border ${
                isPlayingSampler
                  ? (isDarkMode ? 'border-emerald-500/30 text-emerald-400' : 'border-emerald-300 text-emerald-600')
                  : (isDarkMode ? 'border-white/10 text-zinc-500' : 'border-zinc-200 text-zinc-500')
              }`}>
                {isPlayingSampler ? 'Playing' : 'Ready'}
              </span>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {ROLES.map((item) => (
                <button
                  key={item.role}
                  onClick={() => handleSelectRole(item.role)}
                  className={`p-2.5 rounded-lg border text-left transition ${
                    samplerRole === item.role
                      ? (isDarkMode ? 'border-blue-500/50 bg-blue-500/10 text-blue-300' : 'border-blue-300 bg-blue-50 text-blue-700')
                      : (isDarkMode ? 'border-white/5 bg-white/[0.02] text-zinc-400 hover:bg-white/5' : 'border-zinc-200 bg-white text-zinc-500 hover:bg-zinc-50')
                  }`}
                >
                  <p className="text-xs font-medium">{item.label}</p>
                  <p className={`text-[11px] mt-0.5 ${isDarkMode ? 'text-zinc-500' : 'text-zinc-400'}`}>{item.desc}</p>
                </button>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Feature pillars */}
      <section className="py-16 px-4 sm:px-6 max-w-4xl mx-auto">
        <div className="text-center mb-10">
          <h2 className="text-xl font-semibold">How it stays in sync</h2>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className={`p-5 rounded-xl border ${card}`}>
            <Cpu size={18} className={isDarkMode ? 'text-zinc-400 mb-3' : 'text-zinc-500 mb-3'} />
            <h3 className="font-medium text-sm mb-1.5">Clock alignment</h3>
            <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
              Continuous timestamp exchanges measure round-trip time and clock offset, aligning devices to sub-millisecond precision.
            </p>
          </div>

          <div className={`p-5 rounded-xl border ${card}`}>
            <Sliders size={18} className={isDarkMode ? 'text-zinc-400 mb-3' : 'text-zinc-500 mb-3'} />
            <h3 className="font-medium text-sm mb-1.5">Role-based array</h3>
            <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
              Assign devices as subwoofers, left/right channels, or vocal centers to build a surround setup from any room.
            </p>
          </div>

          <div className={`p-5 rounded-xl border ${card}`}>
            <ShieldCheck size={18} className={isDarkMode ? 'text-zinc-400 mb-3' : 'text-zinc-500 mb-3'} />
            <h3 className="font-medium text-sm mb-1.5">Scheduled playback</h3>
            <p className={`text-xs leading-relaxed ${isDarkMode ? 'text-zinc-500' : 'text-zinc-500'}`}>
              Playback commands carry a future execution time, so every device buffers ahead and starts at the same instant.
            </p>
          </div>
        </div>
      </section>

    </div>
  );
};
