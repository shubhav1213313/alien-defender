const mysql = require('mysql2/promise');
const config = require('../config/env');

// One shared connection pool for the whole application (singleton).
// A pool keeps a few open connections and lends one to each query, so
// concurrent requests do not queue behind a single connection and a broken
// connection is replaced automatically.
let pool = null;

function getPool() {
  if (!pool) {
    pool = mysql.createPool({
      host: config.db.host,
      port: config.db.port,
      user: config.db.user,
      password: config.db.password,
      database: config.db.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
      // Dates come back as JS Date objects in UTC.
      timezone: 'Z',
    });
  }
  return pool;
}

// Used by the health endpoint and startup check.
async function checkConnection(target = getPool()) {
  const started = Date.now();
  await target.query('SELECT 1');
  return { ok: true, latencyMs: Date.now() - started };
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, checkConnection, closePool };
