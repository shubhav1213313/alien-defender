// Persistent games, scores, leaderboard, profile and achievements over HTTP.
// In-memory repositories; the Banana API is mocked.
const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');
const { ChallengeService } = require('../../src/services/challengeService');

const SOLUTION = 7;

function setup() {
  let clock = Date.now();
  const challengeService = new ChallengeService({
    puzzleProvider: { getPuzzle: async () => ({ image: 'data:image/png;base64,AAAA', solution: SOLUTION, source: 'banana', latencyMs: 1 }) },
  });
  const { app, repositories } = createTestApp({ challengeService, now: () => clock });
  // Game sessions record their real start time; moving the server clock
  // forward simulates time spent playing.
  const advance = (seconds) => { clock += seconds * 1000; };
  return { app, repositories, advance };
}

async function player(app, name = 'ace_pilot') {
  const agent = request.agent(app);
  await agent.post('/api/auth/register').send({ username: name, email: `${name}@example.com`, password: 'Defend3rs!' }).expect(201);
  return agent;
}

const result = (overrides = {}) => ({
  outcome: 'destroyed', score: 4200, waveReached: 2, wavesCleared: 1, enemiesDestroyed: 14, maxCombo: 6,
  shotsFired: 300, shotsHit: 90, abilitiesUsed: 0, bossDefeated: false, ...overrides,
});

const VICTORY = result({ outcome: 'victory', score: 98000, waveReached: 5, wavesCleared: 5, enemiesDestroyed: 120, maxCombo: 30, shotsFired: 3000, shotsHit: 1400, bossDefeated: true });

async function playArena(agent, gameSessionId, { wave = 1, difficulty = 'normal', correct = 4 } = {}) {
  const { body } = await agent.post('/api/challenges').send({ wave, difficulty, gameSessionId }).expect(201);
  const id = body.data.arenaId;
  for (let i = 0; i < 4; i += 1) {
    await agent.get(`/api/challenges/${id}/question`).expect(200);
    await agent.post(`/api/challenges/${id}/answer`).send({ questionIndex: i, answer: i < correct ? SOLUTION : 0 }).expect(200);
  }
  return agent.post(`/api/challenges/${id}/claim`).expect(200);
}

