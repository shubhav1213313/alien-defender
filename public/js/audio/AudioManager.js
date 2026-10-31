// Sound effects and background music, synthesised with the Web Audio API.
// There are no audio files: every sound is built from oscillators and
// noise, so nothing is downloaded and there are no licensing issues.
//
// Event-driven like the rest of the UI: the AudioManager only LISTENS to
// game events on the EventBus (player:fire, enemy:destroyed, ...) and never
// changes the game itself.
//
// Browsers block audio until the player interacts with the page, so the
// AudioContext is created on the first click or key press (unlock()).
// Settings (mute, music and effects volume) are remembered per browser.
const STORAGE_KEY = 'alienDefender.audio';
export const DEFAULT_SETTINGS = Object.freeze({ muted: false, musicVolume: 0.5, sfxVolume: 0.7 });

// Music: a small step sequencer. Each mood is 16 steps of bass + arpeggio
// (semitones from A2, null = rest) at its own tempo.
const MOODS = {
  menu: {
    bpm: 84,
    bass: [0, null, null, null, -4, null, null, null, -2, null, null, null, -5, null, null, null],
    arp: [12, 15, 19, 24, 8, 12, 15, 20, 10, 14, 17, 22, 7, 10, 14, 19],
    arpWave: 'triangle',
  },
  battle: {
    bpm: 132,
    bass: [0, 0, 12, 0, 0, 12, 0, 10, -4, -4, 8, -4, -2, -2, 10, -2],
    arp: [24, null, 19, null, 22, null, 19, 15, 20, null, 15, null, 22, null, 17, null],
    arpWave: 'square',
  },
  boss: {
    bpm: 150,
    bass: [0, 0, 1, 0, 0, 1, 0, 6, -1, -1, 0, -1, -1, 0, 6, 5],
    arp: [24, 25, 24, 18, 24, 25, 30, 18, 23, 24, 23, 17, 23, 24, 29, 30],
    arpWave: 'sawtooth',
  },
  calm: {
    bpm: 70,
    bass: [0, null, null, null, null, null, null, null, 5, null, null, null, null, null, null, null],
    arp: [12, null, 19, null, 16, null, 19, null, 17, null, 21, null, 24, null, 21, null],
    arpWave: 'sine',
  },
};
// Minimum gap between repeats, so rapid fire does not become a wall of noise.
const THROTTLE_MS = { shoot: 70, explosion: 40, hit: 90, earth: 150 };
const A2 = 110;
const freq = (semitones) => A2 * 2 ** (semitones / 12);

