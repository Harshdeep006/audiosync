import React, { useState, useEffect } from 'react';
import {
  Play, Pause, Volume2, VolumeX, QrCode, Users,
  Wifi, Activity, Sliders, Music, Upload, RefreshCw, Smartphone, ShieldCheck, Check, LogOut, Radio
} from 'lucide-react';
import { Room, AudioTrack, AudioChannelRole, Participant } from '../types';
import { socketClient } from '../lib/socketClient';
import { audioEngine } from '../lib/audioEngine';
import { AudioSpectrumCanvas } from './AudioSpectrumCanvas';

interface RoomViewProps {
  room: Room;
  myClientId: string;
  onLeaveRoom: () => void;
  onOpenQRCode: () => void;
  isDarkMode: boolean;
}

export const RoomView: React.FC<RoomViewProps> = ({
  room,
  myClientId,
  onLeaveRoom,
  onOpenQRCode,
  isDarkMode
}) => {
  const [activeTab, setActiveTab] = useState<'queue' | 'sync' | 'calibration'>('queue');
  const [localVolume, setLocalVolume] = useState<number>(1.0);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [localRole, setLocalRole] = useState<AudioChannelRole>('full');
  const [copiedCode, setCopiedCode] = useState<boolean>(false);
  const [trackPositionSec, setTrackPositionSec] = useState<number>(0);
  const [startingInMs, setStartingInMs] = useState<number>(0);

  const me = room.participants[myClientId];
  const isHost = room.hostId === myClientId;
  const currentTrack = room.playback.track;
  const isPlaying = room.playback.isPlaying;

  useEffect(() => {
    if (me && me.channelRole) {
      setLocalRole(me.channelRole);
      audioEngine.setChannelRole(me.channelRole);
    }
  }, [me]);

  useEffect(() => {
    return () => {
      audioEngine.stopPlayback();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => {
      if (isPlaying) {
        setTrackPositionSec(audioEngine.getCurrentTrackPosition());
        const msLeft = room.playback.serverScheduledTimestamp - audioEngine.getEstimatedServerTime();
        setStartingInMs(msLeft > 0 ? msLeft : 0);
      } else {
        setTrackPositionSec(room.playback.position || 0);
        setStartingInMs(0);
      }
    }, 250);

    return () => clearInterval(timer);
  }, [isPlaying, room.playback.position, room.playback.serverScheduledTimestamp]);

  // Preload every track's audio buffer the moment it's known — decouples the
  // (variable, per-device) download+decode time from the synced start countdown,
  // so by the time Play is actually pressed, most devices already have it cached.
  useEffect(() => {
    room.queue.forEach((track) => {
      audioEngine.loadAudioBuffer(track.audioUrl, track.id).catch(() => {
        // Preload failures are non-fatal — schedulePlayback will retry on demand.
      });
    });
  }, [room.queue]);

  useEffect(() => {
    if (currentTrack) {
      if (isPlaying && room.playback.serverScheduledTimestamp > 0) {
        audioEngine.schedulePlayback(
          currentTrack.audioUrl,
          currentTrack.id,
          room.playback.serverScheduledTimestamp,
          room.playback.startPositionOffset || 0,
          room.playback.playbackRate || 1.0
        );
      } else {
        audioEngine.stopPlayback();
      }
    }
  }, [
    currentTrack?.id,
    isPlaying,
    room.playback.serverScheduledTimestamp,
    room.playback.startPositionOffset
  ]);

  const handleCopyCode = () => {
    navigator.clipboard.writeText(room.code);
    setCopiedCode(true);
    setTimeout(() => setCopiedCode(false), 2000);
  };

  const handleTogglePlay = () => {
    if (!currentTrack) return;
    if (isPlaying) {
      socketClient.send('PLAYBACK_COMMAND', { action: 'PAUSE' });
    } else {
      socketClient.send('PLAYBACK_COMMAND', {
        action: 'PLAY',
        position: trackPositionSec
      });
    }
  };

  const handleSeek = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newPos = parseFloat(e.target.value);
    if (isHost || room.settings.allowParticipantControl) {
      setTrackPositionSec(newPos);
      socketClient.send('PLAYBACK_COMMAND', {
        action: 'SEEK',
        position: newPos
      });
    }
  };

  const handleSelectTrack = (track: AudioTrack) => {
    socketClient.send('PLAYBACK_COMMAND', {
      action: 'CHANGE_TRACK',
      track
    });
  };

  const handleAssignRole = (targetClientId: string, role: AudioChannelRole) => {
    socketClient.send('ROLE_UPDATE', { targetClientId, channelRole: role });
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setLocalVolume(val);
    audioEngine.setVolume(isMuted ? 0 : val);
  };

  const handleToggleMute = () => {
    const nextMuted = !isMuted;
    setIsMuted(nextMuted);
    audioEngine.setVolume(nextMuted ? 0 : localVolume);
  };

  const [isRecalibrating, setIsRecalibrating] = useState<boolean>(false);

  const handleRecalibrateSync = () => {
    if (isRecalibrating) return;
    setIsRecalibrating(true);
    // A single ping barely moves a 20-sample rolling average — send a quick burst
    // so the recalibration is both real and visible in the numbers below.
    for (let i = 0; i < 6; i++) {
      setTimeout(() => socketClient.sendClockPing(), i * 120);
    }
    setTimeout(() => setIsRecalibrating(false), 1000);
  };

  const [isUploadingTrack, setIsUploadingTrack] = useState<boolean>(false);
  const [uploadProgressPct, setUploadProgressPct] = useState<number>(0);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;

    setIsUploadingTrack(true);
    setUploadProgressPct(0);

    // Read the real track length from the local file itself, instead of guessing —
    // this resolves independently of the upload and is usually ready almost instantly.
    const probeUrl = URL.createObjectURL(file);
    const probeAudio = new Audio();
    let probedDurationSec = 0;
    probeAudio.addEventListener('loadedmetadata', () => {
      if (isFinite(probeAudio.duration)) probedDurationSec = probeAudio.duration;
    });
    probeAudio.src = probeUrl;

    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.setRequestHeader('Content-Type', file.type || 'audio/mpeg');

    // fetch() has no upload progress events — XHR does, so the button can show a
    // real percentage instead of an indefinite "Uploading…" that feels stalled.
    xhr.upload.onprogress = (evt) => {
      if (evt.lengthComputable) {
        setUploadProgressPct(Math.round((evt.loaded / evt.total) * 100));
      }
    };

    const finish = () => {
      URL.revokeObjectURL(probeUrl);
      setIsUploadingTrack(false);
      setUploadProgressPct(0);
    };

    xhr.onload = () => {
      if (xhr.status < 200 || xhr.status >= 300) {
        console.error('Upload failed with status', xhr.status);
        finish();
        return;
      }

      try {
        const { url } = JSON.parse(xhr.responseText);
        const customTrack: AudioTrack = {
          id: 'custom_' + Date.now(),
          title: file.name.replace(/\.[^/.]+$/, ''),
          artist: me?.name || 'Local upload',
          album: 'Host library',
          duration: probedDurationSec || 240,
          coverUrl: 'https://images.unsplash.com/photo-1470225620780-dba8ba36b745?auto=format&fit=crop&w=600&q=80',
          audioUrl: url,
          genre: 'Custom file',
          isCustom: true
        };

        const newQueue = [...room.queue, customTrack];
        socketClient.send('QUEUE_UPDATE', { queue: newQueue });
        handleSelectTrack(customTrack);
      } catch (err) {
        console.error('Failed to parse upload response:', err);
      }

      finish();
    };

    xhr.onerror = () => {
      console.error('Upload network error');
      finish();
    };

    xhr.send(file);
  };

  const participantsList: Participant[] = Object.values(room.participants || {});

  const card = isDarkMode ? 'border-white/10 bg-white/[0.02]' : 'border-zinc-200 bg-white';
  const subtle = isDarkMode ? 'text-zinc-500' : 'text-zinc-500';

  return (
    <div className={`min-h-[calc(100vh-3.5rem)] p-4 sm:p-6 max-w-6xl mx-auto space-y-5 ${
      isDarkMode ? 'text-zinc-100' : 'text-zinc-900'
    }`}>

      {/* Room header */}
      <div className={`p-5 rounded-xl border flex flex-wrap items-center justify-between gap-4 ${card}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${
            isDarkMode ? 'bg-white/5 text-zinc-300' : 'bg-zinc-100 text-zinc-700'
          }`}>
            <Radio size={18} />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h2 className="text-lg font-semibold tracking-tight">{room.name}</h2>
              {isHost && (
                <span className={`px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide rounded border ${
                  isDarkMode ? 'border-white/10 text-zinc-400' : 'border-zinc-200 text-zinc-500'
                }`}>
                  Host
                </span>
              )}
            </div>
            <p className={`text-xs flex items-center gap-2 mt-0.5 ${subtle}`}>
              <span>Code:</span>
              <button
                onClick={handleCopyCode}
                className={`font-mono font-medium px-1.5 py-0.5 rounded border transition flex items-center gap-1 ${
                  isDarkMode ? 'border-white/10 hover:bg-white/5' : 'border-zinc-200 hover:bg-zinc-100'
                }`}
              >
                {room.code} {copiedCode ? <Check size={12} /> : null}
              </button>
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onOpenQRCode}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium text-xs transition ${
              isDarkMode ? 'border-white/10 hover:bg-white/5 text-zinc-300' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'
            }`}
          >
            <QrCode size={14} /> Share
          </button>

          <button
            onClick={onLeaveRoom}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border font-medium text-xs transition ${
              isDarkMode ? 'border-white/10 hover:bg-white/5 text-zinc-400' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-500'
            }`}
          >
            <LogOut size={14} /> Leave
          </button>
        </div>
      </div>

      {/* Player + participants */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">

        <div className={`lg:col-span-8 p-5 rounded-xl border space-y-5 ${card}`}>

          <div className="flex flex-col sm:flex-row items-center gap-5">
            <img
              src={currentTrack?.coverUrl || 'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?auto=format&fit=crop&w=600&q=80'}
              alt={currentTrack?.title || 'No track'}
              className={`w-28 h-28 rounded-xl object-cover border shrink-0 ${isDarkMode ? 'border-white/10' : 'border-zinc-200'}`}
            />

            <div className="flex-1 text-center sm:text-left space-y-1.5">
              <div className="flex items-center justify-center sm:justify-start gap-2">
                <span className={`px-2 py-0.5 rounded text-[10px] font-medium uppercase tracking-wide border ${
                  isDarkMode ? 'border-white/10 text-zinc-400' : 'border-zinc-200 text-zinc-500'
                }`}>
                  {currentTrack?.genre || 'Audio'}
                </span>
                <span className={`text-xs flex items-center gap-1 ${subtle}`}>
                  <ShieldCheck size={13} /> Synchronized
                </span>
              </div>
              <h3 className="text-xl font-semibold tracking-tight">{currentTrack?.title || 'Select a track'}</h3>
              <p className={`text-sm ${subtle}`}>{currentTrack?.artist || 'AudioSync library'}</p>
            </div>
          </div>

          <div className="space-y-1.5">
            <div className={`flex items-center justify-between text-xs ${subtle}`}>
              <span>Spectrum</span>
              <span className="font-mono uppercase text-[11px]">{localRole}</span>
            </div>
            <AudioSpectrumCanvas isPlaying={isPlaying} isDarkMode={isDarkMode} />
          </div>

          <div className="space-y-1.5">
            <input
              type="range"
              min={0}
              max={currentTrack?.duration || 180}
              step={0.5}
              value={trackPositionSec}
              onChange={handleSeek}
              disabled={!isHost && !room.settings.allowParticipantControl}
              className="w-full h-1.5 rounded-full accent-zinc-500 cursor-pointer"
            />
            <div className={`flex items-center justify-between text-xs font-mono ${subtle}`}>
              <span>{formatSeconds(trackPositionSec)}</span>
              <span>{formatSeconds(currentTrack?.duration || 180)}</span>
            </div>
          </div>

          <div className="flex items-center justify-between pt-1">
            <div className="flex items-center gap-3">
              <button
                disabled={!isHost && !room.settings.allowParticipantControl}
                onClick={handleTogglePlay}
                className={`w-11 h-11 rounded-full disabled:opacity-40 flex items-center justify-center transition ${
                  isDarkMode ? 'bg-white text-black hover:bg-zinc-200' : 'bg-zinc-900 text-white hover:bg-zinc-700'
                }`}
              >
                {isPlaying ? <Pause size={18} /> : <Play size={18} className="ml-0.5" />}
              </button>

              <p className={`text-xs ${subtle}`}>
                {startingInMs > 250
                  ? `Starting in ${(startingInMs / 1000).toFixed(1)}s…`
                  : (!isHost && !room.settings.allowParticipantControl ? 'Controlled by host' : 'Host controls active')}
              </p>
            </div>

            <div className="flex items-center gap-2.5">
              <button onClick={handleToggleMute} className={subtle}>
                {isMuted ? <VolumeX size={18} /> : <Volume2 size={18} />}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={isMuted ? 0 : localVolume}
                onChange={handleVolumeChange}
                className="w-20 h-1 rounded-full accent-zinc-500 cursor-pointer"
              />
            </div>
          </div>

        </div>

        {/* Participants */}
        <div className={`lg:col-span-4 p-5 rounded-xl border space-y-3 flex flex-col ${card}`}>
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-sm flex items-center gap-2">
              <Users size={15} /> Speaker array
            </h3>
            <span className={`px-2 py-0.5 rounded text-xs font-mono border ${
              isDarkMode ? 'border-white/10 text-zinc-400' : 'border-zinc-200 text-zinc-500'
            }`}>
              {participantsList.length}
            </span>
          </div>

          <div className="space-y-2 overflow-y-auto max-h-[320px] pr-1 flex-1">
            {participantsList.map((p) => {
              const isMe = p.id === myClientId;
              return (
                <div
                  key={p.id}
                  className={`p-2.5 rounded-lg border ${
                    isMe
                      ? (isDarkMode ? 'border-blue-500/30 bg-blue-500/5' : 'border-blue-200 bg-blue-50')
                      : (isDarkMode ? 'border-white/5 bg-white/[0.02]' : 'border-zinc-100 bg-zinc-50')
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Smartphone size={14} className={subtle} />
                      <span className="font-medium text-xs truncate">
                        {p.name} {isMe ? '(you)' : ''}
                      </span>
                    </div>

                    {isHost ? (
                      <select
                        value={p.channelRole}
                        onChange={(e) => handleAssignRole(p.id, e.target.value as AudioChannelRole)}
                        className={`shrink-0 px-1.5 py-1 rounded text-[10px] font-mono uppercase border focus:outline-none focus:ring-1 focus:ring-blue-500 ${
                          isDarkMode ? 'bg-black/30 border-white/10 text-zinc-300' : 'bg-white border-zinc-200 text-zinc-600'
                        }`}
                      >
                        <option value="full">Full</option>
                        <option value="bass">Bass</option>
                        <option value="vocals">Vocals</option>
                        <option value="treble">Treble</option>
                        <option value="left">Left</option>
                        <option value="right">Right</option>
                      </select>
                    ) : (
                      <span className={`px-1.5 py-0.5 rounded text-[10px] font-mono uppercase shrink-0 ${subtle}`}>
                        {p.channelRole}
                      </span>
                    )}
                  </div>

                  <div className={`mt-1.5 flex items-center justify-between text-[11px] font-mono ${subtle}`}>
                    <span className="flex items-center gap-1">
                      <Wifi size={11} /> {p.rttMs}ms
                    </span>
                    <span className={`flex items-center gap-1 ${p.isBuffering ? 'text-amber-500' : p.isSynced ? 'text-emerald-500' : 'text-rose-500'}`}>
                      <span className={`w-1 h-1 rounded-full ${p.isBuffering ? 'bg-amber-500' : p.isSynced ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                      {p.isBuffering ? 'Buffering' : p.isSynced ? 'Synced' : 'Drifted'}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>

          <div className={`pt-3 border-t ${isDarkMode ? 'border-white/10' : 'border-zinc-200'}`}>
            {isHost ? (
              <p className={`text-[11px] leading-relaxed ${subtle}`}>
                Tap the role dropdown next to any device above to assign it as left, right, bass, vocals, treble, or full range — including your own device.
              </p>
            ) : (
              <p className={`text-[11px] leading-relaxed ${subtle}`}>
                Your speaker role (<span className="font-mono uppercase">{me?.channelRole || 'full'}</span>) is assigned by the host and updates automatically.
              </p>
            )}
          </div>
        </div>

      </div>

      {/* Tabs */}
      <div className={`p-5 rounded-xl border ${card}`}>

        <div className={`flex items-center gap-1 border-b pb-3 mb-5 ${isDarkMode ? 'border-white/10' : 'border-zinc-200'}`}>
          {[
            { id: 'queue', label: 'Queue', icon: Music },
            { id: 'sync', label: 'Sync diagnostics', icon: Activity },
            { id: 'calibration', label: 'Calibration', icon: Sliders },
          ].map((tab) => {
            const Icon = tab.icon;
            const active = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition ${
                  active
                    ? (isDarkMode ? 'bg-white/10 text-white' : 'bg-zinc-100 text-zinc-900')
                    : (isDarkMode ? 'text-zinc-500 hover:text-zinc-300' : 'text-zinc-500 hover:text-zinc-700')
                }`}
              >
                <Icon size={14} /> {tab.label}
              </button>
            );
          })}
        </div>

        {activeTab === 'queue' && (
          <div className="space-y-4">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-sm">Shared queue</h4>
                <p className={`text-xs ${subtle}`}>Select a track or stream a local file</p>
              </div>

              <label className={`flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs font-medium cursor-pointer transition ${
                isUploadingTrack ? 'opacity-50 pointer-events-none' : ''
              } ${
                isDarkMode ? 'border-white/10 hover:bg-white/5 text-zinc-300' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'
              }`}>
                <Upload size={13} /> {isUploadingTrack ? `Uploading… ${uploadProgressPct}%` : 'Upload file'}
                <input type="file" accept="audio/*" onChange={handleFileUpload} className="hidden" disabled={isUploadingTrack} />
              </label>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {room.queue.map((track) => {
                const isCurrent = currentTrack?.id === track.id;
                return (
                  <div
                    key={track.id}
                    className={`p-3 rounded-lg border flex items-center gap-3 transition ${
                      isCurrent
                        ? (isDarkMode ? 'border-blue-500/30 bg-blue-500/5' : 'border-blue-200 bg-blue-50')
                        : (isDarkMode ? 'border-white/5 bg-white/[0.02] hover:bg-white/5' : 'border-zinc-100 bg-white hover:bg-zinc-50')
                    }`}
                  >
                    <img src={track.coverUrl} alt={track.title} className="w-11 h-11 rounded-md object-cover shrink-0" />
                    <div className="flex-1 min-w-0">
                      <p className="font-medium text-xs truncate">{track.title}</p>
                      <p className={`text-[11px] truncate ${subtle}`}>{track.artist}</p>
                      <span className={`text-[10px] uppercase font-mono ${subtle}`}>{track.genre}</span>
                    </div>

                    <button
                      onClick={() => handleSelectTrack(track)}
                      className={`px-2 py-1.5 rounded-md font-medium text-xs transition shrink-0 ${
                        isCurrent
                          ? (isDarkMode ? 'bg-white text-black' : 'bg-zinc-900 text-white')
                          : (isDarkMode ? 'bg-white/5 text-zinc-300 hover:bg-white/10' : 'bg-zinc-100 text-zinc-600 hover:bg-zinc-200')
                      }`}
                    >
                      {isCurrent && isPlaying ? 'Playing' : 'Play'}
                    </button>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {activeTab === 'sync' && (
          <div className="space-y-5">
            <div className="flex items-center justify-between">
              <div>
                <h4 className="font-medium text-sm">Clock sync diagnostics</h4>
                <p className={`text-xs ${subtle}`}>Real-time NTP metrics and offset drift</p>
              </div>

              <button
                onClick={handleRecalibrateSync}
                disabled={isRecalibrating}
                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg border text-xs font-medium transition disabled:opacity-60 ${
                  isDarkMode ? 'border-white/10 hover:bg-white/5 text-zinc-300' : 'border-zinc-200 hover:bg-zinc-100 text-zinc-600'
                }`}
              >
                <RefreshCw size={13} className={isRecalibrating ? 'animate-spin' : ''} />
                {isRecalibrating ? 'Recalibrating…' : 'Recalibrate'}
              </button>
            </div>

            {audioEngine.getClockSampleCount() < 8 && (
              <div className={`px-3 py-2 rounded-lg border text-xs flex items-center justify-between ${
                isDarkMode ? 'border-amber-500/30 bg-amber-500/10 text-amber-300' : 'border-amber-300 bg-amber-50 text-amber-700'
              }`}>
                <span>Still calibrating — {audioEngine.getClockSampleCount()}/8 samples. Wait a few seconds before testing playback.</span>
              </div>
            )}

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
              <div className={`p-3 rounded-lg border ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-zinc-50'}`}>
                <p className={`text-[11px] font-medium uppercase ${subtle}`}>RTT ping</p>
                <p className="text-xl font-mono font-semibold mt-1">{Math.round(audioEngine.getSmoothedRTT())} ms</p>
              </div>

              <div className={`p-3 rounded-lg border ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-zinc-50'}`}>
                <p className={`text-[11px] font-medium uppercase ${subtle}`}>Clock offset</p>
                <p className="text-xl font-mono font-semibold mt-1">
                  {Math.round(audioEngine.getSmoothedOffset()) >= 0 ? `+${Math.round(audioEngine.getSmoothedOffset())}` : Math.round(audioEngine.getSmoothedOffset())} ms
                </p>
              </div>

              <div className={`p-3 rounded-lg border ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-zinc-50'}`}>
                <p className={`text-[11px] font-medium uppercase ${subtle}`}>Live drift</p>
                <p className={`text-xl font-mono font-semibold mt-1 ${Math.abs(audioEngine.getLastMeasuredDriftMs()) > 100 ? 'text-rose-500' : 'text-emerald-500'}`}>
                  {Math.round(audioEngine.getLastMeasuredDriftMs()) >= 0 ? '+' : ''}{Math.round(audioEngine.getLastMeasuredDriftMs())} ms
                </p>
              </div>

              <div className={`p-3 rounded-lg border ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-zinc-50'}`}>
                <p className={`text-[11px] font-medium uppercase ${subtle}`}>Output latency</p>
                <p className="text-xl font-mono font-semibold mt-1">{Math.round(audioEngine.getOutputLatencyMs())} ms</p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'calibration' && (
          <div className="space-y-4">
            <div>
              <h4 className="font-medium text-sm">Surround calibration</h4>
              <p className={`text-xs ${subtle}`}>Position devices around the room for multi-speaker surround</p>
            </div>

            <div className={`p-5 rounded-xl border text-center space-y-3 ${isDarkMode ? 'border-white/10 bg-black/20' : 'border-zinc-200 bg-zinc-50'}`}>
              <div className="max-w-md mx-auto grid grid-cols-3 gap-2">
                <div className={`p-3 rounded-lg border text-xs font-medium ${isDarkMode ? 'border-white/10 text-zinc-300' : 'border-zinc-200 text-zinc-600'}`}>
                  Left speaker
                </div>
                <div className={`p-3 rounded-lg border text-xs font-medium ${isDarkMode ? 'border-white/10 text-zinc-300' : 'border-zinc-200 text-zinc-600'}`}>
                  Center vocal
                </div>
                <div className={`p-3 rounded-lg border text-xs font-medium ${isDarkMode ? 'border-white/10 text-zinc-300' : 'border-zinc-200 text-zinc-600'}`}>
                  Right speaker
                </div>
              </div>
              <div className={`max-w-xs mx-auto p-3 rounded-lg border text-xs font-medium ${isDarkMode ? 'border-white/10 text-zinc-300' : 'border-zinc-200 text-zinc-600'}`}>
                Subwoofer (ground center)
              </div>
            </div>
          </div>
        )}

      </div>

    </div>
  );
};

function formatSeconds(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}
