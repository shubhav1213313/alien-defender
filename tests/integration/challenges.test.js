// Integration tests for the Knowledge Challenge REST API.
// The Banana API is MOCKED here (see tests/live for the real connectivity check).
// Live Banana behaviour is tested on wave 4; waves 1-3 use the fixed cached puzzles.
const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');
const { ChallengeService } = require('../../src/services/challengeService');
const { PuzzleService } = require('../../src/services/puzzleService');
const { BananaApiError } = require('../../src/services/bananaService');

const SOLUTIONS = [2, 8, 5];

function appWith(fetchPuzzle) {
  let i = 0;
  const puzzles = new PuzzleService({
    fetchPuzzle: fetchPuzzle || (async () => ({ image: `data:image/png;base64,AAAA${i}`, solution: SOLUTIONS[i++ % SOLUTIONS.length], source: 'banana', latencyMs: 250 })),
    logger: { warn: () => {} },
  });
  return createTestApp({ challengeService: new ChallengeService({ puzzleProvider: puzzles }) }).app;
}

async function start(app, body = { kind: 'wave', wave: 4 }) {
  const res = await request(app).post('/api/challenges').send(body);
  expect(res.status).toBe(201);
  return res.body.data.arenaId;
}

async function play(app, id, answers) {
  for (let i = 0; i < answers.length; i += 1) {
    await request(app).get(`/api/challenges/${id}/question`).expect(200);
    await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: i, answer: answers[i] }).expect(200);
  }
}

describe('GET /api/challenges/rules', () => {
  test('post-wave quiz: 2 puzzles and the reward preview', async () => {
    const res = await request(appWith()).get('/api/challenges/rules?kind=wave&wave=2');
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ kind: 'wave', questions: 2, preview: 'SOLVE BOTH PUZZLES TO UNLOCK HYPER BLASTER',
      ability: { id: 'hyperBlaster', name: 'Hyper Blaster', slot: 2 } });
  });

  test('special puzzle: 1 puzzle for VOID STORM', async () => {
    const res = await request(appWith()).get('/api/challenges/rules?kind=special&wave=3');
    expect(res.body.data).toMatchObject({ questions: 1, hintsAllowed: false, ability: { id: 'voidStorm' } });
  });

  test.each(['kind=wave&wave=5', 'kind=bonus&wave=1', 'kind=upgrade&wave=1', 'wave=9'])('rejects %s with 400', async (q) => {
    expect((await request(appWith()).get(`/api/challenges/rules?${q}`)).status).toBe(400);
  });
});

