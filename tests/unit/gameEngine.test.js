import { GameEngine } from '../../public/js/game/GameEngine.js';
import { GameState } from '../../public/js/game/GameStateManager.js';
import { Projectile } from '../../public/js/game/Projectile.js';

// A controllable fake input: tests choose which actions are held, and can
// trigger one-shot actions just like a key press would.
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

// The engine runs headless (no canvas) so the simulation can be tested.
function newEngine() {
  const input = fakeInput();
  const engine = new GameEngine({ input });
  return { engine, input };
}

describe('GameEngine simulation', () => {
  test('nothing moves while in the menu', () => {
    const { engine, input } = newEngine();
    input.held.add('right');
    const x = engine.player.x;
    engine.update(0.1);
    expect(engine.player.x).toBe(x);
  });

  test('startGame shows the wave 1 banner, then starts wave 1', () => {
    const { engine } = newEngine();
    const started = jest.fn();
    const waveStart = jest.fn();
    engine.bus.on('game:start', started);
    engine.bus.on('wave:start', waveStart);
    expect(engine.startGame()).toBe(true);
    expect(engine.state.state).toBe(GameState.WAVE_TRANSITION);
    expect(engine.banner.title).toBe('WAVE 1');
    expect(started).toHaveBeenCalled();
    // A duplicate start (e.g. Enter + button click) is ignored.
    expect(engine.startGame()).toBe(false);
    for (let t = 0; t < 2.6; t += 0.05) engine.update(0.05);
    expect(engine.state.state).toBe(GameState.PLAYING);
    // Pressing Enter mid-wave must not restart the game either.
    engine.update(1);
    const wave = engine.waves.waveNumber;
    expect(engine.startGame()).toBe(false);
    expect(engine.waves.waveNumber).toBe(wave);
    expect(waveStart).toHaveBeenCalledWith(expect.objectContaining({ wave: 1, name: 'First Contact' }));
  });

  test('holding fire spawns projectiles that fly up and are removed off-screen', () => {
    const { engine, input } = newEngine();
    engine.startGame();
    input.held.add('fire');
    engine.update(0.016);
    expect(engine.projectiles).toHaveLength(1);
    input.held.delete('fire');
    for (let i = 0; i < 120; i += 1) engine.update(0.016);
    expect(engine.projectiles).toHaveLength(0);
  });

  test('pause key freezes the simulation and resumes it', () => {
    const { engine, input } = newEngine();
    engine.startGame();
    input.press('pause');
    expect(engine.state.state).toBe(GameState.PAUSED);
    input.held.add('left');
    const x = engine.player.x;
    engine.update(0.1);
    expect(engine.player.x).toBe(x);
    input.press('pause');
    input.held.add('left');
    engine.update(0.1);
    expect(engine.player.x).toBeLessThan(x);
  });

  test('enemy bullet hitting the player reduces shield/health and emits player:damaged', () => {
    const { engine } = newEngine();
    engine.startGame();
    const damaged = jest.fn();
    engine.bus.on('player:damaged', damaged);
    const { x, y } = engine.player;
    engine.projectiles.push(new Projectile({ x, y, vy: 0, owner: 'enemy', damage: 40 }));
    engine.update(0.016);
    expect(damaged).toHaveBeenCalled();
    expect(engine.player.shield).toBe(0);
    expect(engine.player.health).toBe(85);
  });

  test('player death triggers GAME_OVER and game:over', () => {
    const { engine } = newEngine();
    engine.startGame();
    const over = jest.fn();
    engine.bus.on('game:over', over);
    engine.damagePlayer(1000);
    expect(engine.state.state).toBe(GameState.GAME_OVER);
    expect(over).toHaveBeenCalled();
  });

  test('shooting an enemy to death awards points and emits enemy:destroyed', () => {
    const { engine } = newEngine();
    engine.startGame();
    const destroyed = jest.fn();
    engine.bus.on('enemy:destroyed', destroyed);
    const scout = engine.spawnEnemy('scout', 300, 200);
    engine.projectiles.push(new Projectile({ x: scout.x, y: scout.y, vy: 0, owner: 'player' }));
    engine.update(0.001);
    expect(scout.alive).toBe(false);
    expect(engine.enemies).toHaveLength(0);
    expect(engine.score).toBe(scout.points);
    expect(engine.stats.enemiesDestroyed).toBe(1);
    expect(destroyed).toHaveBeenCalledWith(expect.objectContaining({ type: 'scout', points: 100 }));
  });

  test('an enemy ramming the player is destroyed without awarding points', () => {
    const { engine } = newEngine();
    engine.startGame();
    const { x, y } = engine.player;
    engine.spawnEnemy('kamikaze', x, y);
    engine.update(0.001);
    expect(engine.enemies).toHaveLength(0);
    expect(engine.score).toBe(0);
    expect(engine.player.shield + engine.player.health).toBeLessThan(125);
  });

  test('enemy bullets are added to the world via spawnProjectile', () => {
    const { engine } = newEngine();
    engine.startGame();
    const tank = engine.spawnEnemy('armored', 300, 100);
    // Step at a normal frame rate (the real loop caps dt at 0.05s).
    for (let t = 0; t < tank.fireInterval + 0.05; t += 1 / 60) engine.update(1 / 60);
    expect(engine.projectiles.filter((p) => p.owner === 'enemy').length).toBe(3);
  });

  test('restart after game over gives a fresh player', () => {
    const { engine } = newEngine();
    engine.startGame();
    engine.damagePlayer(1000);
    engine.startGame();
    expect(engine.isActive).toBe(true);
    expect(engine.score).toBe(0);
    expect(engine.waves.waveNumber).toBe(0);
    expect(engine.player.health).toBe(engine.player.maxHealth);
    expect(engine.projectiles).toHaveLength(0);
  });
});
