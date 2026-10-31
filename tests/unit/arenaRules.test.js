const { calculateRewards, describeArena, WAVE_ABILITIES, DIFFICULTY_RULES } = require('../../src/services/arenaRules');
const { generateOfflinePuzzle } = require('../../src/services/offlinePuzzleService');

describe('Arena reward tiers (waves 1-4)', () => {
  const r = (correct, difficulty = 'normal', wave = 2) => calculateRewards({ wave, difficulty, correct });

  test('0/4: nothing, but no penalty either', () => {
    expect(r(0)).toMatchObject({ energy: 0, repair: 0, ability: null, scoreBonus: 0 });
  });

  test('1/4: +10 Knowledge Energy', () => {
    expect(r(1)).toMatchObject({ energy: 10, repair: 0, ability: null });
  });

  test('2/4: +20 energy and minor hull repair', () => {
    expect(r(2)).toMatchObject({ energy: 20, repair: 15, ability: null });
  });

  test('3/4: unlocks the standard ability for that wave', () => {
    for (const wave of [1, 2, 3, 4]) {
      for (const difficulty of ['easy', 'normal', 'hard']) {
        expect(r(3, difficulty, wave).ability).toEqual({ id: WAVE_ABILITIES[wave].standard, tier: 'standard', slot: wave });
      }
    }
  });

  test('4/4: reward strength depends on the chosen difficulty', () => {
    expect(r(4, 'easy', 1).ability).toEqual({ id: 'miniShield', tier: 'standard', slot: 1 });
    expect(r(4, 'normal', 1).ability).toEqual({ id: 'miniShield', tier: 'enhanced', slot: 1 });
    expect(r(4, 'hard', 1).ability).toEqual({ id: 'ghostMode', tier: 'elite', slot: 1 });
    expect(r(4, 'easy').energy).toBeLessThan(r(4, 'normal').energy);
    expect(r(4, 'normal').energy).toBeLessThan(r(4, 'hard').energy);
  });

  test('Easy and Normal perfect runs are still worth more than 3/4', () => {
    expect(r(4, 'easy').energy).toBeGreaterThan(r(3, 'easy').energy);
    expect(r(4, 'easy').repair).toBeGreaterThan(r(3, 'easy').repair);
  });

  test.each([
    [1, 'miniShield', 'ghostMode'],
    [2, 'rapidFire', 'phantomOverdrive'],
    [3, 'tripleLaser', 'timeFreezeLaser'],
    [4, 'empBlast', 'ultimateNova'],
  ])('wave %i offers %s / elite %s', (wave, standard, elite) => {
    expect(WAVE_ABILITIES[wave]).toEqual({ standard, elite });
    expect(r(4, 'hard', wave).ability.id).toBe(elite);
  });

  test('rejects impossible inputs', () => {
    expect(() => r(5)).toThrow('Invalid correct count');
    expect(() => r(2, 'nightmare')).toThrow('Unknown arena difficulty');
  });
});

describe('Post-boss bonus challenge (wave 5)', () => {
  test('gives score bonus and energy, never an ability', () => {
    const reward = calculateRewards({ wave: 5, difficulty: 'normal', correct: 3 });
    expect(reward.postBoss).toBe(true);
    expect(reward.ability).toBeNull();
    expect(reward.scoreBonus).toBe(3 * 500 * 1.5);
  });

  test('Legendary Defender only for a perfect Hard run', () => {
    expect(calculateRewards({ wave: 5, difficulty: 'hard', correct: 4 }).achievements).toEqual(['legendary_defender']);
    expect(calculateRewards({ wave: 5, difficulty: 'hard', correct: 3 }).achievements).toEqual([]);
    expect(calculateRewards({ wave: 5, difficulty: 'normal', correct: 4 }).achievements).toEqual([]);
  });
});

describe('Difficulty rules are game-side and transparent', () => {
  test('harder modes give less time and no hints', () => {
    const { easy, normal, hard } = DIFFICULTY_RULES;
    expect(easy.timeLimitSeconds).toBeGreaterThan(normal.timeLimitSeconds);
    expect(normal.timeLimitSeconds).toBeGreaterThan(hard.timeLimitSeconds);
    expect([easy.hintsAllowed, normal.hintsAllowed, hard.hintsAllowed]).toEqual([true, false, false]);
  });

  test('describeArena tells the player the API has no difficulty setting and lists every tier', () => {
    const info = describeArena(3);
    expect(info.note).toMatch(/no difficulty setting/);
    expect(info.difficulties).toHaveLength(3);
    for (const d of info.difficulties) expect(d.rewardTable).toHaveLength(5);
    expect(describeArena(5).postBoss).toBe(true);
  });
});

describe('Offline fallback puzzle', () => {
  test('is a labelled SVG whose stated solution is correct', () => {
    for (let i = 0; i < 25; i += 1) {
      const puzzle = generateOfflinePuzzle();
      const svg = Buffer.from(puzzle.image.split(',')[1], 'base64').toString('utf8');
      expect(svg).toContain('OFFLINE PUZZLE');
      const cherryTotal = Number(svg.match(/🍒 \+ 🍒 = (\d+)/)[1]);
      const mixedTotal = Number(svg.match(/🍌 \+ 🍒 = (\d+)/)[1]);
      expect(puzzle.solution).toBe(mixedTotal - cherryTotal / 2);
      expect(puzzle.solution).toBeGreaterThanOrEqual(0);
      expect(puzzle.solution).toBeLessThanOrEqual(9);
    }
  });
});
