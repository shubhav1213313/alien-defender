// Rules and reward tiers for the Knowledge Challenge Arena.
//
// HONESTY NOTE: the Banana API has no difficulty parameter, so every mode
// receives the same kind of puzzle. Difficulty is purely game-side and
// transparent to the player: a shorter time limit, no hints, and bigger
// rewards for a perfect run.
const QUESTIONS_PER_ARENA = 4;
const FINAL_WAVE = 5; // the arena after wave 5 is the post-boss bonus challenge

const DIFFICULTY_RULES = Object.freeze({
  easy: Object.freeze({
    id: 'easy', label: 'Easy', timeLimitSeconds: 60, hintsAllowed: true, scoreMultiplier: 1,
    perfectTier: 'standard',
    description: '60 seconds per puzzle and one hint per puzzle. A perfect run unlocks the standard ability plus bonus energy.',
  }),
  normal: Object.freeze({
    id: 'normal', label: 'Normal', timeLimitSeconds: 35, hintsAllowed: false, scoreMultiplier: 1.5,
    perfectTier: 'enhanced',
    description: '35 seconds per puzzle, no hints. A perfect run unlocks an ENHANCED ability (longer, cheaper).',
  }),
  hard: Object.freeze({
    id: 'hard', label: 'Hard', timeLimitSeconds: 20, hintsAllowed: false, scoreMultiplier: 2,
    perfectTier: 'elite',
    description: '20 seconds per puzzle, no hints. A perfect run unlocks the ELITE ability - the most powerful reward.',
  }),
});

// Abilities offered after each wave (slot = activation key 1-4).
const WAVE_ABILITIES = Object.freeze({
  1: Object.freeze({ standard: 'miniShield', elite: 'ghostMode' }),
  2: Object.freeze({ standard: 'rapidFire', elite: 'phantomOverdrive' }),
  3: Object.freeze({ standard: 'tripleLaser', elite: 'timeFreezeLaser' }),
  4: Object.freeze({ standard: 'empBlast', elite: 'ultimateNova' }),
});

const PERFECT_ENERGY = { easy: 30, normal: 35, hard: 40 };

// Tiers are cumulative: 3/4 also gets the 2/4 rewards, and so on.
//   0/4 nothing · 1/4 +10 energy · 2/4 +20 energy & +15 hull
//   3/4 + standard ability · 4/4 stronger ability depending on difficulty
function calculateRewards({ wave, difficulty, correct }) {
  const rules = DIFFICULTY_RULES[difficulty];
  if (!rules) throw new Error(`Unknown arena difficulty: ${difficulty}`);
  if (!Number.isInteger(correct) || correct < 0 || correct > QUESTIONS_PER_ARENA) {
    throw new Error(`Invalid correct count: ${correct}`);
  }
  const perfect = correct === QUESTIONS_PER_ARENA;
  const postBoss = wave === FINAL_WAVE;

  const reward = {
    wave, difficulty, correct, total: QUESTIONS_PER_ARENA, postBoss,
    energy: 0, repair: 0, ability: null, scoreBonus: 0, achievements: [],
  };

  if (correct >= 1) reward.energy = 10;
  if (correct >= 2) { reward.energy = 20; reward.repair = 15; }
  if (perfect) { reward.energy = PERFECT_ENERGY[difficulty]; reward.repair = 25; }

  if (postBoss) {
    // Victory bonus: points instead of an ability (there are no more waves).
    reward.scoreBonus = Math.round(correct * 500 * rules.scoreMultiplier);
    if (perfect && difficulty === 'hard') reward.achievements.push('legendary_defender');
  } else if (correct >= 3) {
    const options = WAVE_ABILITIES[wave];
    const tier = perfect ? rules.perfectTier : 'standard';
    reward.ability = { id: tier === 'elite' ? options.elite : options.standard, tier, slot: wave };
  }
  return reward;
}

// Everything the player needs to choose a difficulty, computed from the
// same function that awards the real rewards.
function describeArena(wave) {
  return {
    wave,
    postBoss: wave === FINAL_WAVE,
    questionsPerArena: QUESTIONS_PER_ARENA,
    abilities: WAVE_ABILITIES[wave] || null,
    note: 'The Banana API has no difficulty setting: every mode gets the same kind of puzzle. Modes differ in time limit, hints and rewards.',
    difficulties: Object.values(DIFFICULTY_RULES).map((rules) => ({
      ...rules,
      rewardTable: [0, 1, 2, 3, 4].map((correct) => calculateRewards({ wave, difficulty: rules.id, correct })),
    })),
  };
}

module.exports = { QUESTIONS_PER_ARENA, FINAL_WAVE, DIFFICULTY_RULES, WAVE_ABILITIES, calculateRewards, describeArena };
