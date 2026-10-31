// Rules and rewards for the Knowledge Challenges.
//
//   wave    - COMPULSORY after waves 1-4: two Banana puzzles (waves 1-3: the
//             same cached genuine puzzles every game; wave 4: live). 2/2 unlocks that
//             wave's ability; 0/2 or 1/2 unlocks nothing, but the next wave
//             always starts.
//   bonus   - the Victory Bonus Challenge after the boss: two puzzles for
//             bonus points (and Legendary Defender on a Hard game).
//   special - OPTIONAL, offered briefly during combat: one puzzle, shorter
//             time, no hint. Correct unlocks the legendary VOID STORM.
//
// HONESTY NOTE: the Banana API has no difficulty parameter, so the special
// puzzle is the same kind of puzzle - it is "hard" only because of the
// shorter time limit and the missing hint, and the UI says so.
const { fixedQuestionsFor, FIXED_SOURCE } = require('./fixedQuizQuestions');

const FINAL_WAVE = 5;

const KINDS = Object.freeze({
  wave: Object.freeze({ questions: 2, timeLimitSeconds: 45, hintsAllowed: true, energyPerCorrect: 15 }),
  bonus: Object.freeze({ questions: 2, timeLimitSeconds: 45, hintsAllowed: true, energyPerCorrect: 15 }),
  special: Object.freeze({ questions: 1, timeLimitSeconds: 20, hintsAllowed: false, energyPerCorrect: 30 }),
});

const WAVE_ABILITIES = Object.freeze({ 1: 'plasmaShield', 2: 'hyperBlaster', 3: 'tripleBeam', 4: 'empShockwave' });
const SPECIAL_ABILITY = 'voidStorm';
const ABILITY_SLOTS = Object.freeze({ plasmaShield: 1, hyperBlaster: 2, tripleBeam: 3, empShockwave: 4, voidStorm: 5 });
const ABILITY_NAMES = Object.freeze({
  plasmaShield: 'Plasma Shield', hyperBlaster: 'Hyper Blaster', tripleBeam: 'Triple Beam', empShockwave: 'EMP Shockwave', voidStorm: 'VOID STORM',
});
const DIFFICULTIES = ['easy', 'normal', 'hard'];
const BONUS_POINTS = { easy: 1000, normal: 1500, hard: 2000 }; // per correct bonus puzzle

// Which waves each kind may be attached to.
function validWave(kind, wave) {
  if (kind === 'wave') return wave >= 1 && wave <= 4;
  if (kind === 'bonus') return wave === FINAL_WAVE;
  return wave >= 1 && wave <= FINAL_WAVE; // special: during any wave
}

function abilityFor(kind, wave) {
  if (kind === 'wave') return WAVE_ABILITIES[wave];
  if (kind === 'special') return SPECIAL_ABILITY;
  return null;
}

// `difficulty` is the GAME difficulty (only affects bonus points and
// Legendary Defender); taken from the saved game when one is linked.
function calculateRewards({ kind, wave, difficulty = 'normal', correct }) {
  const rules = KINDS[kind];
  if (!rules) throw new Error(`Unknown challenge kind: ${kind}`);
  if (!Number.isInteger(correct) || correct < 0 || correct > rules.questions) throw new Error(`Invalid correct count: ${correct}`);
  const perfect = correct === rules.questions;
  const reward = {
    kind, wave, difficulty, correct, total: rules.questions, perfect,
    energy: correct * rules.energyPerCorrect, ability: null, scoreBonus: 0, achievements: [],
  };
  const abilityId = abilityFor(kind, wave);
  if (abilityId && perfect) reward.ability = { id: abilityId, name: ABILITY_NAMES[abilityId], slot: ABILITY_SLOTS[abilityId] };
  if (kind === 'bonus') {
    reward.scoreBonus = correct * BONUS_POINTS[difficulty];
    if (perfect && difficulty === 'hard') reward.achievements.push('legendary_defender');
  }
  return reward;
}

// Everything the intro screen shows, from the same rules that award rewards.
function describeChallenge(kind, wave) {
  const rules = KINDS[kind];
  const abilityId = abilityFor(kind, wave);
  const name = abilityId ? ABILITY_NAMES[abilityId] : null;
  const fixed = fixedQuestionsFor(kind, wave) !== null;
  let preview;
  if (kind === 'wave') preview = `SOLVE BOTH PUZZLES TO UNLOCK ${name.toUpperCase()}`;
  else if (kind === 'special') preview = `SOLVE THIS PUZZLE TO UNLOCK ${name}`;
  else preview = 'SOLVE BOTH PUZZLES FOR BONUS POINTS';
  return {
    kind,
    wave,
    questions: rules.questions,
    timeLimitSeconds: rules.timeLimitSeconds,
    hintsAllowed: rules.hintsAllowed,
    energyPerCorrect: rules.energyPerCorrect,
    ability: abilityId ? { id: abilityId, name, slot: ABILITY_SLOTS[abilityId] } : null,
    preview,
    source: fixed ? FIXED_SOURCE : 'banana',
    bonusPointsPerCorrect: kind === 'bonus' ? BONUS_POINTS : null,
    note: fixed
      ? 'These are genuine Banana API puzzles saved (cached) from the API - the same two every game, not fetched live. Each puzzle allows one answer.'
      : 'Puzzles come live from the Banana API, which has no difficulty setting. '
        + (kind === 'special' ? 'This one is harder only because of the 20-second limit and no hint.' : 'Each puzzle allows one answer.'),
  };
}

module.exports = {
  FINAL_WAVE, KINDS, WAVE_ABILITIES, SPECIAL_ABILITY, ABILITY_SLOTS, ABILITY_NAMES, DIFFICULTIES,
  validWave, calculateRewards, describeChallenge,
};