describe('Challenge lifecycle', () => {
  test('creates a 2-question wave quiz', async () => {
    const res = await request(appWith()).post('/api/challenges').send({ kind: 'wave', wave: 3 });
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ kind: 'wave', wave: 3, totalQuestions: 2, hintsAllowed: true });
  });

  test('waves 1-3 are labelled as cached genuine Banana puzzles; wave 4 as live Banana puzzles', async () => {
    const app = appWith();
    for (const wave of [1, 2, 3]) {
      expect((await request(app).get(`/api/challenges/rules?kind=wave&wave=${wave}`)).body.data).toMatchObject({ source: 'banana-cached', note: expect.stringContaining('saved (cached) from the API - the same two every game, not fetched live') });
    }
    expect((await request(app).get('/api/challenges/rules?kind=wave&wave=4')).body.data).toMatchObject({ source: 'banana', note: expect.stringMatching(/Banana API/) });
  });

  test('wave 2 over HTTP: puzzles W2-Q1 then W2-Q2 (images), answers checked on the server, 2/2 unlocks Hyper Blaster', async () => {
    const app = appWith(async () => { throw new Error('the Banana API must not be called for waves 1-3'); });
    const id = await start(app, { kind: 'wave', wave: 2 });
    const expected = [['W2-Q1', 4], ['W2-Q2', 0]];
    for (let i = 0; i < 2; i += 1) {
      const q = await request(app).get(`/api/challenges/${id}/question`).expect(200);
      expect(q.body.data).toMatchObject({ puzzleId: expected[i][0], source: 'banana-cached', image: expect.stringMatching(/^data:image\/png;base64,/) });
      expect(JSON.stringify(q.body)).not.toMatch(/solution|correctAnswer/);
      const a = await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: i, answer: expected[i][1] }).expect(200);
      expect(a.body.data.correct).toBe(true);
    }
    const { body } = await request(app).post(`/api/challenges/${id}/claim`).expect(200);
    expect(body.data).toMatchObject({ correct: 2, ability: { id: 'hyperBlaster' } });
  });

  test('question responses contain the genuine image but never the solution', async () => {
    const app = appWith();
    const id = await start(app);
    const res = await request(app).get(`/api/challenges/${id}/question`);
    expect(res.body.data).toMatchObject({ questionNumber: 1, totalQuestions: 2, source: 'banana', latencyMs: 250 });
    expect(res.body.data.image).toMatch(/^data:image\/png;base64,/);
    expect(JSON.stringify(res.body)).not.toMatch(/solution/);
  });

  test.each([
    [[2, 8], 2, 'empShockwave'],
    [[2, 0], 1, null],
    [[0, 0], 0, null],
  ])('answers %p -> %i/2, ability %p', async (answers, correct, ability) => {
    const app = appWith();
    const id = await start(app);
    await play(app, id, answers);
    const { body } = await request(app).post(`/api/challenges/${id}/claim`).expect(200);
    expect(body.data).toMatchObject({ correct, total: 2 });
    expect(body.data.ability ? body.data.ability.id : null).toBe(ability);
    expect((await request(app).post(`/api/challenges/${id}/claim`)).status).toBe(409); // no duplicate rewards
  });

  test('special puzzle: 1 correct answer unlocks VOID STORM', async () => {
    const app = appWith();
    const id = await start(app, { kind: 'special', wave: 2 });
    await play(app, id, [2]);
    const { body } = await request(app).post(`/api/challenges/${id}/claim`).expect(200);
    expect(body.data.ability).toEqual({ id: 'voidStorm', name: 'VOID STORM', slot: 5 });
  });

  test('duplicate submissions are rejected with 409', async () => {
    const app = appWith();
    const id = await start(app);
    await request(app).get(`/api/challenges/${id}/question`);
    await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: 0, answer: 9 }).expect(200);
    expect((await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: 0, answer: 2 })).status).toBe(409);
  });

  test.each([['abc'], ['-1'], ['1.5'], ['1000'], [{ $gt: 0 }]])('invalid answer %p -> 400', async (answer) => {
    const app = appWith();
    const id = await start(app);
    await request(app).get(`/api/challenges/${id}/question`);
    expect((await request(app).post(`/api/challenges/${id}/answer`).send({ questionIndex: 0, answer })).status).toBe(400);
  });

  test('hint: 200 on a wave quiz, 403 on the special puzzle', async () => {
    const app = appWith();
    const wave = await start(app);
    await request(app).get(`/api/challenges/${wave}/question`);
    expect((await request(app).post(`/api/challenges/${wave}/hint`)).body.data.hint).toMatch(/even|odd/);
    const special = await start(app, { kind: 'special', wave: 1 });
    await request(app).get(`/api/challenges/${special}/question`);
    expect((await request(app).post(`/api/challenges/${special}/hint`)).status).toBe(403);
  });
});

describe('Banana API outage (no fabricated puzzles)', () => {
  test('503 with a clear message and code; Retry succeeds once the API is back', async () => {
    let down = true;
    let i = 0;
    const app = appWith(async () => {
      if (down) throw new BananaApiError('Banana API timed out after 4000ms', 'TIMEOUT');
      return { image: 'data:image/png;base64,AAAA', solution: SOLUTIONS[i++], source: 'banana', latencyMs: 9 };
    });
    const id = await start(app);
    const fail = await request(app).get(`/api/challenges/${id}/question`);
    expect(fail.status).toBe(503);
    expect(fail.body).toEqual({ success: false, code: 'PUZZLE_API_UNAVAILABLE',
      error: 'The Banana puzzle service is unavailable right now. Retry, or continue without the ability.' });
    down = false;
    const retry = await request(app).get(`/api/challenges/${id}/question`);
    expect(retry.status).toBe(200);
    expect(retry.body.data.source).toBe('banana');
  });
});

describe('Rate limiting', () => {
  test('creating too many challenges in a minute returns 429', async () => {
    const { app } = createTestApp({
      challengeService: new ChallengeService({ puzzleProvider: { getPuzzle: async () => ({}) } }),
      rateLimiting: true,
    });
    let last;
    for (let i = 0; i < 21; i += 1) last = await request(app).post('/api/challenges').send({ kind: 'wave', wave: 1 });
    expect(last.status).toBe(429);
  });
});
