// Fully synthesized audio: engine hum, weapons, explosions and a small original pulse-sequencer score.
export class Sound {
  constructor() {
    this.ctx = null;
    this.sfxOn = true;
    this.musicOn = true;
    this.tempo = 116;
    this.playing = false;
  }

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = (this.ctx = new AC());
    this.master = c.createGain();
    this.master.gain.value = 0.8;
    const comp = c.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 4;
    this.master.connect(comp).connect(c.destination);
    this.sfx = c.createGain(); this.sfx.gain.value = this.sfxOn ? 0.9 : 0; this.sfx.connect(this.master);
    this.mus = c.createGain(); this.mus.gain.value = this.musicOn ? 0.32 : 0; this.mus.connect(this.master);

    const len = c.sampleRate * 2;
    this.noise = c.createBuffer(1, len, c.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;

    // engine bed
    this.eng = c.createGain(); this.eng.gain.value = 0; this.eng.connect(this.sfx);
    this.engF = c.createBiquadFilter(); this.engF.type = 'lowpass'; this.engF.frequency.value = 300; this.engF.Q.value = 3;
    this.engF.connect(this.eng);
    this.engO = [55, 55.6, 110.4].map((f, i) => {
      const o = c.createOscillator(); o.type = i === 2 ? 'triangle' : 'sawtooth'; o.frequency.value = f;
      o.connect(this.engF); o.start(); return o;
    });
    const n = c.createBufferSource(); n.buffer = this.noise; n.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 700; nf.Q.value = 0.7;
    this.engN = c.createGain(); this.engN.gain.value = 0.08;
    n.connect(nf).connect(this.engN).connect(this.eng); n.start();
    this.engNF = nf;

    this.step = 0;
    this.nextT = c.currentTime + 0.1;
    this.timer = setInterval(() => this.schedule(), 25);
  }

