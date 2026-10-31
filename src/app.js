const path = require('path');
const express = require('express');
const helmet = require('helmet');
const config = require('./config/env');
const healthRoutes = require('./routes/healthRoutes');
const { createChallengeRouter } = require('./routes/challengeRoutes');
const { ChallengeService } = require('./services/challengeService');
const { PuzzleService } = require('./services/puzzleService');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Builds the Express application without starting a listener, so tests can
// import it directly with Supertest. Services can be injected so tests can
// replace the real Banana API with mocks.
function createApp({
  challengeService = new ChallengeService({ puzzleProvider: new PuzzleService({ timeoutMs: config.apis.bananaTimeoutMs }) }),
  rateLimiting = true,
} = {}) {
  const app = express();

  // Security headers (CSP, X-Frame-Options, nosniff, ...). Hides X-Powered-By.
  // Helmet's default CSP already allows data: images, which is how puzzle
  // images are delivered - no third-party image host is needed.
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  // Only public/ is served statically - src/, database/ and .env are never
  // reachable from the browser.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api/health', healthRoutes);
  app.use('/api/challenges', createChallengeRouter(challengeService, { limitCreation: rateLimiting }));

  app.use('/api', notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
