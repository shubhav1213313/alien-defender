// Registration, login, logout and sessions over HTTP.
// Uses in-memory repositories and session store (see tests/helpers).
const request = require('supertest');
const bcrypt = require('bcrypt');
const { createTestApp } = require('../helpers/testApp');

const VALID = { username: 'star_pilot', email: 'Pilot@Example.com', password: 'Galaxy2026' };

function setup(overrides) {
  const { app, repositories } = createTestApp(overrides);
  return { app, repositories, agent: request.agent(app) };
}

describe('POST /api/auth/register', () => {
  test('creates the account, logs in and returns a safe user object', async () => {
    const { agent, repositories } = setup();
    const res = await agent.post('/api/auth/register').send(VALID);
    expect(res.status).toBe(201);
    expect(res.body.data.user).toMatchObject({ username: 'star_pilot', email: 'pilot@example.com', role: 'player', avatar: 'falcon' });
    expect(JSON.stringify(res.body)).not.toMatch(/password/i);
    const me = await agent.get('/api/auth/me');
    expect(me.body.data.user.username).toBe('star_pilot');
    // Stored as a bcrypt hash, never plain text.
    const stored = repositories.data.users[0].passwordHash;
    expect(stored).not.toBe(VALID.password);
    expect(stored).toMatch(/^\$2[aby]\$/);
    expect(await bcrypt.compare(VALID.password, stored)).toBe(true);
  });

  test.each([
    [{ ...VALID, username: 'ab' }, 'username'],
    [{ ...VALID, username: 'bad name!' }, 'username'],
    [{ ...VALID, email: 'not-an-email' }, 'email'],
    [{ ...VALID, password: 'short1' }, 'password'],
    [{ ...VALID, password: 'onlyletters' }, 'password'],
    [{ ...VALID, password: '12345678' }, 'password'],
    [{ ...VALID, password: `a1${'x'.repeat(80)}` }, 'password'],
    [{ ...VALID, avatar: 'dragon' }, 'avatar'],
    [{ ...VALID, username: { $ne: null } }, 'username'],
  ])('rejects invalid input (%#: %s field)', async (body, field) => {
    const res = await request(setup().app).post('/api/auth/register').send(body);
    expect(res.status).toBe(400);
    expect(res.body.details).toHaveProperty(field);
  });

  test('duplicate username or email returns 409', async () => {
    const { app } = setup();
    await request(app).post('/api/auth/register').send(VALID).expect(201);
    const sameName = await request(app).post('/api/auth/register').send({ ...VALID, email: 'other@example.com' });
    expect(sameName.status).toBe(409);
    expect(sameName.body.details).toHaveProperty('username');
    const sameEmail = await request(app).post('/api/auth/register').send({ ...VALID, username: 'another_one' });
    expect(sameEmail.status).toBe(409);
    expect(sameEmail.body.details).toHaveProperty('email');
  });

  test('malformed JSON gets a clean 400', async () => {
    const res = await request(setup().app).post('/api/auth/register').set('Content-Type', 'application/json').send('{"username":');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Request body is not valid JSON' });
  });
});

describe('POST /api/auth/login and logout', () => {
  async function registered() {
    const ctx = setup();
    await request(ctx.app).post('/api/auth/register').send(VALID).expect(201);
    return ctx;
  }

  test('logs in with username or email', async () => {
    const { app } = await registered();
    await request(app).post('/api/auth/login').send({ identifier: 'star_pilot', password: VALID.password }).expect(200);
    const byEmail = await request(app).post('/api/auth/login').send({ identifier: 'PILOT@example.com', password: VALID.password });
    expect(byEmail.status).toBe(200);
    expect(byEmail.body.data.user.username).toBe('star_pilot');
  });

  test('wrong password and unknown user give the same generic 401', async () => {
    const { app } = await registered();
    const wrong = await request(app).post('/api/auth/login').send({ identifier: 'star_pilot', password: 'Wrong12345' });
    const unknown = await request(app).post('/api/auth/login').send({ identifier: 'nobody', password: 'Wrong12345' });
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body.error).toBe(unknown.body.error);
  });

  test('sets an HttpOnly, SameSite session cookie (not Secure on local http)', async () => {
    const { app } = await registered();
    const res = await request(app).post('/api/auth/login').send({ identifier: 'star_pilot', password: VALID.password });
    const cookie = res.headers['set-cookie'].find((c) => c.startsWith('ad.sid='));
    expect(cookie).toMatch(/HttpOnly/);
    expect(cookie).toMatch(/SameSite=Lax/);
    expect(cookie).not.toMatch(/Secure/);
  });

  test('login issues a NEW session id (session fixation protection)', async () => {
    const { app } = await registered();
    const agent = request.agent(app);
    const first = await agent.post('/api/auth/login').send({ identifier: 'star_pilot', password: VALID.password });
    const second = await agent.post('/api/auth/login').send({ identifier: 'star_pilot', password: VALID.password });
    const id = (r) => r.headers['set-cookie'].find((c) => c.startsWith('ad.sid=')).split(';')[0];
    expect(id(first)).not.toBe(id(second));
  });

  test('logout destroys the session', async () => {
    const { app } = await registered();
    const agent = request.agent(app);
    await agent.post('/api/auth/login').send({ identifier: 'star_pilot', password: VALID.password }).expect(200);
    await agent.post('/api/auth/logout').expect(200);
    const me = await agent.get('/api/auth/me');
    expect(me.body.data.user).toBeNull();
    expect((await agent.get('/api/profile')).status).toBe(401);
  });

  test('guests get user: null from /me', async () => {
    const res = await request(setup().app).get('/api/auth/me');
    expect(res.body.data.user).toBeNull();
  });

  test('login is rate limited after 10 failed attempts', async () => {
    const ctx = setup({ rateLimiting: true });
    await request(ctx.app).post('/api/auth/register').send(VALID);
    let last;
    for (let i = 0; i < 11; i += 1) {
      last = await request(ctx.app).post('/api/auth/login').send({ identifier: 'star_pilot', password: 'Wrong12345' });
    }
    expect(last.status).toBe(429);
  });
});

describe('Session timeouts', () => {
  function clockedApp() {
    let clock = Date.now();
    const { app } = createTestApp({ now: () => clock });
    return { app, advanceMinutes: (m) => { clock += m * 60 * 1000; } };
  }

  test('activity keeps the session alive', async () => {
    const { app, advanceMinutes } = clockedApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(VALID).expect(201);
    for (let i = 0; i < 4; i += 1) {
      advanceMinutes(10);
      expect((await agent.get('/api/profile')).status).toBe(200);
    }
  });

  test('15 minutes of inactivity ends the session with a clear 401', async () => {
    const { app, advanceMinutes } = clockedApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(VALID).expect(201);
    advanceMinutes(16);
    const res = await agent.get('/api/profile');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
    expect(res.body.error).toMatch(/15 minutes of inactivity/);
    // The session really is gone, not just rejected once.
    expect((await agent.get('/api/auth/me')).body.data.user).toBeNull();
  });

  test('an absolute 8-hour lifetime applies even to active sessions', async () => {
    const { app, advanceMinutes } = clockedApp();
    const agent = request.agent(app);
    await agent.post('/api/auth/register').send(VALID).expect(201);
    for (let i = 0; i < 8 * 6; i += 1) {
      advanceMinutes(10);
      await agent.get('/api/auth/me');
    }
    advanceMinutes(10);
    const res = await agent.get('/api/profile');
    expect(res.status).toBe(401);
    expect(res.body.code).toBe('SESSION_EXPIRED');
  });
});
