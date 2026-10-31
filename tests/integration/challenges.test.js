// Integration tests for the Knowledge Challenge Arena REST API.
// The Banana API is MOCKED here (see tests/live for the real connectivity check).
const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');
const { ChallengeService } = require('../../src/services/challengeService');
const { PuzzleService } = require('../../src/services/puzzleService');
const { BananaApiError } = require('../../src/services/bananaService');

const SOLUTIONS = [2, 8, 5, 0];

function appWith(fetchPuzzle) {
  let i = 0;
  const puzzles = new PuzzleService({
    fetchPuzzle: fetchPuzzle || (async () => ({ image: 'data:image/png;base64,AAAA', solution: SOLUTIONS[i++ % 4], source: 'banana', latencyMs: 250 })),
    logger: { warn: () => {} },
  });
  return createTestApp({ challengeService: new ChallengeService({ puzzleProvider: puzzles }) }).app;
}

async function startArena(app, wave = 1, difficulty = 'normal') {
  const res = await request(app).post('/api/challenges').send({ wave, difficulty });
  expect(res.status).toBe(201);
  return res.body.data.arenaId;
}

async function playArena(app, id, answers) {
  for (let i = 0; i < 4; i += 1) {
    await request(app).get(`/api/challenges/${id}/question`).expect(200);
    await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: i, answer: answers[i] }).expect(200);
  }
}

describe('GET /api/challenges/rules', () => {
  test('returns all three difficulties with reward tables', async () => {
    const res = await request(appWith()).get('/api/challenges/rules?wave=2');
    expect(res.status).toBe(200);
    expect(res.body.data.difficulties.map((d) => d.id)).toEqual(['easy', 'normal', 'hard']);
    expect(res.body.data.abilities).toEqual({ standard: 'rapidFire', elite: 'phantomOverdrive' });
  });

  test('rejects an invalid wave with 400', async () => {
    const res = await request(appWith()).get('/api/challenges/rules?wave=9');
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
  });
});

