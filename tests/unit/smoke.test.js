import { GameEngine } from '../../public/js/game/GameEngine.js';
import { GameState } from '../../public/js/game/GameStateManager.js';

// A stand-in 2D canvas context: every drawing method is a no-op, every
// property can be set. Lets render() run in Node to catch runtime errors in
// drawing code (typos, undefined fields) that unit tests would otherwise miss.
function stubCanvas() {
  const ctx = new Proxy({}, {
    get: (target, prop) => (prop in target ? target[prop] : () => {}),
    set: (target, prop, value) => { target[prop] = value; return true; },
  });
  return { getContext: () => ctx };
}

// Plays a whole game headlessly: the player sweeps left/right firing
// constantly and cannot die, so every wave and the boss must eventually fall.
test.each(['easy', 'normal', 'hard'])('a full %s game runs through five waves and the boss to victory with rendering', (difficulty) => {
  const held = new Set(['fire']);
  const input = { isDown: (a) => held.has(a), on: () => {}, releaseAll: () => {} };
  const engine = new GameEngine({ canvas: stubCanvas(), input });
  const waveStarts = [];
  engine.bus.on('wave:start', ({ wave }) => waveStarts.push(wave));
  const bossPhases = [];
  engine.bus.on('boss:phase', ({ phase }) => bossPhases.push(phase));

  engine.startGame(difficulty);
  engine.player.maxHealth = engine.player.health = 1e9;
  engine.earth.maxShield = engine.earth.shield = 1e9;

  const dt = 1 / 60;
  for (let frame = 0; frame < 15 * 60 * 60 && engine.isActive; frame += 1) {
    held.delete('left');
    held.delete('right');
    held.add(Math.floor(frame / 90) % 2 ? 'left' : 'right');
    engine.update(dt);
    engine.render();
  }

  expect(waveStarts).toEqual([1, 2, 3, 4, 5]);
  expect(engine.state.state).toBe(GameState.VICTORY);
  expect(engine.stats.wavesCleared).toBe(5);
  expect(engine.stats.bossDefeated).toBe(true);
  expect(bossPhases).toEqual([2, 3]);
  expect(engine.stats.enemiesDestroyed).toBeGreaterThan(20);
});
