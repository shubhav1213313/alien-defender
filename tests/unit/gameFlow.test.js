import { GameEngine } from '../../public/js/game/GameEngine.js';
import { GameState } from '../../public/js/game/GameStateManager.js';

function fakeInput() {
  const held = new Set();
  const listeners = {};
  return {
    held,
    isDown: (a) => held.has(a),
    on: (a, cb) => { (listeners[a] ||= []).push(cb); },
    press: (a) => (listeners[a] || []).forEach((cb) => cb()),
    releaseAll: () => held.clear(),
  };
}

const step = (engine, seconds) => {
  for (let t = 0; t < seconds; t += 1 / 60) engine.update(1 / 60);
};

// A one-scout wave so wave/victory flow can be tested quickly.
const TINY_WAVES = [
  { name: 'Test A', groups: [{ type: 'scout', count: 1, interval: 0.1, pattern: 'line' }] },
  { name: 'Test B', groups: [{ type: 'scout', count: 1, interval: 0.1, pattern: 'line' }] },
];

function killAllEnemies(engine) {
  for (const enemy of [...engine.enemies]) engine.hitEnemy(enemy, 999);
}

describe('Wave flow, Earth shield and end conditions', () => {
  test('an alien escaping past the player damages the Earth shield', () => {
    const engine = new GameEngine({ input: fakeInput() });
    engine.startGame('normal');
    const before = engine.earth.shield;
    const armored = engine.spawnEnemy('armored', 300, 700);
    engine.update(0.016);
    expect(armored.alive).toBe(false);
    expect(engine.earth.shield).toBe(before - armored.escapeDamage);
  });

  test('Earth shield reaching zero ends the game with reason earthFallen', () => {
    const engine = new GameEngine({ input: fakeInput() });
    const over = jest.fn();
    engine.bus.on('game:over', over);
    engine.startGame('normal');
    engine.damageEarth(1000);
    expect(engine.state.state).toBe(GameState.GAME_OVER);
    expect(over).toHaveBeenCalledWith(expect.objectContaining({ reason: 'earthFallen', difficulty: 'normal' }));
  });

  test('clearing a wave awards a bonus and automatically opens the Knowledge Arena', () => {
    const engine = new GameEngine({ input: fakeInput() });
    const arenaOpen = jest.fn();
    engine.bus.on('arena:open', arenaOpen);
    engine.waves.waves = TINY_WAVES;
    engine.startGame('normal');
    step(engine, 2.6); // banner
    step(engine, 1); // scout spawns
    expect(engine.enemies).toHaveLength(1);
    killAllEnemies(engine);
    const scoreAfterKill = engine.score;
    engine.update(0.016);
    expect(engine.score).toBe(scoreAfterKill + 500);
    expect(engine.state.state).toBe(GameState.QUIZ);
    expect(arenaOpen).toHaveBeenCalledWith({ kind: 'wave', wave: 1, postBoss: false, nextWave: 2 });
    // Finishing the arena leads to the next wave banner.
    engine.finishArena();
    expect(engine.state.state).toBe(GameState.WAVE_TRANSITION);
    expect(engine.banner).toEqual({ title: 'WAVE 2 STARTING', subtitle: 'Test B' });
  });

  test('clearing the final wave summons the boss (no arena before the boss)', () => {
    const engine = new GameEngine({ input: fakeInput() });
    const bossSpawn = jest.fn();
    const waveStart = jest.fn();
    engine.bus.on('boss:spawn', bossSpawn);
    engine.waves.waves = TINY_WAVES;
    engine.startGame('hard');
    engine.bus.on('wave:start', waveStart);
    for (let wave = 0; wave < 2; wave += 1) {
      step(engine, 2.6);
      step(engine, 1);
      killAllEnemies(engine);
      engine.update(0.016);
      if (engine.state.is(GameState.QUIZ)) engine.finishArena();
    }
    expect(engine.state.state).toBe(GameState.WAVE_TRANSITION);
    expect(engine.banner.title).toBe('WARNING');
    step(engine, 2.6);
    expect(bossSpawn).toHaveBeenCalled();
    expect(engine.boss.alive).toBe(true);
    expect(waveStart).toHaveBeenCalledTimes(2); // no "wave 3"
  });

  test('destroying the boss opens the post-boss bonus arena, then victory', () => {
    const engine = new GameEngine({ input: fakeInput() });
    const victory = jest.fn();
    const arenaOpen = jest.fn();
    engine.bus.on('game:victory', victory);
    engine.bus.on('arena:open', arenaOpen);
    engine.waves.waves = TINY_WAVES.slice(0, 1);
    engine.startGame('normal');
    step(engine, 2.6);
    step(engine, 1);
    killAllEnemies(engine);
    engine.update(0.016);
    step(engine, 2.6); // warning banner
    step(engine, 4); // boss entrance
    engine.spawnEnemy('scout', 100, 100);
    engine.boss.phaseShield = 0;
    engine.hitEnemy(engine.boss, engine.boss.health);
    expect(engine.state.state).toBe(GameState.QUIZ);
    expect(arenaOpen).toHaveBeenLastCalledWith({ kind: 'bonus', wave: 5, postBoss: true, nextWave: null });
    expect(engine.enemies.filter((e) => e.alive)).toHaveLength(0);
    expect(engine.projectiles.some((p) => p.owner === 'enemy')).toBe(false);
    expect(victory).not.toHaveBeenCalled();
    engine.finishArena();
    expect(engine.state.state).toBe(GameState.VICTORY);
    expect(victory).toHaveBeenCalledWith(expect.objectContaining({ reason: 'victory', bossDefeated: true }));
  });

  test('ramming the boss hurts the player but does not destroy the boss', () => {
    const engine = new GameEngine({ input: fakeInput() });
    engine.startGame();
    engine.spawnBoss();
    engine.bus.emit('collision:playerRammed', { enemy: engine.boss, damage: 40 });
    expect(engine.boss.alive).toBe(true);
    expect(engine.player.health + engine.player.shield).toBeLessThan(125);
  });

  test('pausing during a wave banner resumes back into the banner', () => {
    const input = fakeInput();
    const engine = new GameEngine({ input });
    engine.startGame();
    input.press('pause');
    expect(engine.state.state).toBe(GameState.PAUSED);
    const timer = engine.transitionTimer;
    step(engine, 1);
    expect(engine.transitionTimer).toBe(timer); // frozen while paused
    input.press('pause');
    expect(engine.state.state).toBe(GameState.WAVE_TRANSITION);
  });

  test('no damage is applied after the game has ended', () => {
    const engine = new GameEngine({ input: fakeInput() });
    const over = jest.fn();
    engine.bus.on('game:over', over);
    engine.startGame();
    engine.damagePlayer(1000);
    engine.damageEarth(1000);
    expect(over).toHaveBeenCalledTimes(1);
  });
});

