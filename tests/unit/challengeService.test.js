const { ChallengeService, SUBMIT_GRACE_SECONDS, DUPLICATE_REFETCHES } = require('../../src/services/challengeService');
const { PuzzleUnavailableError } = require('../../src/services/puzzleService');

// Mock puzzle provider: solutions 3, 7, 1 in order (genuine-looking PNG data URIs).
// Live Banana behaviour is tested on wave 4; waves 1-3 use the fixed cached puzzles.
function mockProvider(solutions = [3, 7, 1]) {
  let i = 0;
  return { getPuzzle: jest.fn(async () => ({ image: `data:image/png;base64,AAAA${i}`, solution: solutions[i++ % solutions.length], source: 'banana', latencyMs: 100 })) };
}

function setup({ kind = 'wave', wave = 4, difficulty = 'normal', provider = mockProvider() } = {}) {
  let clock = 1_000_000;
  const service = new ChallengeService({ puzzleProvider: provider, now: () => clock, idGenerator: () => 'c1' });
  const arena = service.createArena({ kind, wave, difficulty });
  return { service, provider, arena, advance: (s) => { clock += s * 1000; } };
}

async function answerAll(service, answers) {
  const results = [];
  for (let i = 0; i < answers.length; i += 1) {
    await service.getQuestion('c1');
    results.push(service.submitAnswer('c1', { questionIndex: i, answer: answers[i] }));
  }
  return results;
}

describe('ChallengeService', () => {
  test('validates kind, wave and difficulty', () => {
    const { service } = setup();
    expect(() => service.createArena({ kind: 'wave', wave: 5 })).toThrow(/not valid/);
    expect(() => service.createArena({ kind: 'bonus', wave: 2 })).toThrow(/not valid/);
    expect(() => service.createArena({ kind: 'upgradeBay', wave: 1 })).toThrow(/kind must be/);
    expect(() => service.createArena({ kind: 'wave', wave: 1, difficulty: 'expert' })).toThrow(/difficulty/);
    expect(() => service.createArena({ kind: '__proto__', wave: 1 })).toThrow(/kind must be/);
  });

  test('a post-wave quiz has exactly two questions', async () => {
    const { service, arena } = setup();
    expect(arena.totalQuestions).toBe(2);
    const results = await answerAll(service, [3, 7]);
    expect(results.map((r) => r.answered)).toEqual([1, 2]);
    expect(results.at(-1)).toMatchObject({ completed: true, correctCount: 2, totalQuestions: 2 });
    await expect(service.getQuestion('c1')).rejects.toMatchObject({ status: 409 });
  });

  test('a special challenge has exactly one question and no hints', async () => {
    const { service, arena } = setup({ kind: 'special', wave: 2 });
    expect(arena).toMatchObject({ totalQuestions: 1, timeLimitSeconds: 20, hintsAllowed: false });
    const q = await service.getQuestion('c1');
    expect(q.hintAvailable).toBe(false);
    expect(() => service.useHint('c1')).toThrow(/no hints/);
    expect(service.submitAnswer('c1', { questionIndex: 0, answer: 3 })).toMatchObject({ completed: true, correct: true });
  });

  test('questions never include the solution', async () => {
    const { service } = setup();
    const q = await service.getQuestion('c1');
    expect(JSON.stringify(q)).not.toMatch(/solution/);
  });

  test('asking again returns the same puzzle (no rerolling)', async () => {
    const { service, provider } = setup();
    const a = await service.getQuestion('c1');
    const b = await service.getQuestion('c1');
    expect(b.image).toBe(a.image);
    expect(provider.getPuzzle).toHaveBeenCalledTimes(1);
  });

  test('a VALID answer to the current puzzle is always accepted (regression: no false "already answered")', async () => {
    const { service, advance } = setup();
    await service.getQuestion('c1');
    advance(10);
    await service.getQuestion('c1'); // e.g. the page re-requested the same question
    expect(service.submitAnswer('c1', { questionIndex: 0, answer: 3 })).toMatchObject({ correct: true });
    await service.getQuestion('c1');
    expect(service.submitAnswer('c1', { questionIndex: 1, answer: 7 })).toMatchObject({ correct: true });
  });

  test('wrong answers reveal the solution and move on', async () => {
    const { service } = setup();
    await service.getQuestion('c1');
    expect(service.submitAnswer('c1', { questionIndex: 0, answer: 5 })).toMatchObject({ correct: false, correctAnswer: 3, answered: 1 });
  });

  test('only one scored submission per question', async () => {
    const { service } = setup();
    await service.getQuestion('c1');
    service.submitAnswer('c1', { questionIndex: 0, answer: 5 });
    expect(() => service.submitAnswer('c1', { questionIndex: 0, answer: 3 })).toThrow('already been answered');
  });

  test('answers after the time limit (plus grace) count as wrong', async () => {
    const { service, advance } = setup();
    await service.getQuestion('c1');
    advance(45 + SUBMIT_GRACE_SECONDS + 1);
    expect(service.submitAnswer('c1', { questionIndex: 0, answer: 3 })).toMatchObject({ correct: false, timedOut: true });
  });

  test('hint narrows the answer without revealing it, once per puzzle', async () => {
    const { service } = setup();
    await service.getQuestion('c1');
    expect(service.useHint('c1').hint).toBe('The answer is an odd number between 0 and 4.');
    expect(() => service.useHint('c1')).toThrow('already used');
  });

  test('when the Banana API is down nothing is stored, so Retry works', async () => {
    let fail = true;
    const provider = { getPuzzle: jest.fn(async () => {
      if (fail) throw new PuzzleUnavailableError({ code: 'TIMEOUT' });
      return { image: 'data:image/png;base64,AAAA', solution: 4, source: 'banana', latencyMs: 5 };
    }) };
    const { service } = setup({ provider });
    await expect(service.getQuestion('c1')).rejects.toMatchObject({ status: 503, code: 'PUZZLE_API_UNAVAILABLE' });
    fail = false;
    expect((await service.getQuestion('c1')).questionNumber).toBe(1);
  });

  test.each([
    [[3, 7], 'empShockwave'],
    [[3, 0], null],
    [[0, 0], null],
  ])('answers %p -> ability %p, claimable once', async (answers, ability) => {
    const { service } = setup();
    expect(() => service.claimRewards('c1')).toThrow('Answer every question first');
    await answerAll(service, answers);
    const reward = service.claimRewards('c1');
    expect(reward.ability ? reward.ability.id : null).toBe(ability);
    expect(() => service.claimRewards('c1')).toThrow('already claimed');
  });

  test('wave 4 fetches two different Banana puzzles, skipping a repeated one', async () => {
    const images = ['P1', 'P1', 'P2'];
    let i = 0;
    const provider = { getPuzzle: jest.fn(async () => ({ image: images[i], solution: [3, 3, 8][i++], source: 'banana', latencyMs: 5 })) };
    const { service } = setup({ provider });
    const first = await service.getQuestion('c1');
    service.submitAnswer('c1', { questionIndex: 0, answer: 3 });
    const second = await service.getQuestion('c1');
    expect([first.image, second.image]).toEqual(['P1', 'P2']);
    expect(provider.getPuzzle).toHaveBeenCalledTimes(3);
    expect(service.submitAnswer('c1', { questionIndex: 1, answer: 8 })).toMatchObject({ correct: true, correctCount: 2 });
  });

  test('if the Banana API keeps repeating the same puzzle: 503, nothing stored, Retry works', async () => {
    let image = 'SAME';
    const provider = { getPuzzle: jest.fn(async () => ({ image, solution: 1, source: 'banana', latencyMs: 5 })) };
    const { service } = setup({ provider });
    await service.getQuestion('c1');
    service.submitAnswer('c1', { questionIndex: 0, answer: 1 });
    await expect(service.getQuestion('c1')).rejects.toMatchObject({ status: 503, code: 'PUZZLE_API_UNAVAILABLE', expose: true });
    expect(provider.getPuzzle).toHaveBeenCalledTimes(1 + DUPLICATE_REFETCHES + 1);
    image = 'NEW';
    expect((await service.getQuestion('c1')).image).toBe('NEW');
  });

  test('expired or unknown challenges return 404', () => {
    const { service, advance } = setup();
    expect(() => service.getArena('nope')).toThrow(expect.objectContaining({ status: 404 }));
    advance(31 * 60);
    expect(() => service.getArena('c1')).toThrow(expect.objectContaining({ status: 404 }));
  });
});