describe('Protected game endpoints', () => {
  test.each([
    ['post', '/api/games'],
    ['post', '/api/games/1/result'],
    ['get', '/api/profile'],
  ])('%s %s requires login (401)', async (method, url) => {
    const res = await request(setup().app)[method](url).send({});
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test('leaderboard and achievement catalogue are public', async () => {
    const { app } = setup();
    expect((await request(app).get('/api/leaderboard')).status).toBe(200);
    expect((await request(app).get('/api/achievements')).body.data).toHaveLength(10);
  });
});

describe('Saving a game', () => {
  test('start -> submit stores the score with server-measured duration', async () => {
    const { app, repositories, advance } = setup();
    const agent = await player(app);
    const start = await agent.post('/api/games').send({ difficulty: 'hard' }).expect(201);
    advance(240);
    const res = await agent.post(`/api/games/${start.body.data.gameSessionId}/result`).send(result());
    expect(res.status).toBe(201);
    expect(res.body.data).toMatchObject({ score: 4200, difficulty: 'hard', durationSeconds: 240, personalBest: true });
    expect(repositories.data.scores[0]).toMatchObject({ userId: 1, score: 4200, durationSeconds: 240 });
  });

  test('a game can only be submitted once', async () => {
    const { app, advance } = setup();
    const agent = await player(app);
    const { body } = await agent.post('/api/games').send({ difficulty: 'normal' });
    advance(120);
    await agent.post(`/api/games/${body.data.gameSessionId}/result`).send(result()).expect(201);
    const again = await agent.post(`/api/games/${body.data.gameSessionId}/result`).send(result({ score: 999999 }));
    expect(again.status).toBe(409);
  });

  test("another player's game cannot be submitted (404)", async () => {
    const { app, advance } = setup();
    const alice = await player(app, 'alice');
    const bob = await player(app, 'bob_b');
    const { body } = await alice.post('/api/games').send({ difficulty: 'normal' });
    advance(120);
    expect((await bob.post(`/api/games/${body.data.gameSessionId}/result`).send(result())).status).toBe(404);
  });

  test.each([
    [{ score: -5 }, 400],
    [{ score: 'lots' }, 400],
    [{ outcome: 'won' }, 400],
    [{ bossDefeated: 'yes' }, 400],
    [{ shotsHit: 500, shotsFired: 100 }, 422],
    [{ maxCombo: 50, enemiesDestroyed: 10 }, 422],
    [{ outcome: 'victory', bossDefeated: false }, 422],
    [{ score: 9_000_000 }, 422],
  ])('rejects invalid or implausible result %o with %i', async (overrides, status) => {
    const { app, advance } = setup();
    const agent = await player(app);
    const { body } = await agent.post('/api/games').send({ difficulty: 'normal' });
    advance(120);
    const res = await agent.post(`/api/games/${body.data.gameSessionId}/result`).send(result(overrides));
    expect(res.status).toBe(status);
  });

  test('a full five-wave victory submitted after only 10 seconds is rejected', async () => {
    const { app, advance } = setup();
    const agent = await player(app);
    const { body } = await agent.post('/api/games').send({ difficulty: 'normal' });
    advance(10);
    const res = await agent.post(`/api/games/${body.data.gameSessionId}/result`).send(VICTORY);
    expect(res.status).toBe(422);
    expect(res.body.details.problems).toEqual(expect.arrayContaining(['waves cleared too quickly']));
  });
});

describe('Arena results are recorded by the server', () => {
  test('arena answers linked to the game override whatever the browser claims', async () => {
    const { app, repositories, advance } = setup();
    const agent = await player(app);
    const { body } = await agent.post('/api/games').send({ difficulty: 'normal' });
    const gameSessionId = body.data.gameSessionId;
    await playArena(agent, gameSessionId, { correct: 3 });
    advance(300);
    const res = await agent.post(`/api/games/${gameSessionId}/result`).send({ ...result(), arenaCorrect: 20, arenaQuestions: 20 });
    expect(res.body.data).toMatchObject({ arenaCorrect: 3, arenaQuestions: 4 });
    expect(repositories.data.quiz[0]).toMatchObject({ userId: 1, gameSessionId, correct: 3, total: 4 });
  });

  test("an arena cannot be attached to someone else's game", async () => {
    const { app } = setup();
    const alice = await player(app, 'alice');
    const bob = await player(app, 'bob_b');
    const { body } = await alice.post('/api/games').send({ difficulty: 'normal' });
    const res = await bob.post('/api/challenges').send({ wave: 1, difficulty: 'easy', gameSessionId: body.data.gameSessionId });
    expect(res.status).toBe(404);
  });

  test("a logged-in player's arena is invisible to other players", async () => {
    const { app } = setup();
    const alice = await player(app, 'alice');
    const bob = await player(app, 'bob_b');
    const { body } = await alice.post('/api/challenges').send({ wave: 1, difficulty: 'easy' }).expect(201);
    expect((await bob.get(`/api/challenges/${body.data.arenaId}/question`)).status).toBe(404);
    expect((await request(app).get(`/api/challenges/${body.data.arenaId}/question`)).status).toBe(404);
  });

  test('guests can still play arenas (nothing is saved)', async () => {
    const { app, repositories } = setup();
    const guest = request.agent(app);
    await playArena(guest, undefined);
    expect(repositories.data.quiz).toHaveLength(0);
  });
});

describe('Achievements, profile and leaderboard', () => {
  test('achievements unlock from real events, once each', async () => {
    const { app, advance } = setup();
    const agent = await player(app);
    let { body } = await agent.post('/api/games').send({ difficulty: 'hard' });
    const first = body.data.gameSessionId;
    await playArena(agent, first, { wave: 1, correct: 4 });
    advance(600);
    const res = await agent.post(`/api/games/${first}/result`).send(VICTORY);
    const ids = res.body.data.newAchievements.map((a) => a.id).sort();
    expect(ids).toEqual(['boss_slayer', 'combo_master', 'first_blood', 'first_victory', 'hard_victory', 'perfect_quiz', 'wave_survivor']);

    ({ body } = await agent.post('/api/games').send({ difficulty: 'hard' }));
    advance(600);
    const second = await agent.post(`/api/games/${body.data.gameSessionId}/result`).send(VICTORY);
    expect(second.body.data.newAchievements).toEqual([]); // already unlocked
  });

  test('a short failed game unlocks nothing it did not earn', async () => {
    const { app, advance } = setup();
    const agent = await player(app);
    const { body } = await agent.post('/api/games').send({ difficulty: 'easy' });
    advance(30);
    const res = await agent.post(`/api/games/${body.data.gameSessionId}/result`).send(result({ enemiesDestroyed: 0, maxCombo: 0, shotsHit: 0, score: 0 }));
    expect(res.body.data.newAchievements).toEqual([]);
  });

  test('Legendary Defender requires a server-recorded 4/4 Hard post-boss arena', async () => {
    const { app, advance } = setup();
    const agent = await player(app);
    const { body } = await agent.post('/api/games').send({ difficulty: 'normal' });
    await playArena(agent, body.data.gameSessionId, { wave: 5, difficulty: 'hard', correct: 4 });
    advance(600);
    const res = await agent.post(`/api/games/${body.data.gameSessionId}/result`).send(VICTORY);
    expect(res.body.data.newAchievements.map((a) => a.id)).toContain('legendary_defender');
  });

  test('profile shows lifetime stats, recent games and the trophy showcase', async () => {
    const { app, advance } = setup();
    const agent = await player(app);
    for (const score of [1000, 5000]) {
      const { body } = await agent.post('/api/games').send({ difficulty: 'normal' });
      advance(120);
      await agent.post(`/api/games/${body.data.gameSessionId}/result`).send(result({ score }));
    }
    const { body } = await agent.get('/api/profile').expect(200);
    expect(body.data.stats).toMatchObject({ gamesPlayed: 2, highScore: 5000, enemiesDestroyed: 28, accuracy: 30 });
    expect(body.data.recentScores.map((s) => s.score)).toEqual([5000, 1000]);
    expect(body.data.achievements).toHaveLength(10);
    expect(body.data.achievements.find((a) => a.id === 'first_blood').unlocked).toBe(true);
    expect(body.data.achievements.find((a) => a.id === 'boss_slayer').unlocked).toBe(false);
  });

  test('leaderboard ranks each player by their best score and filters by difficulty', async () => {
    const { app, advance } = setup();
    const scoresByPlayer = { alice: [3000, 9000], bob_b: [7000], cara_c: [5000] };
    for (const [name, list] of Object.entries(scoresByPlayer)) {
      const agent = await player(app, name);
      for (const score of list) {
        const { body } = await agent.post('/api/games').send({ difficulty: name === 'cara_c' ? 'hard' : 'normal' });
        advance(120);
        await agent.post(`/api/games/${body.data.gameSessionId}/result`).send(result({ score }));
      }
    }
    const all = (await request(app).get('/api/leaderboard')).body.data;
    expect(all.map((r) => [r.rank, r.username, r.score])).toEqual([[1, 'alice', 9000], [2, 'bob_b', 7000], [3, 'cara_c', 5000]]);
    const hard = (await request(app).get('/api/leaderboard?difficulty=hard')).body.data;
    expect(hard.map((r) => r.username)).toEqual(['cara_c']);
    expect((await request(app).get('/api/leaderboard?difficulty=insane')).status).toBe(400);
    expect((await request(app).get('/api/leaderboard?limit=500')).status).toBe(400);
  });
});
