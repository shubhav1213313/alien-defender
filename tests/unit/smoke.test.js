import { GameEngine } from '../../public/js/game/GameEngine.js';
import { GameState } from '../../public/js/game/GameStateManager.js';
const { calculateRewards } = require('../../src/services/arenaRules');

// A stand-in 2D canvas context: every drawing method is a no-op, every
// property can be set. Lets render() run in Node to catch runtime errors in
// drawing code (typos, undefined fields) that unit tests would otherwise miss.
function stubCanvas() {
  const ctx = new Proxy({}, {
    // Every method is a no-op; gradients get a dummy with addColorStop().
    get: (target, prop) => (prop in target ? target[prop] : () => ({ addColorStop() {} })),
    set: (target, prop, value) => { target[prop] = value; return true; },
  });
  return { getContext: () => ctx };
}

// Plays a whole game headlessly through the REAL engine: the player chases
// the lowest alien firing constantly and cannot die. Every challenge is answered
// with the given number of correct answers and scored by the REAL server
// reward rules. Special invitations are accepted or ignored.
function playFullGame({ difficulty, correctPerQuiz, acceptSpecial, specialCorrect = 1, useAbilities = false }) {
  const held = new Set(['fire']);
  const input = { isDown: (a) => held.has(a), on: () => {}, releaseAll: () => {} };
  const engine = new GameEngine({ canvas: stubCanvas(), input, rng: () => 0.2 }); // an invitation every wave
  const log = { waves: [], failed: [], challenges: [], states: [], bossPhases: [], offers: 0, abilityUses: 0 };
  // A wave failed for too few kills is replayed, so log only the first start.
  engine.bus.on('wave:start', ({ wave }) => { if (!log.waves.includes(wave)) log.waves.push(wave); });
  engine.bus.on('wave:failed', ({ wave }) => log.failed.push(wave));
  engine.bus.on('arena:open', ({ kind, wave }) => log.challenges.push(`${kind}:${wave}`));
  engine.bus.on('state:change', ({ to }) => log.states.push(to));
  engine.bus.on('boss:phase', ({ phase }) => log.bossPhases.push(phase));
  engine.bus.on('special:offer', () => { log.offers += 1; });
  engine.bus.on('ability:activated', () => { log.abilityUses += 1; });

  engine.startGame(difficulty);
  engine.player.maxHealth = engine.player.health = 1e9;
  engine.earth.maxShield = engine.earth.shield = 1e9;

  const dt = 1 / 60;
  let id = 0;
  for (let frame = 0; frame < 25 * 60 * 60; frame += 1) {
    if (engine.state.is(GameState.VICTORY) || engine.state.is(GameState.GAME_OVER)) break;
    if (engine.specialOffer && acceptSpecial) engine.acceptSpecialOffer();
    if (engine.state.is(GameState.QUIZ)) {
      const { kind, wave } = engine.arena;
      const correct = kind === 'special' ? specialCorrect : correctPerQuiz;
      id += 1;
      expect(engine.applyArenaRewards(`c${id}`, calculateRewards({ kind, wave, difficulty, correct }))).toBe(true);
      expect(engine.finishArena()).toBe(true);
      continue;
    }
    held.delete('left');
    held.delete('right');
    // Steer under the nearest on-screen alien (waves need real kills); sweep otherwise.
    const dx = (e) => Math.abs(e.x - engine.player.x);
    const target = engine.enemies.filter((e) => e.y > 0).reduce((best, e) => (!best || dx(e) < dx(best) ? e : best), null);
    if (!target) held.add(Math.floor(frame / 90) % 2 ? 'left' : 'right');
    else if (Math.abs(target.x - engine.player.x) > 8) held.add(target.x < engine.player.x ? 'left' : 'right');
    if (useAbilities && frame % 150 === 0) {
      engine.abilities.addEnergy(100);
      engine.activateAbility(1 + ((frame / 150) % 5));
    }
    engine.update(dt);
    engine.render();
  }
  return { engine, log };
}

// Test A + C: every compulsory quiz failed (0/2) - the game still finishes.
test.each(['easy', 'normal', 'hard'])('%s: quiz after waves 1-4 every time, 0/2 still reaches victory', (difficulty) => {
  const { engine, log } = playFullGame({ difficulty, correctPerQuiz: 0, acceptSpecial: false });
  expect(log.waves).toEqual([1, 2, 3, 4, 5]);
  expect(log.challenges).toEqual(['wave:1', 'wave:2', 'wave:3', 'wave:4', 'bonus:5']);
  expect(log.bossPhases).toEqual([2, 3]);
  expect(engine.state.state).toBe(GameState.VICTORY);
  expect(engine.abilities.slots.size).toBe(0);
  // E: invitations appeared and were simply ignored.
  expect(log.offers).toBeGreaterThan(0);
  // There is no other between-wave screen: after each quiz comes the wave banner.
  const afterQuiz = log.states.filter((s, i) => log.states[i - 1] === 'quiz');
  expect(new Set(afterQuiz)).toEqual(new Set(['waveTransition', 'victory']));
});

// Test C: 1/2 is not enough.
test('1/2 on every quiz unlocks nothing and the game still finishes', () => {
  const { engine } = playFullGame({ difficulty: 'normal', correctPerQuiz: 1, acceptSpecial: false });
  expect(engine.state.state).toBe(GameState.VICTORY);
  expect(engine.abilities.slots.size).toBe(0);
  expect(engine.stats.arenaCorrect).toBe(5);
});

// Tests B, D, F: perfect quizzes + accepted special puzzle, abilities used.
test('2/2 every time unlocks all four abilities; the special puzzle unlocks VOID STORM; all are usable', () => {
  const { engine, log } = playFullGame({ difficulty: 'hard', correctPerQuiz: 2, acceptSpecial: true, useAbilities: true });
  expect(engine.state.state).toBe(GameState.VICTORY);
  expect(log.challenges[0]).toBe('special:1'); // accepted mid-wave, before the wave-1 quiz
  expect(log.challenges).toEqual(expect.arrayContaining(['wave:1', 'wave:2', 'wave:3', 'wave:4', 'bonus:5']));
  expect(log.challenges.filter((c) => c.startsWith('special'))).toHaveLength(1); // no repeat once owned
  expect([...engine.abilities.slots.values()].sort()).toEqual(['empShockwave', 'hyperBlaster', 'plasmaShield', 'tripleBeam', 'voidStorm']);
  expect(log.abilityUses).toBeGreaterThan(10);
  expect(log.waves).toEqual([1, 2, 3, 4, 5]); // the special puzzle never skipped a wave
  expect(engine.stats.achievements).toEqual(['legendary_defender']);
});
