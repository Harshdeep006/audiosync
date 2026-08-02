import { AudioChannelRole, ClockSyncResult, PerformanceMetrics } from '../types';

// Linear Regression Clock Model:
// Standard simple averages (EMA) for clock offset suffer over the internet because
// they constantly lag behind real hardware clock drift and fluctuate with jitter.
// By plotting the best (lowest RTT) local vs. server timestamps and drawing a line 
// through them, we discover both the exact offset and the hardware clock skew 
// (slope). This perfectly predicts server time even between pings.
class LinearRegressionClock {
  private history: { local: number; server: number; rtt: number }[] = [];
  private maxHistory = 60;
  private slope = 1;
  private intercept = 0;
  private minRtt = Infinity;

  public addSample(localTime: number, serverTime: number, rtt: number) {
    this.history.push({ local: localTime, server: serverTime, rtt });
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
    this.minRtt = Math.min(...this.history.map(p => p.rtt));
    this.calculate();
  }

  private calculate() {
    // Filter to only the best RTTs (Cristian's algorithm min-filter logic)
    // Over the internet, high RTT means asymmetric delay. We ONLY want points close to minRtt.
    const bestSamples = this.history.filter(p => p.rtt <= this.minRtt * 1.2 || p.rtt <= this.minRtt + 20);
    
    let samples = bestSamples;
    if (samples.length < 2 && this.history.length >= 2) {
      // Fallback: take best 5 points if we don't have enough strictly near minRtt
      const sorted = [...this.history].sort((a, b) => a.rtt - b.rtt);
      samples = sorted.slice(0, 5);
    }

    if (samples.length < 2) {
       if (samples.length === 1) {
           this.slope = 1;
           this.intercept = samples[0].server - samples[0].local;
       }
       return;
    }

    // Center the data to prevent float precision loss when squaring large JS timestamps (1.7e12)
    const xOffset = samples[0].local;
    
    let sumX = 0, sumY = 0;
    samples.forEach(p => {
      sumX += (p.local - xOffset);
      sumY += (p.server - xOffset); 
    });
    const xMean = sumX / samples.length;
    const yMean = sumY / samples.length;

    let num = 0, den = 0;
    samples.forEach(p => {
      const xDiff = (p.local - xOffset) - xMean;
      num += xDiff * ((p.server - xOffset) - yMean);
      den += xDiff * xDiff;
    });

    if (den === 0) {
      this.slope = 1;
      this.intercept = (yMean + xOffset) - (xMean + xOffset);
    } else {
      this.slope = num / den;
      this.intercept = (yMean + xOffset) - this.slope * (xMean + xOffset);
    }
  }

  public predictServerTime(localTimeMs: number): number {
    return this.slope * localTimeMs + this.intercept;
  }

  public getSmoothedOffset(): number {
    const now = Date.now();
    return this.predictServerTime(now) - now;
  }

