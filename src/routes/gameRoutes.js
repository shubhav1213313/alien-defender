const express = require('express');
const { requireAuth } = require('../middleware/session');
const { asyncHandler } = require('./asyncHandler');

// Persistent scores, profile, leaderboard and achievements.
//   POST /api/games                 (login) { difficulty } -> { gameSessionId }
//   POST /api/games/:id/result      (login) final game summary -> saved score + new achievements
//   GET  /api/profile               (login) stats, recent games, trophy showcase
//   GET  /api/leaderboard           ?difficulty=all|easy|normal|hard&limit=1-50
//   GET  /api/achievements          achievement catalogue
function createGameRouter({ scores, achievements }) {
  const router = express.Router();

  router.post('/games', requireAuth, asyncHandler(async (req, res) => {
    const data = await scores.startGame(req.session.userId, req.body && req.body.difficulty);
    res.status(201).json({ success: true, data });
  }));

  router.post('/games/:id/result', requireAuth, asyncHandler(async (req, res) => {
    const data = await scores.submitResult(req.session.userId, req.params.id, req.body || {});
    res.status(201).json({ success: true, data });
  }));

  router.get('/profile', requireAuth, asyncHandler(async (req, res) => {
    res.json({ success: true, data: await scores.profile(req.session.userId) });
  }));

  router.get('/leaderboard', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await scores.leaderboard(req.query) });
  }));

  router.get('/achievements', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await achievements.all() });
  }));

  return router;
}

module.exports = { createGameRouter };
