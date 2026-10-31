const path = require('path');
const express = require('express');
const helmet = require('helmet');
const healthRoutes = require('./routes/healthRoutes');
const { notFound, errorHandler } = require('./middleware/errorHandler');

// Builds the Express application without starting a listener, so tests can
// import it directly with Supertest.
function createApp() {
  const app = express();

  // Security headers (CSP, X-Frame-Options, nosniff, ...). Hides X-Powered-By.
  app.use(helmet());
  app.use(express.json({ limit: '10kb' }));

  // Only public/ is served statically - src/, database/ and .env are never
  // reachable from the browser.
  app.use(express.static(path.join(__dirname, '..', 'public')));

  app.use('/api/health', healthRoutes);

  app.use('/api', notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
