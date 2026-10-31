import { GameEngine } from '../../public/js/game/GameEngine.js';
import { GameState } from '../../public/js/game/GameStateManager.js';
const { calculateRewards } = require('../../src/services/arenaRules');

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
// constantly and cannot die. Every Knowledge Arena is "answered" with the
// given score using the REAL server reward rules, then closed.
function playFullGame({ difficulty, arenaDifficulty, arenaCorrect, useAbilities }) {
  const held = new Set(['fire']);
  const input = { isDown: (a) => held.has(a), on: () => {}, releaseAll: () => {} };
  const engine = new GameEngine({ canvas: stubCanvas(), input });
  const log = { waves: [], arenas: [], bossPhases: [], abilityUses: 0 };
  engine.bus.on('wave:start', ({ wave }) => log.waves.push(wave));
  engine.bus.on('arena:open', ({ wave, postBoss }) => log.arenas.push(postBoss ? 'post-boss' : wave));
  engine.bus.on('boss:phase', ({ phase }) => log.bossPhases.push(phase));
  engine.bus.on('ability:activated', () => { log.abilityUses += 1; });

  engine.startGame(difficulty);
  engine.player.maxHealth = engine.player.health = 1e9;
  engine.earth.maxShield = engine.earth.shield = 1e9;

  const dt = 1 / 60;
  let arenaCount = 0;
  for (let frame = 0; frame < 20 * 60 * 60; frame += 1) {
    if (engine.state.is(GameState.VICTORY) || engine.state.is(GameState.GAME_OVER)) break;
    if (engine.state.is(GameState.QUIZ)) {
      arenaCount += 1;
      const reward = calculateRewards({ wave: engine.arena.wave, difficulty: arenaDifficulty, correct: arenaCorrect });
      expect(engine.applyArenaRewards(`arena-${arenaCount}`, reward)).toBe(true);
      expect(engine.finishArena()).toBe(true);
      continue;
    }
    held.delete('left');
    held.delete('right');
    held.add(Math.floor(frame / 90) % 2 ? 'left' : 'right');
    if (useAbilities && frame % 120 === 0) {
      engine.abilities.addEnergy(100);
      engine.activateAbility(1 + ((frame / 120) % 4));
    }
    engine.update(dt);
    engine.render();
  }
  return { engine, log };
}

test.each(['easy', 'normal', 'hard'])('a %s game can be won even when every arena scores 0/4', (difficulty) => {
  const { engine, log } = playFullGame({ difficulty, arenaDifficulty: 'normal', arenaCorrect: 0 });
  expect(log.waves).toEqual([1, 2, 3, 4, 5]);
  expect(log.arenas).toEqual([1, 2, 3, 4, 'post-boss']);
  expect(log.bossPhases).toEqual([2, 3]);
  expect(engine.state.state).toBe(GameState.VICTORY);
  expect(engine.stats.bossDefeated).toBe(true);
  expect(engine.abilities.slots.size).toBe(0);
  expect(engine.stats.arenaQuestions).toBe(20);
});

test('a hard game with perfect Hard arenas unlocks all four elite abilities and uses them', () => {
  const { engine, log } = playFullGame({ difficulty: 'hard', arenaDifficulty: 'hard', arenaCorrect: 4, useAbilities: true });
  expect(engine.state.state).toBe(GameState.VICTORY);
  expect([...engine.abilities.slots.values()].map((s) => s.id)).toEqual(['ghostMode', 'phantomOverdrive', 'timeFreezeLaser', 'ultimateNova']);
  expect(log.abilityUses).toBeGreaterThan(10);
  expect(engine.stats.achievements).toEqual(['legendary_defender']);
  expect(engine.stats.arenaCorrect).toBe(20);
});
