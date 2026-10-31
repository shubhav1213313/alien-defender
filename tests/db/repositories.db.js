// REAL MySQL tests for the repositories and the full HTTP stack with a
// MySQL session store. Not part of `npm test`.
// Run with: npm run test:db   (uses DB_* credentials from .env and a
// separate database, alien_defender_test, which is dropped and recreated).
require('dotenv').config({ quiet: true });
const mysql = require('mysql2/promise');
const request = require('supertest');
const config = require('../../src/config/env');
const { migrate } = require('../../scripts/migrate');
const { createApp, createRepositories } = require('../../src/app');

const TEST_DB = 'alien_defender_test';
jest.setTimeout(60000);

let pool;
let repos;

beforeAll(async () => {
  const admin = await mysql.createConnection({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password });
  await admin.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await admin.end();
  await migrate({ database: TEST_DB, log: () => {} });
  pool = mysql.createPool({ host: config.db.host, port: config.db.port, user: config.db.user, password: config.db.password, database: TEST_DB, timezone: 'Z', connectionLimit: 5 });
  repos = createRepositories(pool);
});

afterAll(async () => {
  if (pool) await pool.end();
});

describe('Migration', () => {
  test('creates every table and seeds 10 achievements', async () => {
    const [tables] = await pool.query('SHOW TABLES');
    const names = tables.map((t) => Object.values(t)[0]).sort();
    expect(names).toEqual(['achievements', 'game_sessions', 'quiz_attempts', 'schema_migrations', 'scores', 'sessions', 'user_achievements', 'users']);
    expect(await repos.achievements.all()).toHaveLength(10);
  });

  test('running it again applies nothing', async () => {
    expect(await migrate({ database: TEST_DB, log: () => {} })).toBe(0);
  });
});

describe('UserRepository', () => {
  test('creates and finds users; UNIQUE constraints reject duplicates', async () => {
    const id = await repos.users.create({ username: 'db_user', email: 'db@example.com', passwordHash: 'x'.repeat(60) });
    expect(await repos.users.findById(id)).toMatchObject({ username: 'db_user', role: 'player' });
    expect(await repos.users.findById(id)).not.toHaveProperty('passwordHash');
    expect((await repos.users.findForLogin('db@example.com')).passwordHash).toHaveLength(60);
    await expect(repos.users.create({ username: 'DB_USER', email: 'other@example.com', passwordHash: 'x'.repeat(60) }))
      .rejects.toMatchObject({ code: 'ER_DUP_ENTRY' });
  });

  test('SQL injection attempts are treated as plain text', async () => {
    expect(await repos.users.findForLogin("' OR '1'='1")).toBeNull();
    expect(await repos.users.findForLogin('db_user\' -- ')).toBeNull();
  });
});

