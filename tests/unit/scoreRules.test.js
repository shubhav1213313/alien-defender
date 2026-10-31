const { earnedAchievements, ACHIEVEMENT_IDS } = require('../../src/services/achievementRules');
const { parseResult, checkPlausibility } = require('../../src/services/scoreValidation');
const { validatePassword } = require('../../src/validation/authValidation');

const baseResult = { outcome: 'destroyed', score: 0, waveReached: 1, wavesCleared: 0, enemiesDestroyed: 0, maxCombo: 0, shotsFired: 0, shotsHit: 0, abilitiesUsed: 0, bossDefeated: false };
const noTotals = { enemiesDestroyed: 0 };
const noQuiz = { correct: 0, total: 0, perfectCount: 0, legendaryCount: 0 };
const earned = (result = {}, totals = {}, quiz = {}, difficulty = 'normal') =>
  earnedAchievements({ result: { ...baseResult, ...result }, totals: { ...noTotals, ...totals }, quiz: { ...noQuiz, ...quiz }, difficulty });

describe('Achievement rules', () => {
  test('nothing for an empty game', () => {
    expect(earned()).toEqual([]);
  });

  test.each([
    ['first_blood', { enemiesDestroyed: 1 }, {}, {}],
    ['alien_hunter', {}, { enemiesDestroyed: 250 }, {}],
    ['wave_survivor', { wavesCleared: 5, waveReached: 5 }, {}, {}],
    ['boss_slayer', { bossDefeated: true }, {}, {}],
    ['first_victory', { outcome: 'victory' }, {}, {}],
    ['combo_master', { maxCombo: 25 }, {}, {}],
    ['perfect_quiz', {}, {}, { perfectCount: 1 }],
    ['knowledge_master', {}, {}, { correct: 50 }],
    ['legendary_defender', {}, {}, { legendaryCount: 1 }],
  ])('%s unlocks from its condition', (id, result, totals, quiz) => {
    expect(earned(result, totals, quiz)).toContain(id);
  });

  test.each([
    ['alien_hunter', {}, { enemiesDestroyed: 249 }, {}],
    ['combo_master', { maxCombo: 24 }, {}, {}],
    ['knowledge_master', {}, {}, { correct: 49 }],
    ['wave_survivor', { wavesCleared: 4 }, {}, {}],
  ])('%s does not unlock just below its threshold', (id, result, totals, quiz) => {
    expect(earned(result, totals, quiz)).not.toContain(id);
  });

  test('Hardened Defender needs a victory on hard', () => {
    expect(earned({ outcome: 'victory' }, {}, {}, 'hard')).toContain('hard_victory');
    expect(earned({ outcome: 'victory' }, {}, {}, 'normal')).not.toContain('hard_victory');
  });

  test('rule ids match the ten achievements in the migration', () => {
    const fs = require('fs');
    const sql = fs.readFileSync(require.resolve('../../database/migrations/001_initial_schema.sql'), 'utf8');
    for (const id of ACHIEVEMENT_IDS) expect(sql).toContain(`('${id}',`);
    expect(ACHIEVEMENT_IDS).toHaveLength(10);
  });
});

describe('Score validation', () => {
  test('accepts a well-formed result', () => {
    expect(parseResult({ ...baseResult, score: 100 })).toMatchObject({ score: 100 });
  });

  test('rejects decimals, strings and missing fields', () => {
    expect(() => parseResult({ ...baseResult, score: 1.5 })).toThrow('Invalid game result');
    expect(() => parseResult({ ...baseResult, waveReached: '3' })).toThrow('Invalid game result');
    expect(() => parseResult({})).toThrow('Invalid game result');
  });

  test('plausibility uses server-measured time', () => {
    const r = { ...baseResult, score: 500000, enemiesDestroyed: 100, maxCombo: 10 };
    expect(() => checkPlausibility(r, 30)).toThrow('implausible');
    expect(() => checkPlausibility(r, 600)).not.toThrow();
  });
});

describe('Password rules', () => {
  test.each([
    ['Galaxy2026', null],
    ['short1', 'at least 8'],
    ['abcdefgh', 'letter and one number'],
    ['12345678', 'letter and one number'],
    ['😀'.repeat(20) + 'a1', '72 bytes'],
  ])('%s', (password, expected) => {
    const error = validatePassword(password);
    if (expected === null) expect(error).toBeNull();
    else expect(error).toMatch(expected);
  });
});