function loadSettings(storage) {
  try {
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    if (!saved) return { ...DEFAULT_SETTINGS };
    const clamp = (v, d) => (typeof v === 'number' && v >= 0 && v <= 1 ? v : d);
    return {
      muted: saved.muted === true,
      musicVolume: clamp(saved.musicVolume, DEFAULT_SETTINGS.musicVolume),
      sfxVolume: clamp(saved.sfxVolume, DEFAULT_SETTINGS.sfxVolume),
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function defaultStorage() {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export class AudioManager {
  constructor({ bus, AudioContextClass, storage = defaultStorage(), now = () => Date.now() } = {}) {
    this.bus = bus;
    this.AudioContextClass = AudioContextClass
      || (typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext)) || null;
    this.storage = storage;
    this.now = now;
    this.settings = storage ? loadSettings(storage) : { ...DEFAULT_SETTINGS };
    this.ctx = null;
    this.mood = 'menu';
    this.ducked = false;
    this.bossActive = false;
    this.step = 0;
    this.nextStepTime = 0;
    this.scheduler = null;
    this.lastPlayed = {};
    this.played = []; // names of effects played (handy for tests and debugging)
    this.listeners = [];
    if (bus) this.listen(bus);
  }

  get supported() {
    return Boolean(this.AudioContextClass);
  }

  // ---- Settings ---------------------------------------------------------------

  onChange(callback) {
    this.listeners.push(callback);
  }

  update(changes) {
    this.settings = { ...this.settings, ...changes };
    try {
      if (this.storage) this.storage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
    } catch {
      // Private mode / blocked storage: the setting still applies for this visit.
    }
    this.applyVolumes();
    this.listeners.forEach((cb) => cb(this.settings));
  }

  toggleMute() {
    this.update({ muted: !this.settings.muted });
    return this.settings.muted;
  }

  setMusicVolume(value) {
    this.update({ musicVolume: Math.min(1, Math.max(0, Number(value))) });
  }

  setSfxVolume(value) {
    this.update({ sfxVolume: Math.min(1, Math.max(0, Number(value))) });
  }

  // ---- Audio graph ------------------------------------------------------------

  // Called on the first user gesture (browsers block audio before that).
  unlock() {
    if (!this.supported) return false;
    if (!this.ctx) {
      this.ctx = new this.AudioContextClass();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.connect(this.master);
      this.sfxGain = this.ctx.createGain();
      this.sfxGain.connect(this.master);
      this.noise = this.makeNoiseBuffer();
      this.applyVolumes();
      this.startMusic();
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    return true;
  }

  applyVolumes() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const { muted, musicVolume, sfxVolume } = this.settings;
    this.master.gain.setTargetAtTime(muted ? 0 : 1, t, 0.03);
    // Music sits under the effects; quieter still while paused.
    this.musicGain.gain.setTargetAtTime(musicVolume * 0.32 * (this.ducked ? 0.35 : 1), t, 0.08);
    this.sfxGain.gain.setTargetAtTime(sfxVolume * 0.6, t, 0.03);
  }

  makeNoiseBuffer() {
    const length = this.ctx.sampleRate;
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = Math.random() * 2 - 1;
    return buffer;
  }

  // One enveloped oscillator note, optionally sliding to `to` Hz.
  tone({ type = 'square', from, to = from, start = 0, duration = 0.15, volume = 0.3, output = this.sfxGain }) {
    const t = this.ctx.currentTime + start;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(from, t);
    if (to !== from) osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + duration);
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(volume, t + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    osc.connect(gain).connect(output);
    osc.start(t);
    osc.stop(t + duration + 0.02);
  }

  // A burst of filtered noise (explosions, impacts, drums).
  burst({ start = 0, duration = 0.3, volume = 0.4, filter = 1200, sweepTo = 200, output = this.sfxGain }) {
    const t = this.ctx.currentTime + start;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    const lowpass = this.ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(filter, t);
    lowpass.frequency.exponentialRampToValueAtTime(Math.max(40, sweepTo), t + duration);
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(lowpass).connect(gain).connect(output);
    src.start(t);
    src.stop(t + duration + 0.02);
  }

  // ---- Sound effects ----------------------------------------------------------

  play(name) {
    if (!this.ctx || this.settings.muted) return false;
    const gap = THROTTLE_MS[name] || 0;
    const now = this.now();
    if (gap && name in this.lastPlayed && now - this.lastPlayed[name] < gap) return false;
    this.lastPlayed[name] = now;
    const effect = SOUND_EFFECTS[name];
    if (!effect) return false;
    effect(this);
    this.played.push(name);
    if (this.played.length > 50) this.played.shift();
    return true;
  }

  listen(bus) {
    bus.on('player:fire', () => this.play('shoot'));
    bus.on('enemy:destroyed', ({ enemy }) => this.play(enemy && enemy.isBoss ? 'bossExplosion' : 'explosion'));
    bus.on('player:damaged', () => this.play('hit'));
    bus.on('earth:damaged', () => this.play('earth'));
    bus.on('wave:start', () => this.play('waveStart'));
    bus.on('wave:complete', () => this.play('waveClear'));
    bus.on('ability:activated', () => this.play('ability'));
    bus.on('ability:blocked', () => this.play('denied'));
    bus.on('ability:unlocked', () => this.play('unlock'));
    bus.on('special:offer', () => this.play('offer'));
    bus.on('quiz:answer', ({ correct }) => this.play(correct ? 'correct' : 'wrong'));
    bus.on('boss:spawn', () => { this.bossActive = true; this.play('bossWarning'); this.updateMood(); });
    bus.on('boss:phase', () => this.play('bossWarning'));
    bus.on('boss:defeated', () => { this.bossActive = false; this.updateMood(); });
    bus.on('game:start', () => { this.bossActive = false; });
    bus.on('game:over', () => this.play('gameOver'));
    bus.on('game:victory', () => this.play('victory'));
    bus.on('state:change', ({ to }) => this.onStateChange(to));
  }

  // ---- Music --------------------------------------------------------------------

  onStateChange(state) {
    this.state = state;
    this.ducked = state === 'paused';
    this.applyVolumes();
    this.updateMood();
  }

  updateMood() {
    const s = this.state;
    let mood = 'menu';
    if (s === 'playing' || s === 'waveTransition' || s === 'paused') mood = this.bossActive ? 'boss' : 'battle';
    else if (s === 'quiz') mood = 'calm';
    this.setMood(mood);
  }

  setMood(mood) {
    if (mood === this.mood) return;
    this.mood = mood;
    this.step = 0; // start the new pattern from its first beat
  }

  startMusic() {
    if (this.scheduler || !this.ctx) return;
    this.nextStepTime = this.ctx.currentTime + 0.1;
    // Look-ahead scheduling: every 50 ms, queue the notes due in the next
    // 150 ms on the audio clock, so timing stays tight even if the game
    // loop is busy.
    this.scheduler = setInterval(() => this.scheduleMusic(), 50);
  }

  stopMusic() {
    clearInterval(this.scheduler);
    this.scheduler = null;
  }

  scheduleMusic() {
    const ahead = this.ctx.currentTime + 0.15;
    while (this.nextStepTime < ahead) {
      const pattern = MOODS[this.mood];
      const stepLength = 60 / pattern.bpm / 2; // eighth notes
      const start = this.nextStepTime - this.ctx.currentTime;
      const bass = pattern.bass[this.step];
      const arp = pattern.arp[this.step];
      if (bass !== null) this.tone({ type: 'triangle', from: freq(bass), start, duration: stepLength * 1.8, volume: 0.5, output: this.musicGain });
      if (arp !== null) this.tone({ type: pattern.arpWave, from: freq(arp), start, duration: stepLength * 0.9, volume: 0.12, output: this.musicGain });
      // A soft drum on the beat in battle and boss music.
      if ((this.mood === 'battle' || this.mood === 'boss') && this.step % 4 === 0) {
        this.burst({ start, duration: 0.12, volume: 0.25, filter: 300, sweepTo: 60, output: this.musicGain });
      }
      this.step = (this.step + 1) % 16;
      this.nextStepTime += stepLength;
    }
  }
}

// Recipes for each effect (frequencies in Hz, times in seconds).
const SOUND_EFFECTS = {
  shoot: (a) => a.tone({ type: 'square', from: 880, to: 220, duration: 0.09, volume: 0.12 }),
  explosion: (a) => {
    a.burst({ duration: 0.35, volume: 0.45, filter: 2200, sweepTo: 120 });
    a.tone({ type: 'sine', from: 160, to: 50, duration: 0.25, volume: 0.3 });
  },
  bossExplosion: (a) => {
    for (let i = 0; i < 4; i += 1) a.burst({ start: i * 0.18, duration: 0.9, volume: 0.6, filter: 1800, sweepTo: 60 });
    a.tone({ type: 'sine', from: 120, to: 30, duration: 1.4, volume: 0.5 });
  },
  hit: (a) => {
    a.tone({ type: 'sawtooth', from: 300, to: 80, duration: 0.2, volume: 0.3 });
    a.burst({ duration: 0.15, volume: 0.3, filter: 900, sweepTo: 200 });
  },
  earth: (a) => a.tone({ type: 'sine', from: 90, to: 45, duration: 0.4, volume: 0.45 }),
  waveStart: (a) => a.tone({ type: 'sawtooth', from: 180, to: 720, duration: 0.6, volume: 0.18 }),
  waveClear: (a) => [523, 659, 784].forEach((f, i) => a.tone({ type: 'triangle', from: f, start: i * 0.09, duration: 0.25, volume: 0.25 })),
  ability: (a) => {
    a.tone({ type: 'sine', from: 300, to: 1200, duration: 0.3, volume: 0.25 });
    a.tone({ type: 'triangle', from: 600, to: 2400, duration: 0.3, volume: 0.12 });
  },
  denied: (a) => a.tone({ type: 'square', from: 140, duration: 0.18, volume: 0.15 }),
  unlock: (a) => [523, 659, 784, 1047].forEach((f, i) => a.tone({ type: 'square', from: f, start: i * 0.1, duration: 0.3, volume: 0.15 })),
  offer: (a) => [988, 1319].forEach((f, i) => a.tone({ type: 'sine', from: f, start: i * 0.12, duration: 0.2, volume: 0.25 })),
  correct: (a) => [659, 988].forEach((f, i) => a.tone({ type: 'triangle', from: f, start: i * 0.1, duration: 0.22, volume: 0.28 })),
  wrong: (a) => a.tone({ type: 'sawtooth', from: 220, to: 110, duration: 0.35, volume: 0.2 }),
  bossWarning: (a) => [0, 0.45].forEach((s) => a.tone({ type: 'sawtooth', from: 440, to: 220, start: s, duration: 0.4, volume: 0.22 })),
  gameOver: (a) => [392, 330, 262, 196].forEach((f, i) => a.tone({ type: 'triangle', from: f, start: i * 0.28, duration: 0.45, volume: 0.28 })),
  victory: (a) => [523, 659, 784, 1047, 784, 1047].forEach((f, i) => a.tone({ type: 'square', from: f, start: i * 0.13, duration: i === 5 ? 0.7 : 0.2, volume: 0.15 })),
};
export const SOUND_NAMES = Object.freeze(Object.keys(SOUND_EFFECTS));