describe('Arena lifecycle', () => {
  test('creates an arena for the chosen difficulty', async () => {
    const res = await request(appWith()).post('/api/challenges').send({ wave: 3, difficulty: 'hard' });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ wave: 3, difficulty: 'hard', timeLimitSeconds: 20, hintsAllowed: false, totalQuestions: 4 });
  });

  test.each([
    [{ wave: 1 }, 'difficulty'],
    [{ wave: 'abc', difficulty: 'easy' }, 'wave'],
    [{ wave: 1, difficulty: 'impossible' }, 'difficulty'],
  ])('rejects invalid body %o with 400', async (body, field) => {
    const res = await request(appWith()).post('/api/challenges').send(body);
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(field);
  });

  test('question responses contain the image but never the solution', async () => {
    const app = appWith();
    const id = await startArena(app);
    const res = await request(app).get(`/api/challenges/${id}/question`);
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ questionNumber: 1, totalQuestions: 4, source: 'banana', latencyMs: 250 });
    expect(JSON.stringify(res.body)).not.toMatch(/solution/);
  });

  test('correct and incorrect answers are marked, with the right answer revealed', async () => {
    const app = appWith();
    const id = await startArena(app);
    await request(app).get(`/api/challenges/${id}/question`);
    const right = await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: 0, answer: '2' });
    expect(right.body.data).toMatchObject({ correct: true, correctAnswer: 2 });
    await request(app).get(`/api/challenges/${id}/question`);
    const wrong = await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: 1, answer: 3 });
    expect(wrong.body.data).toMatchObject({ correct: false, correctAnswer: 8, answered: 2 });
  });

  test('duplicate submissions are rejected with 409', async () => {
    const app = appWith();
    const id = await startArena(app);
    await request(app).get(`/api/challenges/${id}/question`);
    await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: 0, answer: 9 }).expect(200);
    const again = await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: 0, answer: 2 });
    expect(again.status).toBe(409);
  });

  test.each([['abc'], ['-1'], ['1.5'], ['1000'], [{ $gt: 0 }]])('invalid answer %p is rejected with 400', async (answer) => {
    const app = appWith();
    const id = await startArena(app);
    await request(app).get(`/api/challenges/${id}/question`);
    const res = await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: 0, answer });
    expect(res.status).toBe(400);
  });

  test('rewards: 409 before completion, then once only', async () => {
    const app = appWith();
    const id = await startArena(app, 4, 'hard');
    expect((await request(app).post(`/api/challenges/${id}/claim`)).status).toBe(409);
    await playArena(app, id, SOLUTIONS);
    const claim = await request(app).post(`/api/challenges/${id}/claim`);
    expect(claim.status).toBe(200);
    expect(claim.body.data).toMatchObject({ correct: 4, ability: { id: 'ultimateNova', tier: 'elite', slot: 4 } });
    const again = await request(app).post(`/api/challenges/${id}/claim`);
    expect(again.status).toBe(409);
  });

  test.each([
    [[2, 8, 5, 0], 4], [[2, 8, 5, 9], 3], [[2, 8, 9, 9], 2], [[2, 9, 9, 9], 1], [[9, 9, 9, 9], 0],
  ])('answers %p score %i/4 and the matching tier', async (answers, expected) => {
    const app = appWith();
    const id = await startArena(app, 2, 'normal');
    await playArena(app, id, answers);
    const { body } = await request(app).post(`/api/challenges/${id}/claim`);
    expect(body.data.correct).toBe(expected);
    expect(body.data.ability ? body.data.ability.tier : null).toBe({ 4: 'enhanced', 3: 'standard' }[expected] || null);
  });

  test('hint endpoint: 200 on Easy, 403 on Hard', async () => {
    const app = appWith();
    const easy = await startArena(app, 1, 'easy');
    await request(app).get(`/api/challenges/${easy}/question`);
    const ok = await request(app).post(`/api/challenges/${easy}/hint`);
    expect(ok.status).toBe(200);
    expect(ok.body.data.hint).toMatch(/even|odd/);
    const hard = await startArena(app, 1, 'hard');
    await request(app).get(`/api/challenges/${hard}/question`);
    expect((await request(app).post(`/api/challenges/${hard}/hint`)).status).toBe(403);
  });

  test('unknown arena ids return 404', async () => {
    const res = await request(appWith()).get('/api/challenges/does-not-exist/question');
    expect(res.status).toBe(404);
  });
});

describe('Banana API outage', () => {
  test('a timed-out Banana API falls back to a labelled offline puzzle, and the arena still completes', async () => {
    const app = appWith(async () => { throw new BananaApiError('Banana API timed out after 4000ms', 'TIMEOUT'); });
    const id = await startArena(app);
    const q = await request(app).get(`/api/challenges/${id}/question`);
    expect(q.status).toBe(200);
    expect(q.body.data).toMatchObject({ source: 'offline', fallbackReason: 'TIMEOUT' });
    expect(q.body.data.image).toMatch(/^data:image\/svg\+xml;base64,/);
    await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: 0, answer: 1 }).expect(200);
    for (let i = 1; i < 4; i += 1) {
      await request(app).get(`/api/challenges/${id}/question`).expect(200);
      await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: i, answer: 1 }).expect(200);
    }
    expect((await request(app).post(`/api/challenges/${id}/claim`)).status).toBe(200);
  });
});

describe('Rate limiting', () => {
  test('creating too many arenas in a minute returns 429', async () => {
    const { app } = createTestApp({
      challengeService: new ChallengeService({ puzzleProvider: { getPuzzle: async () => ({}) } }),
      rateLimiting: true,
    });
    let last;
    for (let i = 0; i < 21; i += 1) last = await request(app).post('/api/challenges').send({ wave: 1, difficulty: 'easy' });
    expect(last.status).toBe(429);
  });
});
