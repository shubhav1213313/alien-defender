const { AppError } = require('../errors');

// Server-side validation of a submitted game result.
//
// LIMITATION (documented in the README): the game runs in the browser, so a
// determined player can always forge plausible numbers. These checks reject
// malformed and physically impossible results; they cannot prove a result
// is genuine. Values the server can measure itself (play duration, arena
// answers) are taken from the server, never from the browser.
const OUTCOMES = ['victory', 'destroyed', 'earthFallen', 'abandoned'];
const MAX_WAVES = 5;
const LIMITS = {
  score: 10_000_000,
  enemiesDestroyed: 2000,
  shotsFired: 200_000,
  abilitiesUsed: 1000,
};
// Generous ceilings derived from the game rules (best kill = 300 pts x4
// combo x1.5 difficulty, plus bonuses), used to spot impossible results.
const MAX_POINTS_PER_SECOND = 6000;
const BONUS_ALLOWANCE = 60_000;
const MAX_KILLS_PER_SECOND = 8;
const MIN_SECONDS_PER_CLEARED_WAVE = 8;

function int(body, field, min, max, errors) {
  const value = body[field];
  if (!Number.isInteger(value) || value < min || value > max) {
    errors[field] = `${field} must be a whole number from ${min} to ${max}`;
    return 0;
  }
  return value;
}

// Shape and range checks. Returns a clean object.
function parseResult(body = {}) {
  const errors = {};
  const result = {
    outcome: OUTCOMES.includes(body.outcome) ? body.outcome : (errors.outcome = `outcome must be one of ${OUTCOMES.join(', ')}`, null),
    score: int(body, 'score', 0, LIMITS.score, errors),
    waveReached: int(body, 'waveReached', 0, MAX_WAVES, errors),
    wavesCleared: int(body, 'wavesCleared', 0, MAX_WAVES, errors),
    enemiesDestroyed: int(body, 'enemiesDestroyed', 0, LIMITS.enemiesDestroyed, errors),
    maxCombo: int(body, 'maxCombo', 0, LIMITS.enemiesDestroyed, errors),
    shotsFired: int(body, 'shotsFired', 0, LIMITS.shotsFired, errors),
    shotsHit: int(body, 'shotsHit', 0, LIMITS.shotsFired, errors),
    abilitiesUsed: int(body, 'abilitiesUsed', 0, LIMITS.abilitiesUsed, errors),
    bossDefeated: typeof body.bossDefeated === 'boolean' ? body.bossDefeated : (errors.bossDefeated = 'bossDefeated must be true or false', false),
  };
  if (Object.keys(errors).length) throw new AppError('Invalid game result', 400, errors);
  return result;
}

// Consistency checks between fields and against the server-measured duration.
function checkPlausibility(result, durationSeconds) {
  const problems = [];
  if (result.wavesCleared > result.waveReached) problems.push('cleared more waves than reached');
  if (result.maxCombo > result.enemiesDestroyed) problems.push('combo longer than total kills');
  if (result.shotsHit > result.shotsFired) problems.push('more hits than shots');
  if (result.bossDefeated && result.wavesCleared < MAX_WAVES) problems.push('boss defeated before clearing all waves');
  if (result.outcome === 'victory' && !result.bossDefeated) problems.push('victory without defeating the boss');
  if (result.score > durationSeconds * MAX_POINTS_PER_SECOND + BONUS_ALLOWANCE) problems.push('score too high for the time played');
  if (result.enemiesDestroyed > (durationSeconds + 5) * MAX_KILLS_PER_SECOND) problems.push('too many kills for the time played');
  if (result.wavesCleared * MIN_SECONDS_PER_CLEARED_WAVE > durationSeconds) problems.push('waves cleared too quickly');
  if (problems.length) throw new AppError('Game result rejected as implausible', 422, { problems });
}

module.exports = { parseResult, checkPlausibility, OUTCOMES };
