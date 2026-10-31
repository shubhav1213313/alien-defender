require('dotenv').config({ quiet: true });
const config = require('./config/env');
const { createApp } = require('./app');
const { getPool, checkConnection, closePool } = require('./db/pool');

async function start() {
  const pool = getPool();
  try {
    const { latencyMs } = await checkConnection(pool);
    console.log(`MySQL connected (${config.db.host}:${config.db.port}/${config.db.database}, ${latencyMs} ms)`);
  } catch (err) {
    // The game itself still loads; login and saving scores will not work.
    console.error(`WARNING: cannot connect to MySQL (${err.code || err.message}).`);
    if (err.code === 'ER_ACCESS_DENIED_ERROR') console.error('  -> Check DB_USER / DB_PASSWORD in .env');
    if (err.code === 'ER_BAD_DB_ERROR') console.error('  -> Run "npm run db:migrate" to create the database');
    if (err.code === 'ECONNREFUSED') console.error('  -> Is the MySQL80 service running?');
  }

  const app = createApp({ pool });
  const server = app.listen(config.port, () => {
    console.log(`Alien Defender running at http://localhost:${config.port}`);
  });

  // Close the pool cleanly on Ctrl+C.
  process.on('SIGINT', () => {
    server.close(async () => {
      if (app.locals.sessionStore.close) await app.locals.sessionStore.close();
      await closePool();
      process.exit(0);
    });
  });
}

start();
