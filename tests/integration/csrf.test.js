// CSRF protection ENABLED (the default for the real app).
const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');
const { tokensMatch } = require('../../src/middleware/csrf');

function setup(extra = {}) {
  let clock = Date.now();
  const { app, repositories } = createTestApp({ csrf: true, now: () => clock, ...extra });
  return { app, repositories, advanceMinutes: (m) => { clock += m * 60000; } };
}

async function token(agent) {
  const res = await agent.get('/api/csrf-token').expect(200);
  return res.body.data.csrfToken;
}

const USER = { username: 'safe_pilot', email: 'safe@example.com', password: 'Secure123' };

describe('CSRF token endpoint', () => {
  test('issues a 64-hex-char token and keeps it stable within a session', async () => {
    const agent = request.agent(setup().app);
    const a = await token(agent);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(await token(agent)).toBe(a);
  });

  test('different visitors get different tokens', async () => {
    const { app } = setup();
    expect(await token(request.agent(app))).not.toBe(await token(request.agent(app)));
  });
});

describe('State-changing requests', () => {
  test('missing token -> 403 CSRF_INVALID', async () => {
    const agent = request.agent(setup().app);
    await token(agent);
    const res = await agent.post('/api/auth/register').send(USER);
    expect(res.status).toBe(403);
    expect(res.body.code).toBe('CSRF_INVALID');
  });

  test('wrong token -> 403', async () => {
    const agent = request.agent(setup().app);
    await token(agent);
    const res = await agent.post('/api/auth/register').set('X-CSRF-Token', 'f'.repeat(64)).send(USER);
    expect(res.status).toBe(403);
  });

  test("another visitor's token does not work in my session", async () => {
    const { app } = setup();
    const attackerToken = await token(request.agent(app));
    const victim = request.agent(app);
    await token(victim);
    const res = await victim.post('/api/auth/register').set('X-CSRF-Token', attackerToken).send(USER);
    expect(res.status).toBe(403);
  });

  test('a request with no session at all (e.g. a cross-site form) -> 403', async () => {
    const res = await request(setup().app).post('/api/challenges').set('X-CSRF-Token', 'a'.repeat(64)).send({ wave: 1, difficulty: 'easy' });
    expect(res.status).toBe(403);
  });

  test('GET requests never need a token', async () => {
    const { app } = setup();
    await request(app).get('/api/leaderboard').expect(200);
    await request(app).get('/api/challenges/rules?wave=1').expect(200);
  });

  test('valid token -> request succeeds', async () => {
    const agent = request.agent(setup().app);
    const t = await token(agent);
    await agent.post('/api/auth/register').set('X-CSRF-Token', t).send(USER).expect(201);
  });
});

describe('Token lifecycle across login and logout', () => {
  test('login rotates the token: the pre-login token stops working', async () => {
    const { app } = setup();
    const agent = request.agent(app);
    const before = await token(agent);
    const reg = await agent.post('/api/auth/register').set('X-CSRF-Token', before).send(USER).expect(201);
    const after = reg.body.data.csrfToken;
    expect(after).toMatch(/^[0-9a-f]{64}$/);
    expect(after).not.toBe(before);
    await agent.post('/api/games').set('X-CSRF-Token', before).send({ difficulty: 'easy' }).expect(403);
    await agent.post('/api/games').set('X-CSRF-Token', after).send({ difficulty: 'easy' }).expect(201);
  });

  test('after logout the old token is useless', async () => {
    const { app } = setup();
    const agent = request.agent(app);
    const first = await token(agent);
    const reg = await agent.post('/api/auth/register').set('X-CSRF-Token', first).send(USER);
    const t = reg.body.data.csrfToken;
    await agent.post('/api/auth/logout').set('X-CSRF-Token', t).expect(200);
    await agent.post('/api/auth/login').set('X-CSRF-Token', t).send({ identifier: USER.username, password: USER.password }).expect(403);
  });

  test('an expired login session still reports SESSION_EXPIRED (not a CSRF error)', async () => {
    const { app, advanceMinutes } = setup();
    const agent = request.agent(app);
    const first = await token(agent);
    const reg = await agent.post('/api/auth/register').set('X-CSRF-Token', first).send(USER);
    advanceMinutes(16);
    const res = await agent.post('/api/games').set('X-CSRF-Token', reg.body.data.csrfToken).send({ difficulty: 'easy' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });

  test('admin actions are also protected', async () => {
    const { app, repositories } = setup();
    const agent = request.agent(app);
    const first = await token(agent);
    const reg = await agent.post('/api/auth/register').set('X-CSRF-Token', first).send(USER);
    repositories.data.users[0].role = 'admin';
    await agent.delete('/api/admin/scores/1').expect(403);
    const res = await agent.delete('/api/admin/scores/1').set('X-CSRF-Token', reg.body.data.csrfToken);
    expect(res.status).toBe(404); // passed CSRF and RBAC; the score just does not exist
  });
});

describe('Full guest + player flow with CSRF on', () => {
  test('guest arena, then register, game and saved score', async () => {
    const { ChallengeService } = require('../../src/services/challengeService');
    const challengeService = new ChallengeService({ puzzleProvider: { getPuzzle: async () => ({ image: 'data:image/png;base64,AA', solution: 3, source: 'banana', latencyMs: 1 }) } });
    const { app, repositories } = setup({ challengeService });
    const agent = request.agent(app);
    let t = await token(agent);
    const arena = await agent.post('/api/challenges').set('X-CSRF-Token', t).send({ wave: 1, difficulty: 'easy' }).expect(201);
    await agent.get(`/api/challenges/${arena.body.data.arenaId}/question`).expect(200);
    await agent.post(`/api/challenges/${arena.body.data.arenaId}/answer`).set('X-CSRF-Token', t).send({ questionIndex: 0, answer: 3 }).expect(200);

    t = (await agent.post('/api/auth/register').set('X-CSRF-Token', t).send(USER).expect(201)).body.data.csrfToken;
    const game = await agent.post('/api/games').set('X-CSRF-Token', t).send({ difficulty: 'normal' }).expect(201);
    repositories.data.sessions[0].startedAt = new Date(Date.now() - 60000);
    await agent.post(`/api/games/${game.body.data.gameSessionId}/result`).set('X-CSRF-Token', t).send({
      outcome: 'destroyed', score: 100, waveReached: 1, wavesCleared: 0, enemiesDestroyed: 1, maxCombo: 1,
      shotsFired: 10, shotsHit: 1, abilitiesUsed: 0, bossDefeated: false,
    }).expect(201);
  });
});

describe('tokensMatch', () => {
  test.each([
    ['abc', 'abc', true], ['abc', 'abd', false], ['abc', 'abcd', false],
    [undefined, 'abc', false], ['abc', undefined, false], ['abc', ['abc'], false],
  ])('%p vs %p -> %p', (a, b, expected) => {
    expect(tokensMatch(a, b)).toBe(expected);
  });
});
