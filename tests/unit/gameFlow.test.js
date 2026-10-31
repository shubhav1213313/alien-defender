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
    expect(engine.banner).toEqual({ title: 'WAVE 2', subtitle: 'Test B' });
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