  setSfx(on) { this.sfxOn = on; if (this.sfx) this.sfx.gain.setTargetAtTime(on ? 0.9 : 0, this.ctx.currentTime, 0.05); }
  setMusic(on) { this.musicOn = on; if (this.mus) this.mus.gain.setTargetAtTime(on ? 0.32 : 0, this.ctx.currentTime, 0.1); }
  suspend() { if (this.ctx && this.ctx.state === 'running') this.ctx.suspend(); }
  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  engine(speedN, level) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const f = 48 + speedN * 40;
    this.engO[0].frequency.setTargetAtTime(f, t, 0.2);
    this.engO[1].frequency.setTargetAtTime(f * 1.012, t, 0.2);
    this.engO[2].frequency.setTargetAtTime(f * 2.01, t, 0.2);
    this.engF.frequency.setTargetAtTime(220 + speedN * 700, t, 0.2);
    this.engNF.frequency.setTargetAtTime(500 + speedN * 1400, t, 0.2);
    this.eng.gain.setTargetAtTime(level * 0.22, t, 0.3);
  }

  _env(node, t, a, peak, dur) {
    node.gain.setValueAtTime(0.0001, t);
    node.gain.exponentialRampToValueAtTime(peak, t + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  }

  _noise(t, dur, type, f0, f1, peak, dest = this.sfx) {
    const c = this.ctx;
    const s = c.createBufferSource(); s.buffer = this.noise;
    s.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = c.createBiquadFilter(); f.type = type; f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    const g = c.createGain(); this._env(g, t, 0.005, peak, dur);
    s.connect(f).connect(g).connect(dest);
    s.start(t, Math.random()); s.stop(t + dur + 0.05);
  }

  _tone(t, type, f0, f1, dur, peak, dest = this.sfx, a = 0.005) {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = c.createGain(); this._env(g, t, a, peak, dur);
    o.connect(g).connect(dest);
    o.start(t); o.stop(t + dur + 0.05);
  }

  laser() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'sawtooth', 1500 + Math.random() * 200, 170, 0.17, 0.12);
    this._tone(t, 'square', 760, 120, 0.12, 0.05);
  }
  enemyLaser() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'square', 620, 240, 0.2, 0.05);
  }
  explosion(size = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.5 + size * 0.5, 'lowpass', 2400, 60, 0.5 * Math.min(1.6, size));
    this._tone(t, 'sine', 120, 28, 0.4 + size * 0.3, 0.6 * Math.min(1.4, size));
  }
  hit() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._noise(t, 0.35, 'highpass', 3000, 400, 0.4);
    this._tone(t, 'square', 90, 40, 0.3, 0.3);
  }
  spark() {
    if (!this.ctx) return;
    this._noise(this.ctx.currentTime, 0.08, 'highpass', 5000, 3000, 0.08);
  }
  whoosh() {
    if (!this.ctx) return;
    this._noise(this.ctx.currentTime, 0.4, 'bandpass', 400, 2600, 0.25);
  }
  pickup() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [660, 880, 1320, 1760].forEach((f, i) => this._tone(t + i * 0.06, 'sine', f, f, 0.18, 0.14));
  }
  alarm() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this._tone(t, 'square', 880, 880, 0.09, 0.05);
    this._tone(t + 0.13, 'square', 660, 660, 0.09, 0.05);
  }
  gate() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    [[220, 277.2, 329.6], [246.9, 311.1, 370], [293.7, 370, 440]].forEach((ch, i) =>
      ch.forEach(f => this._tone(t + i * 0.16, 'triangle', f, f, 0.5, 0.08, this.sfx, 0.02)));
    this._noise(t, 0.9, 'bandpass', 300, 4000, 0.15);
  }
  click() {
    if (!this.ctx) return;
    this._tone(this.ctx.currentTime, 'square', 1200, 900, 0.05, 0.04);
  }

  // ---- music ----
  startMusic(sector = 1) { this.tempo = Math.min(150, 112 + sector * 4); this.playing = true; this.step = 0; }
  stopMusic() { this.playing = false; }

  schedule() {
    const c = this.ctx;
    if (!c || c.state !== 'running') return;
    const spb = 60 / this.tempo / 4; // 16th notes
    while (this.nextT < c.currentTime + 0.12) {
      if (this.playing) this.playStep(this.step, this.nextT, spb);
      this.nextT += spb;
      this.step = (this.step + 1) % 64;
    }
  }

  playStep(step, t, spb) {
    // Original progression in D minor: Dm – Bb – C – Am (bass roots, Hz)
    const roots = [73.42, 58.27, 65.41, 55.0];
    const root = roots[(step >> 4) & 3];
    const s = step & 15;
    const bassPat = [1, 0, 1, 1, 0, 1, 1, 0, 1, 0, 1, 1, 0, 1, 2, 1];
    if (bassPat[s]) {
      const f = bassPat[s] === 2 ? root * 2 : root;
      const ctx = this.ctx;
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = f;
      const fl = ctx.createBiquadFilter(); fl.type = 'lowpass'; fl.Q.value = 6;
      fl.frequency.setValueAtTime(900, t); fl.frequency.exponentialRampToValueAtTime(140, t + spb * 1.6);
      const g = ctx.createGain(); this._env(g, t, 0.004, 0.28, spb * 1.8);
      osc.connect(fl).connect(g).connect(this.mus); osc.start(t); osc.stop(t + spb * 2);
    }
    if (s % 4 === 0) this._tone(t, 'sine', 140, 38, 0.22, 0.55, this.mus);              // kick
    if (s % 2 === 1) this._noise(t, 0.04, 'highpass', 8000, 7000, s % 4 === 3 ? 0.1 : 0.05, this.mus); // hats
    if (s === 4 || s === 12) this._noise(t, 0.16, 'bandpass', 1800, 900, 0.22, this.mus); // snare
    // arpeggio lead every other bar
    if ((step >> 4) % 2 === 1 && s % 2 === 0) {
      const arp = [4, 3, 2, 3, 4, 6, 4, 3];
      const ratio = [1, 1.189, 1.335, 1.498, 2, 2.378, 2.669][arp[(s >> 1) & 7]];
      this._tone(t, 'square', root * 4 * ratio, root * 4 * ratio, spb * 1.4, 0.035, this.mus);
    }
  }
}
