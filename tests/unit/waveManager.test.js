import { WaveManager, WAVES } from '../../public/js/game/WaveManager.js';
import { EventBus } from '../../public/js/game/EventBus.js';
import { EnemyFactory } from '../../public/js/game/EnemyFactory.js';
import { WORLD_WIDTH } from '../../public/js/game/constants.js';

function setup(waves = WAVES) {
  const bus = new EventBus();
  const spawned = [];
  const events = [];
  bus.on('wave:start', (e) => events.push(['start', e]));
  bus.on('wave:complete', (e) => events.push(['complete', e]));
  const manager = new WaveManager({ bus, waves, spawn: (type, x, y) => spawned.push({ type, x, y }), rng: () => 0.5 });
  return { manager, spawned, events };
}

const countOf = (wave) => wave.groups.reduce((n, g) => n + g.count, 0);

describe('Wave definitions', () => {
  test('there are five waves', () => {
    expect(WAVES).toHaveLength(5);
  });

  test('waves get bigger', () => {
    const counts = WAVES.map(countOf);
    for (let i = 1; i < counts.length; i += 1) expect(counts[i]).toBeGreaterThan(counts[i - 1]);
  });

  test('enemy variety grows and the final wave uses all five types', () => {
    const variety = WAVES.map((w) => new Set(w.groups.map((g) => g.type)).size);
    expect(variety[0]).toBeLessThan(variety[4]);
    expect(new Set(WAVES[4].groups.map((g) => g.type))).toEqual(new Set(new EnemyFactory().types));
  });

  test('every wave only uses enemy types the factory knows', () => {
    const known = new EnemyFactory().types;
    for (const wave of WAVES) for (const g of wave.groups) expect(known).toContain(g.type);
  });
});

describe('WaveManager', () => {
  test('startNextWave queues every enemy and emits wave:start', () => {
    const { manager, events } = setup();
    manager.startNextWave();
    expect(manager.waveNumber).toBe(1);
    expect(manager.total).toBe(countOf(WAVES[0]));
    expect(events[0]).toEqual(['start', { wave: 1, name: 'First Contact', total: 5 }]);
  });

  test('spawns enemies over time, not all at once', () => {
    const { manager, spawned } = setup();
    manager.startNextWave();
    manager.update(0.6, 0);
    expect(spawned.length).toBeGreaterThan(0);
    expect(spawned.length).toBeLessThan(manager.total);
  });

  test('wave completes only once all enemies spawned AND none remain alive', () => {
    const { manager, spawned, events } = setup();
    manager.startNextWave();
    for (let i = 0; i < 2000 && manager.queue.length; i += 1) manager.update(0.05, spawned.length);
    expect(spawned).toHaveLength(manager.total);
    // Enemies still on screen -> not complete yet.
    manager.update(0.05, 3);
    expect(events.find((e) => e[0] === 'complete')).toBeUndefined();
    expect(manager.remaining).toBe(3);
    for (let i = 0; i < manager.requiredKills; i += 1) manager.bus.emit('enemy:destroyed', { enemy: {} });
    manager.update(0.05, 0);
    expect(events.find((e) => e[0] === 'complete')).toEqual(['complete', { wave: 1, isFinal: false }]);
    expect(manager.progress).toBe(1);
  });

  test('counts kills and aliens remaining for the HUD, resetting each wave', () => {
    const { manager, spawned } = setup();
    manager.startNextWave();
    const total = countOf(WAVES[0]);
    expect(manager).toMatchObject({ kills: 0, remaining: total, total });
    manager.update(2, 0);
    expect(spawned.length).toBeGreaterThan(1);
    manager.bus.emit('enemy:destroyed', { enemy: { isBoss: false } });
    manager.update(0.01, spawned.length - 1); // one destroyed, the rest still on screen
    expect(manager.kills).toBe(1);
    expect(manager.remaining).toBe(total - 1);
    manager.bus.emit('enemy:destroyed', { enemy: { isBoss: true } }); // the boss is not a wave kill
    expect(manager.kills).toBe(1);
    manager.startNextWave();
    expect(manager).toMatchObject({ kills: 0, remaining: countOf(WAVES[1]) });
  });

  test('aliens that leave without being destroyed fail the wave; retryWave replays it', () => {
    const { manager, events } = setup();
    manager.startNextWave();
    expect(manager.requiredKills).toBe(Math.ceil(countOf(WAVES[0]) / 2));
    for (let i = 0; i < 2000 && manager.queue.length; i += 1) manager.update(0.05, 0); // all escape
    expect(manager.kills).toBe(0);
    expect(events.find((e) => e[0] === 'complete')).toBeUndefined();
    manager.retryWave();
    expect(manager).toMatchObject({ waveNumber: 1, kills: 0, remaining: countOf(WAVES[0]), active: true });
  });

  test('the last wave is flagged as final and no more waves start', () => {
    const tiny = [{ name: 'Only', groups: [{ type: 'scout', count: 1, interval: 0.1, pattern: 'line' }] }];
    const { manager, events } = setup(tiny);
    manager.startNextWave();
    manager.update(1, 0); // spawns the scout
    manager.bus.emit('enemy:destroyed', { enemy: {} }); // the player shoots it
    manager.update(0.1, 0); // scout gone -> complete
    expect(events.at(-1)).toEqual(['complete', { wave: 1, isFinal: true }]);
    expect(manager.startNextWave()).toBe(false);
  });

  test('a larger spawn interval multiplier (easy) stretches the wave out', () => {
    const normal = setup();
    const easy = setup();
    normal.manager.reset(1);
    easy.manager.reset(1.3);
    normal.manager.startNextWave();
    easy.manager.startNextWave();
    const lastNormal = normal.manager.queue.at(-1).time;
    const lastEasy = easy.manager.queue.at(-1).time;
    expect(lastEasy).toBeCloseTo(lastNormal * 1.3, 1);
  });

  test.each(['line', 'v', 'sides', 'random'])('pattern %s keeps every spawn on screen', (pattern) => {
    const { manager } = setup();
    const xs = manager.positions(pattern, 9);
    expect(xs).toHaveLength(9);
    for (const x of xs) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(WORLD_WIDTH);
    }
  });
});
