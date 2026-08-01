import { AudioChannelRole, ClockSyncResult, PerformanceMetrics } from '../types';

class AudioEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private channelFilter: BiquadFilterNode | null = null;
  private panner: StereoPannerNode | null = null;
  private analyser: AnalyserNode | null = null;
  
  private currentSource: AudioBufferSourceNode | null = null;
  private audioBufferCache: Map<string, AudioBuffer> = new Map();
  private isLoadingTrack: boolean = false;
  private currentTrackId: string | null = null;
  private currentPlaybackId: number = 0;

  // Clock Sync Metrics (NTP / Cristian's Algorithm)
  private clockOffsets: number[] = [];
  private rttHistory: number[] = [];
  private smoothedClockOffset: number = 0;
  private smoothedRTT: number = 0;

  private currentChannelRole: AudioChannelRole = 'full';
  private scheduledAudioContextStartTime: number = 0;
  private scheduledAudioOffsetSec: number = 0;

  // Continuous drift correction (the technique Snapcast/AirPlay use instead of a
  // single one-shot scheduled start): track the absolute server-time target so we
  // can keep re-checking actual vs. expected position throughout playback.
  private driftCorrectionIntervalId: any = null;
  private activeServerScheduledTimestampMs: number = 0;
  private activeStartPositionOffsetSec: number = 0;
  private activeBasePlaybackRate: number = 1.0;
  private frozenOffsetAtScheduleMs: number = 0;
  private lastMeasuredDriftMs: number = 0;
  private clockSampleCount: number = 0;

  constructor() {
    // Lazy initialization on user interaction
  }

  public initAudioContext(): AudioContext {
    if (!this.ctx) {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      this.ctx = new AudioCtx({ latencyHint: 'interactive' });

      this.masterGain = this.ctx.createGain();
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.8;

      this.panner = this.ctx.createStereoPanner ? this.ctx.createStereoPanner() : null;
      this.channelFilter = this.ctx.createBiquadFilter();

      // Connect Chain: Source -> Filter -> Panner -> MasterGain -> Analyser -> Destination
      this.channelFilter.connect(this.panner ? this.panner : this.masterGain);
      if (this.panner) {
        this.panner.connect(this.masterGain);
      }
      this.masterGain.connect(this.analyser);
      this.analyser.connect(this.ctx.destination);

      this.setChannelRole('full');
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume();
    }

    return this.ctx;
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  // Record NTP Ping-Pong measurement and calculate clock offset
  public recordClockMeasurement(sample: ClockSyncResult): void {
    const { rttMs, clockOffsetMs } = sample;
    this.clockSampleCount++;

    this.rttHistory.push(rttMs);
    this.clockOffsets.push(clockOffsetMs);
    // A wider window resists a jittery connection (occasional RTT spikes)
    // dominating the average; the burst/warm-up pings still get us enough
    // samples fast, this just stops one bad reading from swinging things.
    if (this.rttHistory.length > 30) {
      this.rttHistory.shift();
      this.clockOffsets.shift();
    }

    // Under Cristian's algorithm, a faster round trip means less uncertainty
    // in the "network delay was symmetric" assumption. Real-world WiFi/mobile
    // paths often have a fairly steady total RTT while the up/down split
    // varies a lot between individual pings — a fixed top-N% cut can still
    // include samples whose asymmetry just happened not to be the worst in
    // the batch. Trusting only samples close to the single best round trip
    // actually observed is the standard NTP min-filter approach and is more
    // resistant to that specific noise pattern.
    const paired = this.rttHistory.map((rtt, i) => ({ rtt, offset: this.clockOffsets[i] }));
    const minRtt = Math.min(...this.rttHistory);
    let bestSamples = paired.filter((s) => s.rtt <= minRtt * 1.15);
    if (bestSamples.length < 3) {
      // Not enough close-to-best samples yet — fall back to the closest 3.
      paired.sort((a, b) => a.rtt - b.rtt);
      bestSamples = paired.slice(0, 3);
    }

    if (bestSamples.length > 0) {
      const sum = bestSamples.reduce((acc, s) => acc + s.offset, 0);
      this.smoothedClockOffset = sum / bestSamples.length;
      this.smoothedRTT = minRtt;
    } else {
      this.smoothedClockOffset = clockOffsetMs;
      this.smoothedRTT = rttMs;
    }
  }

  public getEstimatedServerTime(): number {
    // Client local time + offset = Server time
    return Date.now() + this.smoothedClockOffset;
  }

  public getSmoothedOffset(): number {
    return this.smoothedClockOffset;
  }

  public getSmoothedRTT(): number {
    return this.smoothedRTT;
  }

  // Role-Based Audio Frequency & Panning Separation
  public setChannelRole(role: AudioChannelRole): void {
    this.currentChannelRole = role;
    if (!this.ctx || !this.channelFilter) return;

    // Reset filter values
    this.channelFilter.type = 'allpass';
    if (this.panner) this.panner.pan.value = 0;

    switch (role) {
      case 'left':
        if (this.panner) this.panner.pan.value = -1.0;
        break;
      case 'right':
        if (this.panner) this.panner.pan.value = 1.0;
        break;
      case 'bass':
        // Subwoofer mode: Lowpass filter cutting off frequencies above 220Hz
        this.channelFilter.type = 'lowpass';
        this.channelFilter.frequency.value = 220;
        this.channelFilter.Q.value = 2.0;
        break;
      case 'vocals':
        // Center Vocal speaker: Bandpass filter 300Hz - 3400Hz
        this.channelFilter.type = 'bandpass';
        this.channelFilter.frequency.value = 1200;
        this.channelFilter.Q.value = 1.2;
        break;
      case 'treble':
        // High frequency tweeter mode: Highpass filter > 2500Hz
        this.channelFilter.type = 'highpass';
        this.channelFilter.frequency.value = 2500;
        this.channelFilter.Q.value = 1.0;
        break;
      case 'ambient':
        // Surround mode
        this.channelFilter.type = 'peaking';
        this.channelFilter.frequency.value = 1000;
        this.channelFilter.gain.value = -3;
        break;
      case 'full':
      default:
        this.channelFilter.type = 'allpass';
        break;
    }
  }

  public setVolume(volume: number): void {
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setValueAtTime(Math.max(0, Math.min(1, volume)), this.ctx.currentTime);
    }
  }

  // Pre-fetch & decode audio buffer
  public async loadAudioBuffer(url: string, trackId: string): Promise<AudioBuffer> {
    if (this.audioBufferCache.has(trackId)) {
      return this.audioBufferCache.get(trackId)!;
    }

    const ctx = this.initAudioContext();
    this.isLoadingTrack = true;

    try {
      const response = await fetch(url);
      const arrayBuffer = await response.arrayBuffer();
      const decodedBuffer = await ctx.decodeAudioData(arrayBuffer);
      this.audioBufferCache.set(trackId, decodedBuffer);
      this.currentTrackId = trackId;
      this.isLoadingTrack = false;
      return decodedBuffer;
    } catch (err) {
      this.isLoadingTrack = false;
      console.error('Failed to load audio buffer:', err);
      // Generate synthetic buffer fallback if fetch fails
      const fallbackBuffer = this.createSyntheticAudioBuffer(ctx, 60);
      this.audioBufferCache.set(trackId, fallbackBuffer);
      return fallbackBuffer;
    }
  }

  // Generate synthetic audio buffer in Web Audio memory as instant fallback
  private createSyntheticAudioBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * durationSec;
    const buffer = ctx.createBuffer(2, length, sampleRate);
    const leftChannel = buffer.getChannelData(0);
    const rightChannel = buffer.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const t = i / sampleRate;
      const beat = Math.sin(2 * Math.PI * 130 * (1 - (t % 0.5) * 2)) * Math.exp(-(t % 0.5) * 8);
      const synth = Math.sin(2 * Math.PI * 440 * t) * 0.2;
      leftChannel[i] = Math.max(-1, Math.min(1, synth + beat * 0.5));
      rightChannel[i] = Math.max(-1, Math.min(1, synth * 0.8 + beat * 0.5));
    }

    return buffer;
  }

  private stopActiveSource(): void {
    if (this.driftCorrectionIntervalId) {
      clearInterval(this.driftCorrectionIntervalId);
      this.driftCorrectionIntervalId = null;
    }
    if (this.currentSource) {
      try {
        this.currentSource.onended = null;
        this.currentSource.stop();
        this.currentSource.disconnect();
      } catch (e) {
        // Ignored if already stopped
      }
      this.currentSource = null;
    }
  }

  // Precise Millisecond Scheduled Playback
  public async schedulePlayback(
    audioUrl: string,
    trackId: string,
    serverScheduledTimestampMs: number, // UTC time when playback should begin on server clock
    startPositionOffsetSec: number = 0,
    playbackRate: number = 1.0
  ): Promise<void> {
    const ctx = this.initAudioContext();
    
    // Increment session ID & stop current playing source immediately
    this.currentPlaybackId++;
    const session = this.currentPlaybackId;
    this.stopActiveSource();

    const buffer = await this.loadAudioBuffer(audioUrl, trackId);

    // If playback was stopped or changed to another track while buffer loaded, cancel!
    if (this.currentPlaybackId !== session) {
      return;
    }

    // Stop active source again in case another node started
    this.stopActiveSource();

    const estServerTime = this.getEstimatedServerTime();
    const msUntilStart = serverScheduledTimestampMs - estServerTime;
    // Compensate for this device's own audio hardware pipeline delay — the gap
    // between "we told the audio graph to start" and "sound actually left the
    // speaker." Usually small on a phone speaker, larger on Bluetooth. Falls back
    // to 0 on browsers that don't expose it (notably Safari).
    const outputLatencySec = (ctx as any).outputLatency ?? ctx.baseLatency ?? 0;
    const secUntilStart = (msUntilStart / 1000) - outputLatencySec;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    source.connect(this.channelFilter!);

    this.activeServerScheduledTimestampMs = serverScheduledTimestampMs;
    this.activeStartPositionOffsetSec = startPositionOffsetSec;
    this.activeBasePlaybackRate = playbackRate;
    // Freeze the offset used to judge "elapsed time" for this playback session.
    // The live offset estimate keeps getting re-measured in the background and
    // genuinely wanders with real network jitter — re-deriving "expected
    // position" from whatever it currently reads would mean chasing a moving
    // target instead of correcting for real hardware clock-rate drift.
    this.frozenOffsetAtScheduleMs = this.smoothedClockOffset;

    if (secUntilStart > 0) {
      // Future scheduling: Start audio at exact context time in future
      const targetCtxTime = ctx.currentTime + secUntilStart;
      source.start(targetCtxTime, Math.max(0, startPositionOffsetSec));
      this.scheduledAudioContextStartTime = targetCtxTime;
      this.scheduledAudioOffsetSec = startPositionOffsetSec;
    } else {
      // Late join / catch-up: Calculate current offset position in track
      const elapsedTrackSec = Math.abs(secUntilStart) * playbackRate;
      const currentTrackPositionSec = startPositionOffsetSec + elapsedTrackSec;

      if (currentTrackPositionSec < buffer.duration) {
        source.start(ctx.currentTime, currentTrackPositionSec);
        this.scheduledAudioContextStartTime = ctx.currentTime;
        this.scheduledAudioOffsetSec = currentTrackPositionSec;
      }
    }

    this.currentSource = source;

    source.onended = () => {
      if (this.currentSource === source) {
        this.currentSource = null;
      }
    };

    this.startDriftCorrectionLoop();
  }

  // Continuously compare where this device's audio actually is against where the
  // server's shared clock says it should be, and pull it back into line — small
  // drift is corrected with a gentle, inaudible playback-rate nudge (the same trick
  // Snapcast/AirPlay use); anything large enough to suggest a stall or tab-throttle
  // gets a hard resync instead of slowly drifting further.
  private startDriftCorrectionLoop(): void {
    if (this.driftCorrectionIntervalId) clearInterval(this.driftCorrectionIntervalId);

    this.driftCorrectionIntervalId = setInterval(() => {
      if (!this.ctx || !this.currentSource) return;

      // Right at the moment scheduled playback actually begins, two independently
      // clamped clocks (estimated server time vs. this device's AudioContext time)
      // can cross zero a few hundred ms apart from each other even under perfect
      // sync, producing a brief false drift reading. Skip correction during that
      // narrow window instead of reacting to noise.
      const sinceActualStartSec = this.ctx.currentTime - this.scheduledAudioContextStartTime;
      if (sinceActualStartSec < 1.0) return;

      // Use the offset frozen at schedule time, not the live estimate — the
      // live one keeps getting re-measured and genuinely wanders with real
      // network jitter, which would otherwise make this comparison chase a
      // moving target instead of tracking real elapsed time.
      const estServerTime = Date.now() + this.frozenOffsetAtScheduleMs;
      const elapsedServerSec = Math.max(0, (estServerTime - this.activeServerScheduledTimestampMs) / 1000);
      const expectedPositionSec = this.activeStartPositionOffsetSec + elapsedServerSec * this.activeBasePlaybackRate;
      const actualPositionSec = this.getCurrentTrackPosition();
      const driftMs = (expectedPositionSec - actualPositionSec) * 1000;
      this.lastMeasuredDriftMs = driftMs;

      if (Math.abs(driftMs) > 200) {
        // Large drift — likely a throttled/backgrounded tab or a network stall.
        // A gentle rate nudge would take too long to catch up audibly; jump instead.
        this.hardResync(expectedPositionSec);
        return;
      }

      if (Math.abs(driftMs) < 6) {
        // Within tolerance — ease back to nominal speed.
        this.currentSource.playbackRate.setTargetAtTime(this.activeBasePlaybackRate, this.ctx.currentTime, 0.5);
        return;
      }

      // Proportional correction: bigger drift gets a firmer nudge instead of the
      // same flat ~2% regardless of size. This is what closes small, slowly
      // accumulating gaps (real hardware clocks never run at exactly the same
      // speed on two devices) instead of perpetually chasing a moving target.
      // Scaled and clamped to stay inaudible: 6ms -> ~0.3%, 100ms -> ~5%, 200ms cap ~8%.
      const proportionalAdjustment = Math.min(0.08, Math.abs(driftMs) / 2500);
      const corrected = driftMs > 0
        ? this.activeBasePlaybackRate * (1 + proportionalAdjustment)
        : this.activeBasePlaybackRate * (1 - proportionalAdjustment);
      this.currentSource.playbackRate.setTargetAtTime(corrected, this.ctx.currentTime, 0.3);
    }, 700);
  }

  private hardResync(targetPositionSec: number): void {
    if (!this.ctx || !this.currentSource) return;
    const buffer = this.currentSource.buffer;
    if (!buffer || targetPositionSec < 0 || targetPositionSec >= buffer.duration) return;

    const rate = this.activeBasePlaybackRate;
    this.stopActiveSource();

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = rate;
    source.connect(this.channelFilter!);
    source.start(this.ctx.currentTime, targetPositionSec);

    this.scheduledAudioContextStartTime = this.ctx.currentTime;
    this.scheduledAudioOffsetSec = targetPositionSec;
    this.currentSource = source;

    source.onended = () => {
      if (this.currentSource === source) {
        this.currentSource = null;
      }
    };

    this.startDriftCorrectionLoop();
  }

  public stopPlayback(): void {
    this.currentPlaybackId++;
    this.stopActiveSource();
  }

  public getCurrentTrackPosition(): number {
    if (!this.ctx || !this.currentSource) return 0;
    const elapsedSinceStart = Math.max(0, this.ctx.currentTime - this.scheduledAudioContextStartTime);
    return this.scheduledAudioOffsetSec + elapsedSinceStart;
  }

  public getFrequencyData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(64);
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  public getPerformanceMetrics(): PerformanceMetrics {
    return {
      ping: this.smoothedRTT,
      jitter: Math.abs(this.smoothedRTT - (this.rttHistory[this.rttHistory.length - 1] || 0)),
      offset: this.smoothedClockOffset,
      driftRate: 0.12,
      packetLoss: 0,
      bufferHealthPct: this.isLoadingTrack ? 40 : 100,
      audioContextState: this.ctx ? this.ctx.state : 'suspended'
    };
  }

  public getIsLoadingTrack(): boolean {
    return this.isLoadingTrack;
  }

  public getOutputLatencyMs(): number {
    if (!this.ctx) return 0;
    const latencySec = (this.ctx as any).outputLatency ?? this.ctx.baseLatency ?? 0;
    return latencySec * 1000;
  }

  public getLastMeasuredDriftMs(): number {
    return this.lastMeasuredDriftMs;
  }

  public getClockSampleCount(): number {
    return this.clockSampleCount;
  }
}

export const audioEngine = new AudioEngine();
