const { ChallengeService, SUBMIT_GRACE_SECONDS } = require('../../src/services/challengeService');

// Mock puzzle provider: solutions 3, 7, 1, 9 in order.
function mockProvider(solutions = [3, 7, 1, 9]) {
  let i = 0;
  return { getPuzzle: jest.fn(async () => ({ image: `data:image/png;base64,AAAA${i}`, solution: solutions[i++ % solutions.length], source: 'banana', latencyMs: 100 })) };
}

function setup({ difficulty = 'normal', wave = 1 } = {}) {
  let clock = 1_000_000;
  const provider = mockProvider();
  const service = new ChallengeService({ puzzleProvider: provider, now: () => clock, idGenerator: () => 'arena-1' });
  const arena = service.createArena({ wave, difficulty });
  return { service, provider, arena, advance: (s) => { clock += s * 1000; } };
}

async function answerAll(service, answers) {
  const results = [];
  for (let i = 0; i < answers.length; i += 1) {
    await service.getQuestion('arena-1');
    results.push(service.submitAnswer('arena-1', { questionIndex: i, answer: answers[i] }));
  }
  return results;
}

describe('ChallengeService', () => {
  test('validates wave and difficulty', () => {
    const { service } = setup();
    expect(() => service.createArena({ wave: 0, difficulty: 'easy' })).toThrow(/wave/);
    expect(() => service.createArena({ wave: 6, difficulty: 'easy' })).toThrow(/wave/);
    expect(() => service.createArena({ wave: 1, difficulty: 'expert' })).toThrow(/difficulty/);
    expect(() => service.createArena({ wave: 1, difficulty: '__proto__' })).toThrow(/difficulty/);
  });

  test('questions never include the solution', async () => {
    const { service } = setup();
    const q = await service.getQuestion('arena-1');
    expect(q).not.toHaveProperty('solution');
    expect(JSON.stringify(q)).not.toMatch(/"solution"/);
    expect(q).toMatchObject({ questionNumber: 1, totalQuestions: 4, source: 'banana' });
  });

  test('asking again returns the same puzzle (no rerolling)', async () => {
    const { service, provider } = setup();
    const a = await service.getQuestion('arena-1');
    const b = await service.getQuestion('arena-1');
    expect(b.image).toBe(a.image);
    expect(provider.getPuzzle).toHaveBeenCalledTimes(1);
  });

  test('progresses through exactly four questions', async () => {
    const { service } = setup();
    const results = await answerAll(service, [3, 7, 1, 9]);
    expect(results.map((r) => r.answered)).toEqual([1, 2, 3, 4]);
    expect(results.at(-1)).toMatchObject({ completed: true, correctCount: 4 });
    await expect(service.getQuestion('arena-1')).rejects.toMatchObject({ status: 409 });
  });

  test('wrong answers reveal the correct answer and still move on', async () => {
    const { service } = setup();
    await service.getQuestion('arena-1');
    const result = service.submitAnswer('arena-1', { questionIndex: 0, answer: 5 });
    expect(result).toMatchObject({ correct: false, correctAnswer: 3, answered: 1, completed: false });
    const next = await service.getQuestion('arena-1');
    expect(next.questionNumber).toBe(2);
  });

  test('only one scored submission per question', async () => {
    const { service } = setup();
    await service.getQuestion('arena-1');
    service.submitAnswer('arena-1', { questionIndex: 0, answer: 5 });
    expect(() => service.submitAnswer('arena-1', { questionIndex: 0, answer: 3 })).toThrow('already been answered');
    expect(service.publicArena(service.getArena('arena-1')).correct).toBe(0);
  });

  test('cannot answer a question that has not been shown yet', () => {
    const { service } = setup();
    expect(() => service.submitAnswer('arena-1', { questionIndex: 0, answer: 3 })).toThrow('not been issued');
  });

  test('answers after the time limit (plus grace) count as wrong', async () => {
    const { service, advance } = setup({ difficulty: 'hard' }); // 20s
    await service.getQuestion('arena-1');
    advance(20 + SUBMIT_GRACE_SECONDS + 1);
    expect(service.submitAnswer('arena-1', { questionIndex: 0, answer: 3 })).toMatchObject({ correct: false, timedOut: true });
  });

  test('a null answer is a timeout and counts as wrong', async () => {
    const { service } = setup();
    await service.getQuestion('arena-1');
    expect(service.submitAnswer('arena-1', { questionIndex: 0, answer: null })).toMatchObject({ correct: false, timedOut: true });
  });

  test('hints: Easy only, once per question, and never the answer itself', async () => {
    const easy = setup({ difficulty: 'easy' });
    await easy.service.getQuestion('arena-1');
    const { hint } = easy.service.useHint('arena-1');
    expect(hint).toBe('The answer is odd and less than 5.'); // solution 3
    expect(() => easy.service.useHint('arena-1')).toThrow('already used');
    expect((await easy.service.getQuestion('arena-1')).hintAvailable).toBe(false);

    const hard = setup({ difficulty: 'hard' });
    await hard.service.getQuestion('arena-1');
    expect(() => hard.service.useHint('arena-1')).toThrow(/only available on Easy/);
  });

  test('rewards can only be claimed after all four answers, and only once', async () => {
    const { service } = setup({ difficulty: 'hard', wave: 2 });
    expect(() => service.claimRewards('arena-1')).toThrow('Answer all four');
    await answerAll(service, [3, 7, 1, 9]);
    const reward = service.claimRewards('arena-1');
    expect(reward).toMatchObject({ correct: 4, ability: { id: 'phantomOverdrive', tier: 'elite' } });
    expect(() => service.claimRewards('arena-1')).toThrow('already claimed');
  });

  test('a failed arena (0/4) still completes and can be claimed', async () => {
    const { service } = setup();
    await answerAll(service, [0, 0, 0, 0]);
    expect(service.claimRewards('arena-1')).toMatchObject({ correct: 0, energy: 0, ability: null });
  });

  test('expired or unknown arenas return 404', async () => {
    const { service, advance } = setup();
    expect(() => service.getArena('nope')).toThrow(expect.objectContaining({ status: 404 }));
    advance(31 * 60);
    expect(() => service.getArena('arena-1')).toThrow(expect.objectContaining({ status: 404 }));
  });
});
