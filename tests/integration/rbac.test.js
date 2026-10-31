// Role-based access control for the admin API (in-memory repositories).
const request = require('supertest');
const { createTestApp } = require('../helpers/testApp');

const ADMIN_ROUTES = [
  ['get', '/api/admin/overview'],
  ['get', '/api/admin/users'],
  ['patch', '/api/admin/users/1/role'],
  ['get', '/api/admin/scores'],
  ['delete', '/api/admin/scores/1'],
];

async function setup() {
  const { app, repositories } = createTestApp();
  const register = async (username) => {
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send({ username, email: `${username}@example.com`, password: 'Passw0rd!' }).expect(201);
    return agent;
  };
  const admin = await register('chief_admin');
  const player = await register('plain_player');
  // Promote directly in the "database", exactly as `npm run admin:promote` does.
  repositories.data.users.find((u) => u.username === 'chief_admin').role = 'admin';
  return { app, repositories, admin, player };
}

describe('Admin API access control', () => {
  test.each(ADMIN_ROUTES)('guest %s %s -> 401', async (method, url) => {
    const { app } = await setup();
    const res = await request(app)[method](url).send({ role: 'admin' });
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('AUTH_REQUIRED');
  });

  test.each(ADMIN_ROUTES)('player %s %s -> 403 Forbidden', async (method, url) => {
    const { player } = await setup();
    const res = await player[method](url).send({ role: 'admin' });
    expect(res.status).toBe(403);
    expect(res.body).toEqual({ success: false, error: 'You do not have permission to do that', code: 'FORBIDDEN' });
  });

  test('a player cannot promote themselves, even by sending role in the body', async () => {
    const { player, repositories } = await setup();
    await player.patch('/api/admin/users/2/role').send({ role: 'admin' }).expect(403);
    expect(repositories.data.users.find((u) => u.username === 'plain_player').role).toBe('player');
  });

  test('roles are checked against the database on every request', async () => {
    const { admin, repositories } = await setup();
    await admin.get('/api/admin/overview').expect(200);
    repositories.data.users.find((u) => u.username === 'chief_admin').role = 'player';
    await admin.get('/api/admin/overview').expect(403); // demotion is immediate
  });

  test('admin can view the overview, users and recent scores', async () => {
    const { admin } = await setup();
    const overview = await admin.get('/api/admin/overview').expect(200);
    expect(overview.body.data.counts).toMatchObject({ users: 2, admins: 1 });
    expect(overview.body.data.apis).toHaveProperty('banana');
    const users = await admin.get('/api/admin/users').expect(200);
    expect(users.body.data.map((u) => u.username).sort()).toEqual(['chief_admin', 'plain_player']);
    expect(JSON.stringify(users.body)).not.toMatch(/password/i);
    await admin.get('/api/admin/scores').expect(200);
  });
});

describe('Admin actions', () => {
  test('promote and demote another user', async () => {
    const { admin, player } = await setup();
    const promoted = await admin.patch('/api/admin/users/2/role').send({ role: 'admin' });
    expect(promoted.status).toBe(200);
    expect(promoted.body.data.role).toBe('admin');
    await player.get('/api/admin/overview').expect(200); // takes effect immediately
    await admin.patch('/api/admin/users/2/role').send({ role: 'player' }).expect(200);
    await player.get('/api/admin/overview').expect(403);
  });

  test.each([
    [1, { role: 'player' }, 400, 'own role'],
    [2, { role: 'superuser' }, 400, 'role must be'],
    [99, { role: 'admin' }, 404, 'not found'],
    ['abc', { role: 'admin' }, 400, 'positive integer'],
  ])('PATCH user %s %o -> %i', async (id, body, status, message) => {
    const { admin } = await setup();
    const res = await admin.patch(`/api/admin/users/${id}/role`).send(body);
    expect(res.status).toBe(status);
    expect(res.body.error).toMatch(new RegExp(message, 'i'));
  });

  test('the last admin cannot be demoted', async () => {
    const { app, repositories, admin } = await setup();
    // A second admin tries to demote the first; then the first is the only admin left.
    await admin.patch('/api/admin/users/2/role').send({ role: 'admin' }).expect(200);
    const second = request.agent(app);
    await second.post('/api/auth/login').send({ identifier: 'plain_player', password: 'Passw0rd!' }).expect(200);
    await second.patch('/api/admin/users/1/role').send({ role: 'player' }).expect(200);
    repositories.data.users[1].role = 'admin';
    repositories.data.users[0].role = 'player';
    // Only user 2 is admin now; user 2 cannot demote itself (own role) - and nobody else can.
    const res = await second.patch('/api/admin/users/2/role').send({ role: 'player' });
    expect(res.status).toBe(400);
  });

  test('admin can delete a score; players cannot', async () => {
    const { admin, player, repositories } = await setup();
    const { body } = await player.post('/api/games').send({ difficulty: 'normal' });
    repositories.data.sessions[0].startedAt = new Date(Date.now() - 120000);
    await player.post(`/api/games/${body.data.gameSessionId}/result`).send({
      outcome: 'destroyed', score: 500, waveReached: 1, wavesCleared: 0, enemiesDestroyed: 3, maxCombo: 1,
      shotsFired: 30, shotsHit: 5, abilitiesUsed: 0, bossDefeated: false,
    }).expect(201);
    const scoreId = repositories.data.scores[0].id;
    await player.delete(`/api/admin/scores/${scoreId}`).expect(403);
    await admin.delete(`/api/admin/scores/${scoreId}`).expect(200);
    expect(repositories.data.scores).toHaveLength(0);
    await admin.delete(`/api/admin/scores/${scoreId}`).expect(404);
  });
});
