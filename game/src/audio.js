// Fully synthesised sound: no audio files. A lazy AudioContext (created on
// the first user gesture), a master gain, and small synth recipes for the
// engine, sirens, gunfire, impacts and UI blips, over a slow sunset pad.
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.master = null;
    this.engineNodes = null;
    this.sirenNodes = null;
    this.padOn = false;
  }
  ensure() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return true;
    }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return false;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.55;
      this.master.connect(this.ctx.destination);
      return true;
    } catch {
      return false;
    }
  }
  setMuted(m) {
    this.muted = m;
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(m ? 0 : 0.55, this.ctx.currentTime, 0.03);
    }
  }
  // ---- continuous voices -------------------------------------------------
  startPad() {
    if (!this.ensure() || this.padOn) return;
    this.padOn = true;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0.045;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass'; filter.frequency.value = 620;
    gain.connect(filter); filter.connect(this.master);
    // A lazy Cmaj9 wash: two detuned triangles per note, slow LFO on gain.
    [130.81, 196.0, 246.94, 329.63].forEach((f, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = f; o.detune.value = i * 4 - 6;
      o.connect(gain); o.start();
    });
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.07;
    const lfoGain = ctx.createGain(); lfoGain.gain.value = 0.018;
    lfo.connect(lfoGain); lfoGain.connect(gain.gain); lfo.start();
  }
  engine(on, speedNorm, rpm) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    if (on && !this.engineNodes) {
      const osc = ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = ctx.createOscillator();
      sub.type = 'square';
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass'; filter.frequency.value = 400; filter.Q.value = 2;
      const gain = ctx.createGain(); gain.gain.value = 0.0;
      osc.connect(filter); sub.connect(filter); filter.connect(gain); gain.connect(this.master);
      osc.start(); sub.start();
      this.engineNodes = { osc, sub, filter, gain };
    }
    if (!this.engineNodes) return;
    const n = this.engineNodes;
    const t = ctx.currentTime;
    if (!on) {
      n.gain.gain.setTargetAtTime(0, t, 0.08);
      return;
    }
    const f = 55 + rpm * 165 + speedNorm * 30;
    n.osc.frequency.setTargetAtTime(f, t, 0.05);
    n.sub.frequency.setTargetAtTime(f / 2, t, 0.05);
    n.filter.frequency.setTargetAtTime(320 + speedNorm * 900, t, 0.08);
    n.gain.gain.setTargetAtTime(0.05 + speedNorm * 0.075, t, 0.06);
  }
  siren(on) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    if (on && !this.sirenNodes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle'; osc.frequency.value = 700;
      const gain = ctx.createGain(); gain.gain.value = 0.016;
      osc.connect(gain); gain.connect(this.master);
      osc.start();
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 0.65;
      const lfoGain = ctx.createGain(); lfoGain.gain.value = 190;
      lfo.connect(lfoGain); lfoGain.connect(osc.frequency); lfo.start();
      this.sirenNodes = { osc, lfo, gain };
    } else if (!on && this.sirenNodes) {
      const n = this.sirenNodes;
      this.sirenNodes = null;
      n.gain.gain.setTargetAtTime(0, ctx.currentTime, 0.05);
      setTimeout(() => { try { n.osc.stop(); n.lfo.stop(); } catch { /* already stopped */ } }, 250);
    }
  }
  // ---- one shots -----------------------------------------------------------
  blip(freq, dur, type = 'sine', vol = 0.12, when = 0) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = type; o.frequency.value = freq;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }
  noise(dur, vol, freq = 1200, q = 0.8) {
    if (!this.ensure()) return;
    const ctx = this.ctx;
    const len = Math.max(1, Math.floor(ctx.sampleRate * dur));
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = ctx.createBufferSource(); src.buffer = buf;
    const filter = ctx.createBiquadFilter();
    filter.type = 'bandpass'; filter.frequency.value = freq; filter.Q.value = q;
    const g = ctx.createGain(); g.gain.value = vol;
    src.connect(filter); filter.connect(g); g.connect(this.master);
    src.start();
  }
  shot() { this.noise(0.14, 0.5, 900, 0.4); this.blip(160, 0.08, 'square', 0.2); }
  punch() { this.noise(0.09, 0.35, 300, 1); }
  crash(intensity = 1) { this.noise(0.28, 0.3 * intensity + 0.1, 220, 0.5); this.blip(70, 0.2, 'sine', 0.25); }
  pickup() { this.blip(880, 0.09, 'sine', 0.14); this.blip(1318, 0.14, 'sine', 0.14, 0.07); }
  cash() { [660, 880, 1100, 1470].forEach((f, i) => this.blip(f, 0.12, 'triangle', 0.13, i * 0.06)); }
  beep() { this.blip(1560, 0.06, 'square', 0.06); }
  denied() { this.blip(220, 0.16, 'sawtooth', 0.1); }
  door() { this.blip(340, 0.07, 'triangle', 0.12); this.blip(240, 0.09, 'triangle', 0.1, 0.06); }
}
