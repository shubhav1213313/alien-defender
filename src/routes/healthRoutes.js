const express = require('express');
const { name: APP_NAME, version: APP_VERSION } = require('../../package.json');

// GET /api/health - liveness check, plus a database check when configured.
// `app` identifies THIS application, so you can tell whether
// http://localhost:3000 is really Alien Defender (alienn-defender) and not
// some other program that happens to be using the port.
function createHealthRouter({ checkDatabase } = {}) {
  const router = express.Router();
  router.get('/', async (req, res) => {
    let database = 'not-configured';
    let databaseLatencyMs = null;
    if (checkDatabase) {
      try {
        databaseLatencyMs = (await checkDatabase()).latencyMs;
        database = 'ok';
      } catch {
        database = 'unavailable';
      }
    }
    res.json({
      success: true, status: 'ok', app: APP_NAME, version: APP_VERSION,
      uptimeSeconds: Math.round(process.uptime()), database, databaseLatencyMs,
    });
  });
  return router;
}

module.exports = { createHealthRouter, APP_NAME };
