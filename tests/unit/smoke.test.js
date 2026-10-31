import { GameEngine } from '../../public/js/game/GameEngine.js';

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

test('90 seconds of simulated play with rendering runs without errors', () => {
  const held = new Set(['fire']);
  const input = { isDown: (a) => held.has(a), on: () => {}, releaseAll: () => {} };
  const engine = new GameEngine({ canvas: stubCanvas(), input, useTrainingSpawner: true });
  // Make the player effectively immortal so the whole run is exercised.
  engine.startGame();
  engine.player.maxHealth = engine.player.health = 1e9;

  const dt = 1 / 60;
  for (let frame = 0; frame < 90 * 60; frame += 1) {
    // Sweep left and right so the player meets every enemy type.
    held.delete('left');
    held.delete('right');
    held.add(Math.floor(frame / 90) % 2 ? 'left' : 'right');
    engine.update(dt);
    engine.render();
  }

  expect(engine.stats.shotsFired).toBeGreaterThan(100);
  expect(engine.stats.enemiesDestroyed).toBeGreaterThan(10);
  expect(engine.score).toBeGreaterThan(0);
});
