// ============================================================
// PATIENT ZERO — Audio Manager
// Web Audio API bioluminescent ocean soundscape
// ============================================================

class AudioManager {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private droneOsc: OscillatorNode | null = null;
  private shimmerOsc: OscillatorNode | null = null;
  private lfo: OscillatorNode | null = null;
  private pingInterval: ReturnType<typeof setInterval> | null = null;
  private started = false;

  start(): void {
    if (this.started) return;
    try {
      this.ctx = new AudioContext();
      this.masterGain = this.ctx.createGain();
      this.masterGain.gain.value = 0.15;
      this.masterGain.connect(this.ctx.destination);

      this.buildDrone();
      this.buildShimmer();
      this.schedulePings();

      this.started = true;
      console.log('[AudioManager] Ocean ambiance started');
    } catch (err) {
      console.warn('[AudioManager] Web Audio API unavailable', err);
    }
  }

  private buildDrone(): void {
    if (!this.ctx || !this.masterGain) return;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 200;
    filter.connect(this.masterGain);

    this.droneOsc = this.ctx.createOscillator();
    this.droneOsc.type = 'sine';
    this.droneOsc.frequency.value = 55; // deep sub-bass hum

    const droneGain = this.ctx.createGain();
    droneGain.gain.value = 0.3;
    this.droneOsc.connect(droneGain);
    droneGain.connect(filter);
    this.droneOsc.start();
  }

  private buildShimmer(): void {
    if (!this.ctx || !this.masterGain) return;

    this.shimmerOsc = this.ctx.createOscillator();
    this.shimmerOsc.type = 'sine';
    this.shimmerOsc.frequency.value = 440;

    const shimmerGain = this.ctx.createGain();
    shimmerGain.gain.value = 0.01; // very subtle

    // LFO modulates shimmer gain (tremolo)
    this.lfo = this.ctx.createOscillator();
    this.lfo.frequency.value = 0.08;
    const lfoGain = this.ctx.createGain();
    lfoGain.gain.value = 0.008;
    this.lfo.connect(lfoGain);
    lfoGain.connect(shimmerGain.gain);

    this.shimmerOsc.connect(shimmerGain);
    shimmerGain.connect(this.masterGain);

    this.shimmerOsc.start();
    this.lfo.start();
  }

  private schedulePings(): void {
    const ping = () => {
      if (!this.ctx || !this.masterGain) return;
      const osc = this.ctx.createOscillator();
      const env = this.ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = 660 + Math.random() * 440;
      env.gain.setValueAtTime(0, this.ctx.currentTime);
      env.gain.linearRampToValueAtTime(0.04, this.ctx.currentTime + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, this.ctx.currentTime + 1.2);
      osc.connect(env);
      env.connect(this.masterGain);
      osc.start();
      osc.stop(this.ctx.currentTime + 1.3);
    };

    this.pingInterval = setInterval(
      ping,
      3_000 + Math.random() * 5_000
    );
  }

  triggerNewPairSound(): void {
    if (!this.ctx || !this.masterGain) return;
    // Rising chord: 3 oscillators a fifth and octave apart
    const freqs = [220, 330, 440];
    freqs.forEach((freq, i) => {
      const osc = this.ctx!.createOscillator();
      const env = this.ctx!.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      env.gain.setValueAtTime(0, this.ctx!.currentTime);
      env.gain.linearRampToValueAtTime(0.06, this.ctx!.currentTime + 0.05 + i * 0.05);
      env.gain.exponentialRampToValueAtTime(0.0001, this.ctx!.currentTime + 2.0);
      osc.connect(env);
      env.connect(this.masterGain!);
      osc.start(this.ctx!.currentTime + i * 0.08);
      osc.stop(this.ctx!.currentTime + 2.5);
    });
  }

  setIntensity(level: number): void {
    if (!this.masterGain) return;
    const clamped = Math.max(0, Math.min(1, level));
    this.masterGain.gain.value = 0.05 + clamped * 0.25;
  }

  stop(): void {
    if (this.pingInterval) clearInterval(this.pingInterval);
    this.droneOsc?.stop();
    this.shimmerOsc?.stop();
    this.lfo?.stop();
    this.ctx?.close();
    this.started = false;
  }
}

export const audioManager = new AudioManager();