// Easy Wave 1 examples: 6 aliens, at least 3 must be destroyed by the player.
// (A 6-alien test wave; the real waves keep their own alien counts.)
describe('Minimum kills to clear a wave', () => {
  const SIX = [
    { name: 'Six', groups: [{ type: 'scout', count: 6, interval: 0.1, pattern: 'line' }] },
    { name: 'Next', groups: [{ type: 'scout', count: 1, interval: 0.1, pattern: 'line' }] },
  ];

  // Spawns the whole wave, the player destroys `kills` aliens and the rest
  // reach Earth (moved past the bottom edge, so they escape on the next frame).
  function playWave1(kills) {
    const engine = new GameEngine({ input: fakeInput(), rng: () => 0.99 });
    const events = { complete: 0, failed: [], arena: 0, escaped: 0 };
    engine.bus.on('wave:complete', () => { events.complete += 1; });
    engine.bus.on('wave:failed', (e) => events.failed.push(e));
    engine.bus.on('arena:open', () => { events.arena += 1; });
    engine.bus.on('enemy:escaped', () => { events.escaped += 1; });
    engine.waves.waves = SIX;
    engine.startGame('easy');
    step(engine, 2.6); // "WAVE 1 STARTING" banner
    step(engine, 2); // all six spawn (easy spawns more slowly)
    expect(engine.enemies).toHaveLength(6);
    expect(engine.waves).toMatchObject({ total: 6, requiredKills: 3, kills: 0, remaining: 6 });
    const earthBefore = engine.earth.shield;
    const [hit, missed] = [engine.enemies.slice(0, kills), engine.enemies.slice(kills)];
    for (const e of hit) engine.hitEnemy(e, 999);
    for (const e of missed) e.y = 2000;
    engine.update(0.016); // escapes resolve
    engine.update(0.016); // the wave ends
    return { engine, events, earthBefore, escapedCount: missed.length };
  }

  test.each([[0], [2]])('kills %i of 6 (rest escape) -> WAVE FAILED, no quiz, the same wave is retried', (kills) => {
    const { engine, events, earthBefore, escapedCount } = playWave1(kills);
    expect(events.escaped).toBe(escapedCount);
    expect(engine.earth.shield).toBeLessThan(earthBefore); // escapes still damage Earth
    expect(engine.waves.kills).toBe(kills); // escapes never count as kills
    expect(events.failed).toEqual([{ wave: 1, kills, required: 3 }]);
    expect(events.complete).toBe(0);
    expect(events.arena).toBe(0);
    expect(engine.stats.wavesCleared).toBe(0);
    expect(engine.state.state).toBe(GameState.WAVE_TRANSITION);
    expect(engine.banner.title).toBe('WAVE FAILED — NOT ENOUGH KILLS');
    step(engine, 2.6);
    // Retry: still wave 1, counters reset, not wave 2.
    expect(engine.state.state).toBe(GameState.PLAYING);
    expect(engine.waves).toMatchObject({ waveNumber: 1, kills: 0, remaining: 6, total: 6 });
  });

  test.each([[3], [6]])('kills %i of 6 -> WAVE CLEARED, then the Banana quiz, then wave 2', (kills) => {
    const { engine, events } = playWave1(kills);
    expect(engine.waves.kills).toBe(kills);
    expect(events.failed).toEqual([]);
    expect(events.complete).toBe(1);
    expect(events.arena).toBe(1);
    expect(engine.state.state).toBe(GameState.QUIZ);
    engine.finishArena();
    expect(engine.banner.title).toBe('WAVE 2 STARTING');
    step(engine, 2.6);
    expect(engine.waves).toMatchObject({ waveNumber: 2, kills: 0 });
  });
});
