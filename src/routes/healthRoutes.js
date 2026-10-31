const express = require('express');

const router = express.Router();

// GET /api/health - liveness check used by tests and the demo.
router.get('/', (req, res) => {
  res.json({ success: true, status: 'ok', uptimeSeconds: Math.round(process.uptime()) });
});

module.exports = router;
