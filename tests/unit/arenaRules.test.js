const { calculateRewards, describeChallenge, validWave, WAVE_ABILITIES, KINDS } = require('../../src/services/arenaRules');

describe('Compulsory post-wave quiz (kind "wave")', () => {
  const r = (correct, wave = 1) => calculateRewards({ kind: 'wave', wave, correct });

  test('has exactly two puzzles', () => {
    expect(KINDS.wave.questions).toBe(2);
  });

  test.each([
    [1, 'plasmaShield', 'Plasma Shield'],
    [2, 'hyperBlaster', 'Hyper Blaster'],
    [3, 'tripleBeam', 'Triple Beam'],
    [4, 'empShockwave', 'EMP Shockwave'],
  ])('wave %i: 2/2 unlocks %s', (wave, id, name) => {
    expect(WAVE_ABILITIES[wave]).toBe(id);
    expect(r(2, wave).ability).toEqual({ id, name, slot: wave });
  });

  test.each([0, 1])('%i/2 unlocks nothing', (correct) => {
    for (const wave of [1, 2, 3, 4]) expect(r(correct, wave).ability).toBeNull();
  });

  test('every correct answer gives Knowledge Energy (15 each)', () => {
    expect([0, 1, 2].map((c) => r(c).energy)).toEqual([0, 15, 30]);
  });

  test('the preview names the ability', () => {
    expect(describeChallenge('wave', 1).preview).toBe('SOLVE BOTH PUZZLES TO UNLOCK PLASMA SHIELD');
    expect(describeChallenge('wave', 4).preview).toBe('SOLVE BOTH PUZZLES TO UNLOCK EMP SHOCKWAVE');
  });
});

describe('Optional special puzzle (kind "special")', () => {
  test('one puzzle, 20 seconds, no hints', () => {
    expect(KINDS.special).toMatchObject({ questions: 1, timeLimitSeconds: 20, hintsAllowed: false });
  });

  test('correct unlocks VOID STORM; wrong unlocks nothing', () => {
    expect(calculateRewards({ kind: 'special', wave: 3, correct: 1 }).ability).toEqual({ id: 'voidStorm', name: 'VOID STORM', slot: 5 });
    expect(calculateRewards({ kind: 'special', wave: 3, correct: 0 }).ability).toBeNull();
  });

  test('the rules say honestly why it is "hard"', () => {
    const info = describeChallenge('special', 2);
    expect(info.preview).toBe('SOLVE THIS PUZZLE TO UNLOCK VOID STORM');
    expect(info.note).toMatch(/no difficulty setting/);
    expect(info.note).toMatch(/20-second limit and no hint/);
  });
});

describe('Victory Bonus Challenge (kind "bonus")', () => {
  test('points scale with game difficulty; never an ability', () => {
    expect(calculateRewards({ kind: 'bonus', wave: 5, difficulty: 'easy', correct: 2 })).toMatchObject({ scoreBonus: 2000, ability: null });
    expect(calculateRewards({ kind: 'bonus', wave: 5, difficulty: 'hard', correct: 1 }).scoreBonus).toBe(2000);
  });

  test('Legendary Defender only for 2/2 on a Hard game', () => {
    expect(calculateRewards({ kind: 'bonus', wave: 5, difficulty: 'hard', correct: 2 }).achievements).toEqual(['legendary_defender']);
    expect(calculateRewards({ kind: 'bonus', wave: 5, difficulty: 'normal', correct: 2 }).achievements).toEqual([]);
    expect(calculateRewards({ kind: 'bonus', wave: 5, difficulty: 'hard', correct: 1 }).achievements).toEqual([]);
  });
});

describe('Validation', () => {
  test.each([
    ['wave', 1, true], ['wave', 4, true], ['wave', 5, false], ['wave', 0, false],
    ['bonus', 5, true], ['bonus', 4, false],
    ['special', 1, true], ['special', 5, true], ['special', 6, false],
  ])('%s challenge after wave %i valid: %p', (kind, wave, ok) => {
    expect(validWave(kind, wave)).toBe(ok);
  });

  test('rejects impossible scores and unknown kinds', () => {
    expect(() => calculateRewards({ kind: 'wave', wave: 1, correct: 3 })).toThrow('Invalid correct count');
    expect(() => calculateRewards({ kind: 'special', wave: 1, correct: 2 })).toThrow('Invalid correct count');
    expect(() => calculateRewards({ kind: 'upgradeBay', wave: 1, correct: 0 })).toThrow('Unknown challenge kind');
  });

  test('waves 1-3 use local fixed questions; wave 4, bonus and special use the Banana API', () => {
    expect([1, 2, 3].map((w) => describeChallenge('wave', w).source)).toEqual(['local-fixed', 'local-fixed', 'local-fixed']);
    expect(describeChallenge('wave', 4).source).toBe('banana');
    expect(describeChallenge('bonus', 5).source).toBe('banana');
    expect(describeChallenge('special', 1).source).toBe('banana');
  });
});
