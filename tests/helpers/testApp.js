const session = require('express-session');
const { createApp } = require('../../src/app');
const { createMemoryRepositories } = require('./memoryRepositories');

// An app wired to in-memory repositories and an in-memory session store,
// so API tests run without MySQL. bcrypt uses 4 rounds to keep tests fast.
function createTestApp(overrides = {}) {
  const repositories = overrides.repositories || createMemoryRepositories();
  const app = createApp({
    repositories,
    sessionStore: new session.MemoryStore(),
    rateLimiting: false,
    bcryptRounds: 4,
    ...overrides,
  });
  return { app, repositories };
}

module.exports = { createTestApp };