describe('GameRepository + QuizAttemptRepository + AchievementRepository', () => {
  let userId;
  beforeAll(async () => {
    userId = await repos.users.create({ username: 'gamer', email: 'gamer@example.com', passwordHash: 'x'.repeat(60) });
  });

  const row = (over = {}) => ({
    userId: null, difficulty: 'normal', outcome: 'destroyed', score: 1000, waveReached: 2, enemiesDestroyed: 10, maxCombo: 3,
    shotsFired: 100, shotsHit: 40, bossDefeated: false, arenaCorrect: 2, arenaQuestions: 4, abilitiesUsed: 1, durationSeconds: 90, ...over,
  });

  test('a session can be finished only once (transaction + condition)', async () => {
    const sessionId = await repos.games.startSession(userId, 'normal');
    expect(await repos.games.findSession(sessionId)).toMatchObject({ userId, difficulty: 'normal', finishedAt: null });
    const results = await Promise.all([
      repos.games.finishSession(sessionId, row({ userId })),
      repos.games.finishSession(sessionId, row({ userId, score: 5 })),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    const [scores] = await pool.execute('SELECT COUNT(*) AS n FROM scores WHERE game_session_id = ?', [sessionId]);
    expect(scores[0].n).toBe(1);
  });

  test('CHECK constraint blocks impossible arena totals', async () => {
    const sessionId = await repos.games.startSession(userId, 'easy');
    await expect(repos.games.finishSession(sessionId, row({ userId, arenaCorrect: 5, arenaQuestions: 4 }))).rejects.toThrow();
    // The failed transaction was rolled back, so the session is still open.
    expect((await repos.games.findSession(sessionId)).finishedAt).toBeNull();
  });

  test('stats, recent scores and best score', async () => {
    const s = await repos.games.startSession(userId, 'normal');
    await repos.games.finishSession(s, row({ userId, score: 7000, bossDefeated: true, outcome: 'victory' }));
    const stats = await repos.games.userStats(userId);
    expect(stats).toMatchObject({ gamesPlayed: 2, highScore: 7000, bossVictories: 1, victories: 1 });
    expect(typeof stats.enemiesDestroyed).toBe('number');
    expect((await repos.games.recentScores(userId, 1))[0].score).toBe(7000);
    expect(await repos.games.bestScore(userId, 'normal')).toBe(7000);
    expect(await repos.games.bestScore(userId, 'hard')).toBeNull();
  });

  test('leaderboard shows one best row per player', async () => {
    const other = await repos.users.create({ username: 'rival', email: 'rival@example.com', passwordHash: 'x'.repeat(60) });
    const s = await repos.games.startSession(other, 'hard');
    await repos.games.finishSession(s, row({ userId: other, difficulty: 'hard', score: 8000 }));
    const board = await repos.games.leaderboard({ difficulty: 'all', limit: 10 });
    expect(board.map((r) => [r.rank, r.username, r.score])).toEqual([[1, 'rival', 8000], [2, 'gamer', 7000]]);
    expect((await repos.games.leaderboard({ difficulty: 'hard', limit: 10 })).map((r) => r.username)).toEqual(['rival']);
  });

  test('quiz totals per session and per user', async () => {
    const s = await repos.games.startSession(userId, 'normal');
    await repos.quizAttempts.record({ userId, gameSessionId: s, wave: 1, difficulty: 'easy', correct: 4, total: 4 });
    await repos.quizAttempts.record({ userId, gameSessionId: s, wave: 5, difficulty: 'hard', correct: 4, total: 4 });
    expect(await repos.quizAttempts.totalsForSession(s)).toEqual({ correct: 8, total: 8 });
    expect(await repos.quizAttempts.userTotals(userId)).toEqual({ correct: 8, total: 8, perfectCount: 2, legendaryCount: 1 });
  });

  test('achievements unlock once (INSERT IGNORE)', async () => {
    expect(await repos.achievements.unlock(userId, ['first_blood', 'boss_slayer'])).toEqual(['first_blood', 'boss_slayer']);
    expect(await repos.achievements.unlock(userId, ['first_blood', 'perfect_quiz'])).toEqual(['perfect_quiz']);
    const mine = await repos.achievements.forUser(userId);
    expect(mine.filter((a) => a.unlocked).map((a) => a.id)).toEqual(['first_blood', 'boss_slayer', 'perfect_quiz']);
  });
});

describe('AdminRepository', () => {
  test('overview counts, user list with stats, roles, score moderation', async () => {
    const counts = await repos.admin.overview();
    expect(counts.users).toBeGreaterThanOrEqual(3);
    expect(counts.gamesFinished).toBeGreaterThanOrEqual(3);
    const users = await repos.admin.listUsers(50);
    const gamer = users.find((u) => u.username === 'gamer');
    expect(gamer).toMatchObject({ role: 'player', bestScore: 7000 });
    expect(gamer.gamesPlayed).toBeGreaterThanOrEqual(2);
    expect(gamer).not.toHaveProperty('password_hash');

    expect(await repos.admin.countAdmins()).toBe(0);
    expect(await repos.admin.setRole(gamer.id, 'admin')).toBe(true);
    expect(await repos.admin.countAdmins()).toBe(1);
    await expect(repos.admin.setRole(gamer.id, 'superuser')).rejects.toThrow(); // ENUM rejects unknown roles

    const [latest] = await repos.admin.recentScores(1);
    expect(await repos.admin.deleteScore(latest.id)).toBe(true);
    expect(await repos.admin.deleteScore(latest.id)).toBe(false);
  });
});

describe('Full stack with MySQL session store, CSRF and RBAC enabled', () => {
  test('register, session in MySQL, admin 403 -> promote -> 200, logout', async () => {
    const app = createApp({ pool, rateLimiting: false, bcryptRounds: 4 }); // CSRF on by default
    const agent = request.agent(app);
    const csrf = (await agent.get('/api/csrf-token')).body.data.csrfToken;
    await agent.post('/api/auth/register').send({ username: 'stack_user', email: 'stack@example.com', password: 'Stack1234' }).expect(403);
    const reg = await agent.post('/api/auth/register').set('X-CSRF-Token', csrf)
      .send({ username: 'stack_user', email: 'stack@example.com', password: 'Stack1234' }).expect(201);
    const token = reg.body.data.csrfToken;

    const [sessions] = await pool.query('SELECT data FROM sessions');
    expect(sessions.some((s) => s.data.includes('"userId"'))).toBe(true);
    expect((await agent.get('/api/profile')).status).toBe(200);
    expect((await request(app).get('/api/health')).body.database).toBe('ok');

    expect((await agent.get('/api/admin/overview')).status).toBe(403);
    await pool.execute("UPDATE users SET role = 'admin' WHERE username = 'stack_user'");
    expect((await agent.get('/api/admin/overview')).status).toBe(200);

    await agent.post('/api/auth/logout').set('X-CSRF-Token', token).expect(200);
    expect((await agent.get('/api/profile')).status).toBe(401);
    const [after] = await pool.query('SELECT data FROM sessions');
    expect(after.some((s) => s.data.includes('"userId"'))).toBe(false); // destroyed in MySQL too
    await app.locals.sessionStore.close();
  });
});
