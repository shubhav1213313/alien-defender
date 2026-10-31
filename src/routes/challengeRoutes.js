const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createChallengeController } = require('../controllers/challengeController');
const { asyncHandler } = require('./asyncHandler');

// Knowledge Challenge endpoints (kind = wave | bonus | special):
//   GET  /api/challenges/rules?kind=K&wave=N  rules + reward preview
//   POST /api/challenges                { kind, wave, difficulty?, gameSessionId? }
//   GET  /api/challenges/:id            challenge progress
//   GET  /api/challenges/:id/question   current puzzle (no solution)
//   POST /api/challenges/:id/answer     { questionIndex, answer }
//   POST /api/challenges/:id/hint       once per question (not on special puzzles)
//   POST /api/challenges/:id/claim      rewards, once per challenge
function createChallengeRouter(service, { limitCreation = true, scores } = {}) {
  const router = express.Router();
  const c = createChallengeController(service, { scores });

  // Each challenge causes up to two external Banana API calls, so creating
  // challenges is rate limited per client.
  const createLimiter = limitCreation
    ? rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false,
      message: { success: false, error: 'Too many challenges started. Please wait a minute.' } })
    : (req, res, next) => next();

  router.get('/rules', c.rules);
  router.post('/', createLimiter, asyncHandler(c.create));
  router.get('/:id', c.show);
  router.get('/:id/question', asyncHandler(c.question));
  router.post('/:id/answer', c.answer);
  router.post('/:id/hint', c.hint);
  router.post('/:id/claim', asyncHandler(c.claim));
  return router;
}

module.exports = { createChallengeRouter };
