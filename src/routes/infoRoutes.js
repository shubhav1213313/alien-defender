const express = require('express');
const { AppError } = require('../errors');
const { CONTEXTS } = require('../services/quoteService');
const { asyncHandler } = require('./asyncHandler');

//   GET /api/quotes/random?context=menu|gameover|victory
//   GET /api/status   last measured status/latency of both external APIs
function createInfoRouter({ quotes, puzzles }) {
  const router = express.Router();

  router.get('/quotes/random', asyncHandler(async (req, res) => {
    const context = req.query.context || 'menu';
    if (!CONTEXTS.includes(context)) throw new AppError(`context must be one of ${CONTEXTS.join(', ')}`, 400);
    res.json({ success: true, data: await quotes.getQuote(context) });
  }));

  // Only reports measurements already taken - it never calls the external
  // APIs itself, so polling it cannot exhaust their rate limits.
  router.get('/status', (req, res) => {
    res.json({ success: true, data: { banana: puzzles.lastStatus, quotes: quotes.status } });
  });

  return router;
}

module.exports = { createInfoRouter };
