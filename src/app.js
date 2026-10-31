const path = require('path');
const express = require('express');
const helmet = require('helmet');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const config = require('./config/env');
const { getPool, checkConnection } = require('./db/pool');
const { UserRepository } = require('./repositories/userRepository');
const { GameRepository } = require('./repositories/gameRepository');
const { QuizAttemptRepository } = require('./repositories/quizAttemptRepository');
const { AchievementRepository } = require('./repositories/achievementRepository');
const { AuthService } = require('./services/authService');
const { ScoreService } = require('./services/scoreService');
const { ChallengeService } = require('./services/challengeService');
const { PuzzleService } = require('./services/puzzleService');
const { QuoteService } = require('./services/quoteService');
const { createInfoRouter } = require('./routes/infoRoutes');
const { createSessionMiddleware, sessionTimeouts } = require('./middleware/session');
const { createHealthRouter } = require('./routes/healthRoutes');
const { createAuthRouter } = require('./routes/authRoutes');
const { createGameRouter } = require('./routes/gameRoutes');
const { createChallengeRouter } = require('./routes/challengeRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Data access layer: one repository per table group, all sharing one pool.
function createRepositories(pool) {
  return {
    users: new UserRepository(pool),
    games: new GameRepository(pool),
    quizAttempts: new QuizAttemptRepository(pool),
    achievements: new AchievementRepository(pool),
  };
}

// Sessions are stored in the MySQL `sessions` table (created by the migration).
function createMySqlSessionStore(pool) {
  const MySQLStore = MySQLStoreFactory(session);
  return new MySQLStore({
    createDatabaseTable: false,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    schema: { tableName: 'sessions', columnNames: { session_id: 'session_id', expires: 'expires', data: 'data' } },
  }, pool);
}

// Builds the Express application without starting a listener, so tests can
// import it directly with Supertest. Every dependency can be injected:
// tests pass in-memory repositories and a memory session store; the real
// server uses MySQL for both.
function createApp(options = {}) {
  const {
    pool = options.repositories && options.sessionStore ? null : getPool(),
    repositories = createRepositories(pool),
    sessionStore = createMySqlSessionStore(pool),
    puzzleService = new PuzzleService({ timeoutMs: config.apis.bananaTimeoutMs }),
    challengeService = new ChallengeService({ puzzleProvider: puzzleService }),
    quoteService = new QuoteService({ timeoutMs: config.apis.quotesTimeoutMs }),
    rateLimiting = true,
    bcryptRounds = config.bcryptRounds,
    now = () => Date.now(),
    checkDatabase = pool ? () => checkConnection(pool) : undefined,
  } = options;

  const auth = new AuthService({ users: repositories.users, bcryptRounds });
  const scores = new ScoreService({ games: repositories.games, quizAttempts: repositories.quizAttempts, achievements: repositories.achievements, now });

  const app = express();
  // Exposed so the server (on shutdown) and tests can call store.close(),
  // which stops the MySQL store's expired-session cleanup timer.
  app.locals.sessionStore = sessionStore;
  app.disable('x-powered-by');
  // In production behind a proxy/HTTPS terminator, trust it so secure cookies work.
  if (config.isProduction) app.set('trust proxy', 1);

  // Security headers (CSP, X-Frame-Options, nosniff, ...). Helmet's default
  // CSP allows data: images, which is how puzzle images are delivered.
  app.use(helmet());

  // Only public/ is served statically - src/, database/ and .env are never
  // reachable. Static files are served before sessions so they never touch
  // the session store.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use(express.json({ limit: '10kb' }));
  app.use('/api', createSessionMiddleware({
    store: sessionStore,
    secret: config.session.secret,
    idleMinutes: config.session.idleMinutes,
    secure: config.isProduction,
  }));
  app.use('/api', sessionTimeouts({
    idleMs: config.session.idleMinutes * 60 * 1000,
    absoluteMs: config.session.absoluteHours * 60 * 60 * 1000,
    now,
  }));

  app.use('/api/health', createHealthRouter({ checkDatabase }));
  app.use('/api/auth', createAuthRouter({ auth, users: repositories.users, now }, { limit: rateLimiting }));
  app.use('/api/challenges', createChallengeRouter(challengeService, { limitCreation: rateLimiting, scores }));
  app.use('/api', createGameRouter({ scores, achievements: repositories.achievements }));
  app.use('/api', createInfoRouter({ quotes: quoteService, puzzles: puzzleService }));

  app.use('/api', notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp, createRepositories };