describe('Fixed (cached genuine) Banana puzzles after waves 1-3', () => {
  // Puzzle id -> the solution the live Banana API returned with that image
  // (each answer was also checked by solving the puzzle's equations).
  const FIXED = {
    1: [['W1-Q1', 7], ['W1-Q2', 0]],
    2: [['W2-Q1', 4], ['W2-Q2', 0]],
    3: [['W3-Q1', 0], ['W3-Q2', 3]],
  };
  const ABILITY = { 1: 'plasmaShield', 2: 'hyperBlaster', 3: 'tripleBeam' };

  async function playthrough(wave) {
    const { service, provider } = setup({ wave });
    const asked = [];
    for (let i = 0; i < 2; i += 1) {
      const q = await service.getQuestion('c1');
      expect(q).toMatchObject({ questionNumber: i + 1, totalQuestions: 2, source: 'banana-cached', latencyMs: null });
      expect(q.image).toMatch(/^data:image\/png;base64,iVBORw0KGgo/); // a real PNG image
      expect(JSON.stringify(q)).not.toMatch(/solution|correctAnswer/);
      asked.push({ id: q.puzzleId, image: q.image });
      service.submitAnswer('c1', { questionIndex: i, answer: FIXED[wave][i][1] });
    }
    expect(provider.getPuzzle).not.toHaveBeenCalled(); // never replaced by a live puzzle
    return asked;
  }

  test.each([1, 2, 3])('wave %i: the same two puzzle images, in the same order, in every game', async (wave) => {
    const first = await playthrough(wave);
    const restarted = await playthrough(wave);
    expect(first.map((q) => q.id)).toEqual(FIXED[wave].map(([id]) => id));
    expect(restarted).toEqual(first);
    expect(first[0].image).not.toBe(first[1].image);
  });

  test.each([1, 2, 3])('wave %i: answers are checked on the server; 2/2 unlocks the ability', async (wave) => {
    const { service } = setup({ wave });
    const [[, a], [, b]] = FIXED[wave];
    expect((await answerAll(service, [a, b])).map((r) => r.correct)).toEqual([true, true]);
    expect(service.claimRewards('c1')).toMatchObject({ correct: 2, perfect: true, ability: { id: ABILITY[wave] } });
  });

  test.each([
    [[7, 5], 1],
    [[1, 5], 0],
  ])('wave 1 answers %p -> %i/2, no ability, answer revealed only after submitting', async (answers, correct) => {
    const { service } = setup({ wave: 1 });
    const results = await answerAll(service, answers);
    expect(results[1]).toMatchObject({ correct: false, correctAnswer: 0 });
    expect(service.claimRewards('c1')).toMatchObject({ correct, ability: null });
  });
});
