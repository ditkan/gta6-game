// audio.js — every sound in Port Azura is synthesised with WebAudio: engine,
// siren, gunfire, impacts, cash and a lazy sunset chord pad. No audio files.

export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.engineNodes = null;
    this.sirenNodes = null;
    this.musicNodes = null;
  }

  // Must be called from a user gesture at least once.
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
  }

  setMuted(muted) {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.55;
  }

  blip(freq, dur, type = 'square', vol = 0.16, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(Math.max(20, slideTo), t + dur);
    gain.gain.setValueAtTime(vol, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + dur);
  }

  noise(dur, vol = 0.3, lowpass = 1200) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buffer = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lowpass;
    const gain = this.ctx.createGain();
    gain.gain.value = vol;
    src.connect(filter).connect(gain).connect(this.master);
    src.start(t);
  }

  shot() { this.noise(0.14, 0.5, 2600); this.blip(160, 0.09, 'square', 0.22, 55); }
  punch() { this.noise(0.08, 0.35, 700); }
  hitFlesh() { this.noise(0.1, 0.3, 500); this.blip(90, 0.1, 'sine', 0.25, 45); }
  crash(intensity = 1) { this.noise(0.28, 0.4 * intensity, 900); this.blip(70, 0.25, 'triangle', 0.3 * intensity, 35); }
  cash() { this.blip(1320, 0.09, 'square', 0.14); setTimeout(() => this.blip(1760, 0.14, 'square', 0.14), 70); }
  pickup() { this.blip(660, 0.08, 'sine', 0.2, 990); }
  objective() { this.blip(523, 0.1, 'triangle', 0.2); setTimeout(() => this.blip(784, 0.16, 'triangle', 0.2), 90); }
  fail() { this.blip(220, 0.22, 'sawtooth', 0.16, 110); }
  uiClick() { this.blip(880, 0.05, 'square', 0.1); }

  // Continuous engine hum whose pitch follows the throttle; call every frame.
  engine(rpm01, driving) {
    if (!this.ctx) return;
    if (!driving) {
      if (this.engineNodes) {
        this.engineNodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.08);
      }
      return;
    }
    if (!this.engineNodes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'sawtooth';
      const sub = this.ctx.createOscillator();
      sub.type = 'square';
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 700;
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      osc.connect(filter);
      sub.connect(filter);
      filter.connect(gain).connect(this.master);
      osc.start();
      sub.start();
      this.engineNodes = { osc, sub, gain, filter };
    }
    const t = this.ctx.currentTime;
    const f = 55 + rpm01 * 165;
    this.engineNodes.osc.frequency.setTargetAtTime(f, t, 0.05);
    this.engineNodes.sub.frequency.setTargetAtTime(f / 2, t, 0.05);
    this.engineNodes.filter.frequency.setTargetAtTime(500 + rpm01 * 1400, t, 0.05);
    this.engineNodes.gain.gain.setTargetAtTime(this.muted ? 0 : 0.055 + rpm01 * 0.05, t, 0.06);
  }

  // Two-tone police siren, started/stopped with the chase.
  siren(on) {
    if (!this.ctx) return;
    if (on && !this.sirenNodes) {
      const osc = this.ctx.createOscillator();
      osc.type = 'triangle';
      const gain = this.ctx.createGain();
      gain.gain.value = 0.0;
      gain.gain.setTargetAtTime(this.muted ? 0 : 0.028, this.ctx.currentTime, 0.4);
      const lfo = this.ctx.createOscillator();
      lfo.frequency.value = 0.55;
      const lfoGain = this.ctx.createGain();
      lfoGain.gain.value = 130;
      lfo.connect(lfoGain).connect(osc.frequency);
      osc.frequency.value = 830;
      osc.connect(gain).connect(this.master);
      osc.start();
      lfo.start();
      this.sirenNodes = { osc, gain, lfo };
    } else if (!on && this.sirenNodes) {
      const nodes = this.sirenNodes;
      this.sirenNodes = null;
      nodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.15);
      setTimeout(() => { try { nodes.osc.stop(); nodes.lfo.stop(); } catch { /* already stopped */ } }, 600);
    }
  }

  // Slow sunset pad: three detuned triangles through a lowpass, chords cycle.
  music(on) {
    if (!this.ctx) return;
    if (on && !this.musicNodes) {
      const chords = [[220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7], [164.8, 196, 246.9]];
      const oscs = [];
      const gain = this.ctx.createGain();
      gain.gain.value = 0;
      gain.gain.setTargetAtTime(this.muted ? 0 : 0.035, this.ctx.currentTime, 2);
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.value = 900;
      filter.connect(gain).connect(this.master);
      for (let i = 0; i < 3; i++) {
        const osc = this.ctx.createOscillator();
        osc.type = 'triangle';
        osc.frequency.value = chords[0][i];
        osc.connect(filter);
        osc.start();
        oscs.push(osc);
      }
      let step = 0;
      const timer = setInterval(() => {
        if (!this.musicNodes) return;
        step = (step + 1) % chords.length;
        const t = this.ctx.currentTime;
        oscs.forEach((osc, i) => osc.frequency.setTargetAtTime(chords[step][i], t, 1.2));
      }, 5200);
      this.musicNodes = { oscs, gain, timer };
    } else if (!on && this.musicNodes) {
      const nodes = this.musicNodes;
      this.musicNodes = null;
      clearInterval(nodes.timer);
      nodes.gain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.3);
      setTimeout(() => nodes.oscs.forEach((o) => { try { o.stop(); } catch { /* done */ } }), 1200);
    }
  }
}
