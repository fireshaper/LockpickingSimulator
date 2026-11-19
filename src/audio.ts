// Synthesised lock sounds. Clicks are short filtered noise bursts: there are
// no audio files to load.

import type { SimEvent } from './sim/physics';

export class LockAudio {
  enabled = true;
  private ctx: AudioContext | null = null;
  private noise: AudioBuffer | null = null;

  /** Must be called from a user gesture before any sound can play. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') void this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    const len = Math.floor(this.ctx.sampleRate * 0.25);
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  play(e: SimEvent) {
    if (!this.enabled || !this.ctx) return;
    switch (e.type) {
      case 'set':
        this.click(3400, 0.012, 0.5 * e.strength);
        this.thump(190, 0.03, 0.18 * e.strength);
        break;
      case 'drop':
        this.click(1900, 0.02, 0.22);
        break;
      case 'overset':
        this.click(1200, 0.03, 0.3);
        break;
      case 'falseSet':
        this.click(2200, 0.025, 0.5);
        this.thump(120, 0.08, 0.4);
        break;
      case 'open':
        this.click(1500, 0.05, 0.7);
        this.thump(85, 0.22, 0.9);
        break;
    }
  }

  private click(freq: number, decay: number, gain: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = freq;
    bp.Q.value = 1.4;
    const g = ctx.createGain();
    const t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay * 4);
    src.connect(bp).connect(g).connect(ctx.destination);
    src.start(t, Math.random() * 0.1, decay * 5);
  }

  private thump(freq: number, decay: number, gain: number) {
    const ctx = this.ctx!;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    const t = ctx.currentTime;
    osc.frequency.setValueAtTime(freq * 1.6, t);
    osc.frequency.exponentialRampToValueAtTime(freq, t + decay);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0005, t + decay * 3);
    osc.connect(g).connect(ctx.destination);
    osc.start(t);
    osc.stop(t + decay * 3.2);
  }
}
