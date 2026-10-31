import { WORLD_WIDTH } from './constants.js';

// Five scripted waves. Each group spawns `count` enemies of one type, one
// every `interval` seconds, positioned by `pattern`. A group starts when the
// previous one finishes unless it gives an explicit `at` time, which lets
// groups overlap for more pressure in later waves.
export const WAVES = [
  {
    name: 'First Contact',
    groups: [
      { type: 'scout', count: 8, interval: 0.9, pattern: 'random' },
      { type: 'zigzag', count: 3, interval: 1.2, pattern: 'line' },
    ],
  },
  {
    name: 'Raiders',
    groups: [
      { type: 'scout', count: 6, interval: 0.35, pattern: 'line' },
      { type: 'zigzag', count: 6, interval: 0.9, pattern: 'random' },
      { type: 'kamikaze', count: 3, interval: 1.4, pattern: 'sides', at: 5 },
    ],
  },
  {
    name: 'Heavy Armor',
    groups: [
      { type: 'armored', count: 3, interval: 1.5, pattern: 'line' },
      { type: 'scout', count: 7, interval: 0.25, pattern: 'v', at: 2 },
      { type: 'sniper', count: 2, interval: 2, pattern: 'sides' },
      { type: 'zigzag', count: 4, interval: 0.8, pattern: 'random' },
    ],
  },
  {
    name: 'Crossfire',
    groups: [
      { type: 'sniper', count: 4, interval: 1.2, pattern: 'line' },
      { type: 'kamikaze', count: 5, interval: 1.1, pattern: 'sides', at: 3 },
      { type: 'zigzag', count: 6, interval: 0.7, pattern: 'random' },
      { type: 'armored', count: 2, interval: 2, pattern: 'line', at: 9 },
    ],
  },
  {
    name: 'Final Assault',
    groups: [
      { type: 'armored', count: 4, interval: 1.4, pattern: 'line' },
      { type: 'scout', count: 10, interval: 0.25, pattern: 'v', at: 1.5 },
      { type: 'sniper', count: 4, interval: 1.5, pattern: 'sides', at: 4 },
      { type: 'kamikaze', count: 6, interval: 0.9, pattern: 'random', at: 7 },
      { type: 'zigzag', count: 8, interval: 0.6, pattern: 'random' },
    ],
  },
];

// A wave only counts as cleared if the player destroyed at least this
// fraction of its aliens (rounded up); otherwise the same wave is retried.
export const REQUIRED_KILL_FRACTION = 0.5;

export class WaveManager {
  // spawn(type, x, y) is provided by the engine, so this class only decides
  // WHAT appears and WHEN - it never touches enemy objects directly.
  constructor({ bus, spawn, waves = WAVES, rng = Math.random }) {
    this.bus = bus;
    this.spawn = spawn;
    this.waves = waves;
    this.rng = rng;
    this.reset();
    // Aliens the player destroyed in the current wave. Escaped or rammed
    // aliens never send 'enemy:destroyed', so they are not counted.
    bus.on('enemy:destroyed', ({ enemy }) => {
      if (this.active && !(enemy && enemy.isBoss)) this.kills += 1;
    });
  }

  reset(spawnIntervalMultiplier = 1) {
    this.intervalMultiplier = spawnIntervalMultiplier;
    this.waveIndex = -1;
    this.queue = [];
    this.timer = 0;
    this.active = false;
    this.total = 0;
    this.spawned = 0;
    this.remaining = 0;
    this.kills = 0;
    this.requiredKills = 0;
  }

  get waveNumber() {
    return this.waveIndex + 1;
  }

  get totalWaves() {
    return this.waves.length;
  }

  get currentWave() {
    return this.waves[this.waveIndex] || null;
  }

  get nextWave() {
    return this.waves[this.waveIndex + 1] || null;
  }

  get hasMoreWaves() {
    return this.waveIndex + 1 < this.waves.length;
  }

  // Seconds of combat in the current wave (pauses and quizzes excluded).
  get combatTime() {
    return this.active ? this.timer : 0;
  }

  // Fraction of this wave's enemies dealt with (destroyed or escaped).
  get progress() {
    return this.total ? (this.total - this.remaining) / this.total : 0;
  }

  startNextWave() {
    if (!this.hasMoreWaves) return false;
    this.waveIndex += 1;
    return this.startCurrentWave();
  }

  // Starts the same wave again after it failed (not enough kills).
  retryWave() {
    this.waveIndex -= 1;
    return this.startNextWave();
  }

  startCurrentWave() {
    this.queue = this.buildQueue(this.currentWave);
    this.total = this.queue.length;
    this.spawned = 0;
    this.remaining = this.total;
    this.kills = 0;
    this.requiredKills = Math.ceil(this.total * REQUIRED_KILL_FRACTION);
    this.timer = 0;
    this.active = true;
    this.bus.emit('wave:start', { wave: this.waveNumber, name: this.currentWave.name, total: this.totalWaves });
    return true;
  }

  buildQueue(wave) {
    const queue = [];
    let cursor = 0.5 * this.intervalMultiplier;
    for (const group of wave.groups) {
      let t = group.at !== undefined ? group.at * this.intervalMultiplier : cursor;
      const xs = this.positions(group.pattern, group.count);
      for (let i = 0; i < group.count; i += 1) {
        queue.push({ time: t, type: group.type, x: xs[i] });
        t += group.interval * this.intervalMultiplier;
      }
      cursor = Math.max(cursor, t + 0.8 * this.intervalMultiplier);
    }
    return queue.sort((a, b) => a.time - b.time);
  }

  // Spawn formations across the top of the screen.
  positions(pattern, count) {
    const margin = 60;
    const span = WORLD_WIDTH - margin * 2;
    switch (pattern) {
      case 'line':
        return Array.from({ length: count }, (_, i) => margin + (count === 1 ? span / 2 : (span * i) / (count - 1)));
      case 'v':
        // Centre first, then pairs further out: a V when spawned in order.
        return Array.from({ length: count }, (_, i) => {
          const step = Math.ceil(i / 2) * 60;
          return WORLD_WIDTH / 2 + (i % 2 ? -step : step);
        });
      case 'sides':
        return Array.from({ length: count }, (_, i) => (i % 2 ? WORLD_WIDTH - margin : margin));
      default:
        return Array.from({ length: count }, () => margin + this.rng() * span);
    }
  }

  // aliveCount = enemies currently on screen. The wave ends once every enemy
  // has spawned and none remain: cleared if the player destroyed enough of
  // them, otherwise failed (the engine then retries the same wave).
  update(dt, aliveCount) {
    if (!this.active) return;
    this.timer += dt;
    while (this.queue.length && this.queue[0].time <= this.timer) {
      const { type, x } = this.queue.shift();
      this.spawn(type, x, -30);
      this.spawned += 1;
      aliveCount += 1;
    }
    this.remaining = this.total - this.spawned + aliveCount;
    if (this.queue.length === 0 && aliveCount === 0) {
      this.active = false;
      if (this.kills >= this.requiredKills) {
        this.bus.emit('wave:complete', { wave: this.waveNumber, isFinal: !this.hasMoreWaves });
      } else {
        this.bus.emit('wave:failed', { wave: this.waveNumber, kills: this.kills, required: this.requiredKills });
      }
    }
  }
}
