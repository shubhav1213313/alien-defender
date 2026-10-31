const session = require('express-session');
const { createApp } = require('../../src/app');
const { QuoteService } = require('../../src/services/quoteService');
const { createMemoryRepositories } = require('./memoryRepositories');

// An app wired to in-memory repositories and an in-memory session store,
// so API tests run without MySQL. bcrypt uses 4 rounds to keep tests fast.
// ZenQuotes is replaced by a fake that fails instantly (fallback quotes),
// so tests never touch the network unless they inject something else.
function createTestApp(overrides = {}) {
  const repositories = overrides.repositories || createMemoryRepositories();
  const app = createApp({
    repositories,
    sessionStore: new session.MemoryStore(),
    rateLimiting: false,
    bcryptRounds: 4,
    quoteService: new QuoteService({ fetchQuotes: async () => { throw Object.assign(new Error('offline in tests'), { code: 'NETWORK' }); }, logger: { warn() {} } }),
    ...overrides,
  });
  return { app, repositories };
}

module.exports = { createTestApp };
