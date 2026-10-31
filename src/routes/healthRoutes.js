const express = require('express');

// GET /api/health - liveness check, plus a database check when configured.
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
    res.json({ success: true, status: 'ok', uptimeSeconds: Math.round(process.uptime()), database, databaseLatencyMs });
  });
  return router;
}

module.exports = { createHealthRouter };
