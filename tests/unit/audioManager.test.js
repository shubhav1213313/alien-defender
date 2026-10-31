/**
 * @jest-environment jsdom
 */
// Sound effects, music and the sound menu, with a fake Web Audio API.
import { AudioManager, DEFAULT_SETTINGS, SOUND_NAMES } from '../../public/js/audio/AudioManager.js';
import { SoundControls } from '../../public/js/ui/SoundControls.js';
import { EventBus } from '../../public/js/game/EventBus.js';
import { InputHandler } from '../../public/js/game/InputHandler.js';

// Records every node the AudioManager creates.
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.sampleRate = 8000;
    this.state = 'suspended';
    this.destination = {};
    this.oscillators = [];
    this.sources = [];
    FakeAudioContext.instances.push(this);
  }

  param() {
    return { setValueAtTime() {}, exponentialRampToValueAtTime() {}, setTargetAtTime: jest.fn() };
  }

  node(extra = {}) {
    return { connect: (n) => n, ...extra };
  }

  createGain() { return this.node({ gain: this.param() }); }

  createOscillator() {
    const osc = this.node({ frequency: this.param(), start: jest.fn(), stop: jest.fn() });
    this.oscillators.push(osc);
    return osc;
  }

  createBufferSource() {
    const src = this.node({ start: jest.fn(), stop: jest.fn() });
    this.sources.push(src);
    return src;
  }

  createBiquadFilter() { return this.node({ frequency: this.param() }); }

  createBuffer(channels, length) { return { getChannelData: () => new Float32Array(length) }; }

  resume() { this.state = 'running'; }
}
FakeAudioContext.instances = [];

