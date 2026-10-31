const express = require('express');
const { requireRole } = require('../middleware/authorization');
const { asyncHandler } = require('./asyncHandler');

// Admin dashboard API. EVERY route requires the admin role, checked on the
// server against the database (401 for guests, 403 for players).
//   GET    /api/admin/overview            counts + external API status
//   GET    /api/admin/users               users with games played / best score
//   PATCH  /api/admin/users/:id/role      { role: "player" | "admin" }
//   GET    /api/admin/scores              most recent scores
//   DELETE /api/admin/scores/:id          remove a score (moderation)
function createAdminRouter({ admin, users }) {
  const router = express.Router();
  router.use(requireRole(users, 'admin'));

  router.get('/overview', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await admin.overview() });
  }));
  router.get('/users', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await admin.listUsers() });
  }));
  router.patch('/users/:id/role', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await admin.changeRole(req.user, req.params.id, req.body && req.body.role) });
  }));
  router.get('/scores', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await admin.recentScores() });
  }));
  router.delete('/scores/:id', asyncHandler(async (req, res) => {
    res.json({ success: true, data: await admin.deleteScore(req.params.id) });
  }));

  return router;
}

module.exports = { createAdminRouter };
