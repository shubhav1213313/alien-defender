// Centralised configuration. Reads process.env (populated by dotenv in server.js)
// so the rest of the code never touches process.env directly.
function int(value, fallback) {
  const parsed = Number.parseInt(value, 10);
  return Number.isNaN(parsed) ? fallback : parsed;
}

const config = {
  env: process.env.NODE_ENV || 'development',
  port: int(process.env.PORT, 3000),
  db: {
    host: process.env.DB_HOST || 'localhost',
    port: int(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'alien_app',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'alien_defender',
  },
  session: {
    secret: process.env.SESSION_SECRET || 'dev-only-insecure-secret',
    idleMinutes: int(process.env.SESSION_IDLE_MINUTES, 15),
  },
  apis: {
    bananaTimeoutMs: int(process.env.BANANA_API_TIMEOUT_MS, 4000),
    quotesTimeoutMs: int(process.env.QUOTES_API_TIMEOUT_MS, 3000),
  },
};

config.isProduction = config.env === 'production';
config.isTest = config.env === 'test';

module.exports = config;