function memoryStorage(initial = {}) {
  const data = { ...initial };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

function setup({ storage = memoryStorage(), unlocked = true } = {}) {
  jest.useFakeTimers();
  let clock = 0;
  const bus = new EventBus();
  const audio = new AudioManager({ bus, AudioContextClass: FakeAudioContext, storage, now: () => clock });
  if (unlocked) audio.unlock();
  return { bus, audio, storage, advance: (ms) => { clock += ms; } };
}

afterEach(() => {
  if (jest.isMockFunction(setTimeout)) jest.useRealTimers();
});

describe('AudioManager', () => {
  test('stays silent until the player interacts (browser autoplay rules), then resumes audio', () => {
    const { audio, bus } = setup({ unlocked: false });
    bus.emit('player:fire', { count: 1 });
    expect(audio.played).toEqual([]);
    expect(audio.unlock()).toBe(true);
    expect(audio.ctx.state).toBe('running');
  });

  test('every game event plays its sound effect', () => {
    const { audio, bus, advance } = setup();
    const events = [
      ['player:fire', {}, 'shoot'],
      ['enemy:destroyed', { enemy: { isBoss: false } }, 'explosion'],
      ['enemy:destroyed', { enemy: { isBoss: true } }, 'bossExplosion'],
      ['player:damaged', {}, 'hit'],
      ['earth:damaged', {}, 'earth'],
      ['wave:start', {}, 'waveStart'],
      ['wave:complete', {}, 'waveClear'],
      ['ability:activated', {}, 'ability'],
      ['ability:blocked', {}, 'denied'],
      ['ability:unlocked', {}, 'unlock'],
      ['special:offer', {}, 'offer'],
      ['quiz:answer', { correct: true }, 'correct'],
      ['quiz:answer', { correct: false }, 'wrong'],
      ['boss:spawn', {}, 'bossWarning'],
      ['game:over', {}, 'gameOver'],
      ['game:victory', {}, 'victory'],
    ];
    for (const [event, payload, sound] of events) {
      advance(1000);
      bus.emit(event, payload);
      expect(audio.played.at(-1)).toBe(sound);
    }
    expect(audio.ctx.oscillators.length).toBeGreaterThan(events.length);
    expect(SOUND_NAMES).toEqual(expect.arrayContaining(events.map(([, , s]) => s)));
  });

  test('rapid fire is throttled so it never becomes a wall of noise', () => {
    const { audio, bus, advance } = setup();
    for (let i = 0; i < 10; i += 1) { bus.emit('player:fire', {}); advance(10); }
    expect(audio.played.filter((n) => n === 'shoot')).toHaveLength(2);
  });

  test('mute silences effects and is remembered for the next visit', () => {
    const { audio, bus, storage } = setup();
    expect(audio.toggleMute()).toBe(true);
    bus.emit('wave:start', {});
    expect(audio.played).toEqual([]);
    const again = new AudioManager({ bus: new EventBus(), AudioContextClass: FakeAudioContext, storage });
    expect(again.settings.muted).toBe(true);
  });

  test('volumes are clamped, saved and applied to the audio graph', () => {
    const { audio, storage } = setup();
    audio.setMusicVolume(5);
    audio.setSfxVolume(-1);
    expect(audio.settings).toMatchObject({ musicVolume: 1, sfxVolume: 0 });
    expect(JSON.parse(storage.data['alienDefender.audio'])).toMatchObject({ musicVolume: 1, sfxVolume: 0 });
    expect(audio.musicGain.gain.setTargetAtTime).toHaveBeenCalled();
  });

  test('broken or blocked storage falls back to the defaults', () => {
    const broken = { getItem: () => { throw new Error('blocked'); }, setItem: () => { throw new Error('blocked'); } };
    const { audio } = setup({ storage: memoryStorage({ 'alienDefender.audio': '{not json' }) });
    expect(audio.settings).toEqual(DEFAULT_SETTINGS);
    const blocked = new AudioManager({ bus: new EventBus(), AudioContextClass: FakeAudioContext, storage: broken });
    expect(blocked.settings).toEqual(DEFAULT_SETTINGS);
    expect(() => blocked.toggleMute()).not.toThrow();
  });

  test('music follows the game: menu, battle, calm quiz, boss, ducked when paused', () => {
    const { audio, bus } = setup();
    expect(audio.mood).toBe('menu');
    bus.emit('state:change', { to: 'playing' });
    expect(audio.mood).toBe('battle');
    bus.emit('state:change', { to: 'quiz' });
    expect(audio.mood).toBe('calm');
    bus.emit('state:change', { to: 'playing' });
    bus.emit('boss:spawn', {});
    expect(audio.mood).toBe('boss');
    bus.emit('state:change', { to: 'paused' });
    expect(audio.ducked).toBe(true);
    bus.emit('boss:defeated', {});
    bus.emit('state:change', { to: 'victory' });
    expect(audio.mood).toBe('menu');
    expect(audio.ducked).toBe(false);
  });

  test('the music scheduler queues notes ahead on the audio clock', () => {
    const { audio } = setup();
    const before = audio.ctx.oscillators.length;
    jest.advanceTimersByTime(60);
    expect(audio.ctx.oscillators.length).toBeGreaterThan(before);
    audio.stopMusic();
    expect(audio.scheduler).toBeNull();
  });

  test('without Web Audio support nothing breaks', () => {
    const audio = new AudioManager({ bus: new EventBus(), AudioContextClass: null, storage: memoryStorage() });
    audio.AudioContextClass = null;
    expect(audio.supported).toBe(false);
    expect(audio.unlock()).toBe(false);
    expect(audio.play('shoot')).toBe(false);
  });
});

describe('Sound menu', () => {
  function mount() {
    document.body.innerHTML = '<div id="sound-controls"></div><p id="outside">x</p>';
    const { audio } = setup({ unlocked: false });
    const input = new InputHandler(window);
    new SoundControls({ audio, container: document.getElementById('sound-controls'), input });
    const q = (s) => document.querySelector(s);
    return { audio, q };
  }

  test('the Sound button opens Mute and the Music / Effects sliders', () => {
    const { q } = mount();
    expect(q('.sound-toggle').textContent).toBe('🔊 Sound');
    expect(q('.sound-panel').hidden).toBe(true);
    q('.sound-toggle').click();
    expect(q('.sound-panel').hidden).toBe(false);
    expect(q('.sound-toggle').getAttribute('aria-expanded')).toBe('true');
    expect(q('label[for="music-volume"]').textContent).toContain('Music');
    expect(q('label[for="sfx-volume"]').textContent).toContain('Effects');
    q('#outside').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(q('.sound-panel').hidden).toBe(true);
  });

  test('Mute button and the M key toggle sound; sliders change the volume', () => {
    const { audio, q } = mount();
    q('.sound-panel button').click();
    expect(audio.settings.muted).toBe(true);
    expect(q('.sound-toggle').textContent).toBe('🔇 Sound off');
    window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyM', key: 'm' }));
    expect(audio.settings.muted).toBe(false);
    const music = q('#music-volume');
    music.value = '20';
    music.dispatchEvent(new Event('input'));
    expect(audio.settings.musicVolume).toBeCloseTo(0.2);
  });

  test('the first click or key press unlocks audio', () => {
    const { audio, q } = mount();
    expect(audio.ctx).toBeNull();
    q('#outside').dispatchEvent(new Event('pointerdown', { bubbles: true }));
    expect(audio.ctx).not.toBeNull();
  });
});