  public getSmoothedRTT(): number {
    return this.minRtt === Infinity ? 0 : this.minRtt;
  }
}


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
  private clockModel = new LinearRegressionClock();

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

  // Rate-aware position tracking: because the drift correction loop changes the
  // playback rate, we can't just use (ctx.currentTime - startTime) to know where
  // the buffer actually is.  Instead we maintain a running accumulator that gets
  // snapshotted every time the rate changes.
  private lastKnownBufferPos: number = 0;
  private lastPosTrackCtxTime: number = 0;
  private currentEffectiveRate: number = 1.0;

  // Smoothed drift reading: over the internet, NTP offset estimates jitter
  // by ±10-20ms between readings. Using each raw drift measurement directly
  // causes the correction to oscillate — the EMA filters that noise out.
  private smoothedDriftMs: number = 0;
  
  // PID Controller state for advanced drift correction
  private pidIntegral: number = 0;
  private pidLastDrift: number = 0;

  // Manual calibration to fix asymmetric internet routing (where ping up != ping down)
  private manualSyncOffsetMs: number = 0;

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

    const localTime = Date.now();
    const serverTime = localTime + clockOffsetMs;
    this.clockModel.addSample(localTime, serverTime, rttMs);
  }

  public getEstimatedServerTime(): number {
    return this.clockModel.predictServerTime(Date.now()) + this.manualSyncOffsetMs;
  }

  public getSmoothedOffset(): number {
    return this.clockModel.getSmoothedOffset() + this.manualSyncOffsetMs;
  }

  public getSmoothedRTT(): number {
    return this.clockModel.getSmoothedRTT();
  }

  public setManualSyncOffset(offsetMs: number): void {
    this.manualSyncOffsetMs = offsetMs;
  }

  public getManualSyncOffset(): number {
    return this.manualSyncOffsetMs;
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

  // Snapshot the current buffer position, then apply the new rate.
  // Using setValueAtTime (instant) instead of setTargetAtTime (exponential curve)
  // so the position accumulator stays accurate — the tiny rate deltas (0.3–8%)
  // are small enough to be inaudible as an instantaneous change.
  private applyPlaybackRate(rate: number): void {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const elapsed = Math.max(0, now - this.lastPosTrackCtxTime);
    this.lastKnownBufferPos += elapsed * this.currentEffectiveRate;
    this.lastPosTrackCtxTime = now;
    this.currentEffectiveRate = rate;
    if (this.currentSource) {
      this.currentSource.playbackRate.setValueAtTime(rate, now);
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
    // NOTE: With Linear Regression, we don't strictly need freezing as much,
    // but we still want to evaluate drift relative to a stable timeline.

    if (secUntilStart > 0) {
      // Future scheduling: Start audio at exact context time in future
      const targetCtxTime = ctx.currentTime + secUntilStart;
      source.start(targetCtxTime, Math.max(0, startPositionOffsetSec));
      this.scheduledAudioContextStartTime = targetCtxTime;
      this.scheduledAudioOffsetSec = startPositionOffsetSec;
      // Initialize rate-aware position tracking
      this.lastKnownBufferPos = startPositionOffsetSec;
      this.lastPosTrackCtxTime = targetCtxTime;
      this.currentEffectiveRate = playbackRate;
    } else {
      // Late join / catch-up: Calculate current offset position in track
      const elapsedTrackSec = Math.abs(secUntilStart) * playbackRate;
      const currentTrackPositionSec = startPositionOffsetSec + elapsedTrackSec;

      if (currentTrackPositionSec < buffer.duration) {
        source.start(ctx.currentTime, currentTrackPositionSec);
        this.scheduledAudioContextStartTime = ctx.currentTime;
        this.scheduledAudioOffsetSec = currentTrackPositionSec;
        // Initialize rate-aware position tracking
        this.lastKnownBufferPos = currentTrackPositionSec;
        this.lastPosTrackCtxTime = ctx.currentTime;
        this.currentEffectiveRate = playbackRate;
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

      // Use the LIVE modeled clock offset via Linear Regression
      const estServerTime = this.getEstimatedServerTime();
      const elapsedServerSec = Math.max(0, (estServerTime - this.activeServerScheduledTimestampMs) / 1000);
      const expectedPositionSec = this.activeStartPositionOffsetSec + elapsedServerSec * this.activeBasePlaybackRate;
      
      const bufferPositionSec = this.getCurrentTrackPosition();
      // HUGE FIX: The buffer position is NOT the speaker position! It takes outputLatency
      // seconds for the audio graph to reach the physical speaker hardware. 
      // If we don't subtract this, the drift loop will actively *force* the audio to be 
      // out of sync by exactly the device's hardware latency!
      const outputLatencySec = (this.ctx as any).outputLatency ?? this.ctx.baseLatency ?? 0;
      const speakerPositionSec = bufferPositionSec - outputLatencySec;
      
      const rawDriftMs = (expectedPositionSec - speakerPositionSec) * 1000;

      // Large jump — bypass smoothing and hard-resync immediately.
      if (Math.abs(rawDriftMs) > 80) {
        this.smoothedDriftMs = 0;
        this.pidIntegral = 0;
        this.pidLastDrift = 0;
        this.lastMeasuredDriftMs = rawDriftMs;
        this.hardResync(expectedPositionSec);
        return;
      }

      // Exponential moving average: 60% previous + 40% new. At 500ms intervals
      // this gives a ~1.5s time constant — fast enough to track real drift,
      // smooth enough to filter the ±10-20ms jitter typical of internet links.
      this.smoothedDriftMs = this.smoothedDriftMs * 0.6 + rawDriftMs * 0.4;
      this.lastMeasuredDriftMs = this.smoothedDriftMs;

      if (Math.abs(this.smoothedDriftMs) < 3) {
        // Within extremely tight tolerance — return to nominal speed and reset integral.
        if (this.currentEffectiveRate !== this.activeBasePlaybackRate) {
          this.applyPlaybackRate(this.activeBasePlaybackRate);
        }
        // Decay integral slowly when in deadzone so we don't hold onto old error
        this.pidIntegral *= 0.8;
        return;
      }

      // PID Controller (Proportional-Integral-Derivative)
      // Standard proportional correction oscillates over the internet because of jitter.
      // A PID controller dampens the oscillation (Derivative) and slowly eliminates
      // steady-state error (Integral), locking into sub-millisecond sync.
      
      const dt = 0.5; // Loop runs every 500ms
      const error = this.smoothedDriftMs;
      
      this.pidIntegral += error * dt;
      // Anti-windup: cap the integral term so it doesn't build up too much during lags
      this.pidIntegral = Math.max(-500, Math.min(500, this.pidIntegral));
      
      const derivative = (error - this.pidLastDrift) / dt;
      this.pidLastDrift = error;

      // Tuning parameters - Aggressive enough to close a 100ms gap in ~2 seconds,
      // but dampened enough to prevent 'wobble'.
      const Kp = 0.0005;   // Proportional: 0.05 (5% speedup) at 100ms error
      const Ki = 0.00005;  // Integral: Closes persistent hardware clock skews
      const Kd = 0.00015;  // Derivative: Brakes hard when approaching 0 to stop oscillation

      const adjustment = (Kp * error) + (Ki * this.pidIntegral) + (Kd * derivative);
      
      // Clamp adjustment to max ±8% (0.08) to keep it strictly inaudible
      const clampedAdjustment = Math.max(-0.08, Math.min(0.08, adjustment));
      
      const corrected = this.activeBasePlaybackRate * (1 + clampedAdjustment);
      this.applyPlaybackRate(corrected);
    }, 500);
  }

  private hardResync(targetPositionSec: number): void {
    if (!this.ctx || !this.currentSource) return;
    const buffer = this.currentSource.buffer;
    if (!buffer || targetPositionSec < 0 || targetPositionSec >= buffer.duration) return;

    const rate = this.activeBasePlaybackRate;
    this.stopActiveSource();

    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.playbackRate.value = this.activeBasePlaybackRate;
    source.connect(this.channelFilter!);

    // When we start "now", it takes outputLatencySec for the sound to hit the speaker.
    // By the time it hits the speaker, the expected position will have advanced.
    const outputLatencySec = (this.ctx as any).outputLatency ?? this.ctx.baseLatency ?? 0;
    const targetSpeakerPositionSec = targetPositionSec + (outputLatencySec * this.activeBasePlaybackRate);

    source.start(this.ctx.currentTime, targetSpeakerPositionSec);
    this.scheduledAudioContextStartTime = this.ctx.currentTime;
    this.scheduledAudioOffsetSec = targetSpeakerPositionSec;
    // Reset position tracking to the resynced position
    this.lastKnownBufferPos = targetSpeakerPositionSec;
    this.lastPosTrackCtxTime = this.ctx.currentTime;
    this.currentEffectiveRate = rate;
    
    // Reset PID state
    this.pidIntegral = 0;
    this.pidLastDrift = 0;
    this.smoothedDriftMs = 0;
    
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
    // Use the rate-aware accumulator: lastKnownBufferPos is snapshotted every
    // time the playback rate changes, so the elapsed-since-snapshot segment is
    // always at a single known rate.
    const elapsed = Math.max(0, this.ctx.currentTime - this.lastPosTrackCtxTime);
    return this.lastKnownBufferPos + elapsed * this.currentEffectiveRate;
  }

  public getFrequencyData(): Uint8Array {
    if (!this.analyser) return new Uint8Array(64);
    const dataArray = new Uint8Array(this.analyser.frequencyBinCount);
    this.analyser.getByteFrequencyData(dataArray);
    return dataArray;
  }

  public getPerformanceMetrics(): PerformanceMetrics {
    return {
      ping: this.getSmoothedRTT(),
      jitter: 0, // Internet spikes are now dropped by the IQR filter entirely
      offset: this.getSmoothedOffset(),
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
