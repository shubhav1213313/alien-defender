require('dotenv').config({ quiet: true });
const config = require('./config/env');
const { createApp } = require('./app');
const { getPool, checkConnection, closePool } = require('./db/pool');
const { APP_NAME } = require('./routes/healthRoutes');

// Asks whatever is already listening on the port to identify itself.
async function describePortOwner(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(1500) });
    const body = await res.json();
    return body && body.app ? `"${body.app}"` : 'a server that does not identify itself (probably an older copy of the game or another project)';
  } catch {
    return 'a program that is not this game';
  }
}

// A port clash used to crash with a raw EADDRINUSE stack trace that was easy
// to miss - and the browser then silently showed whatever else owned the
// port. Now start-up stops with an explicit explanation instead.
async function explainListenError(err, port) {
  if (err.code !== 'EADDRINUSE') return `Server failed to start: ${err.message}`;
  const owner = await describePortOwner(port);
  return [
    '',
    `ERROR: port ${port} is already in use by ${owner}.`,
    `Alien Defender (${APP_NAME}) did NOT start, so http://localhost:${port} is NOT this game.`,
    'Fix: stop the other server (Ctrl+C in its terminal, or end its node.exe in Task Manager),',
    `     or set a different PORT in .env and open that port instead.`,
    '',
  ].join('\n');
}

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

  async function shutdown(exitCode) {
    if (app.locals.sessionStore.close) await app.locals.sessionStore.close();
    await closePool();
    process.exit(exitCode);
  }

  const server = app.listen(config.port, () => {
    console.log(`Alien Defender (${APP_NAME}) running at http://localhost:${config.port}`);
  });

  server.on('error', async (err) => {
    console.error(await explainListenError(err, config.port));
    await shutdown(1);
  });

  // Close the session store and pool cleanly on Ctrl+C.
  process.on('SIGINT', () => server.close(() => shutdown(0)));
}

start();
