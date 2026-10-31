const express = require('express');
const { rateLimit } = require('express-rate-limit');
const { createAuthController } = require('../controllers/authController');
const { asyncHandler } = require('./asyncHandler');

//   POST /api/auth/register  { username, email, password, avatar? }
//   POST /api/auth/login     { identifier, password }  (username or email)
//   POST /api/auth/logout
//   GET  /api/auth/me
function createAuthRouter(deps, { limit = true } = {}) {
  const router = express.Router();
  const c = createAuthController(deps);

  // Slows down password guessing: 10 failed logins per 15 minutes per client.
  const loginLimiter = limit
    ? rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, skipSuccessfulRequests: true, standardHeaders: 'draft-7', legacyHeaders: false,
      message: { success: false, error: 'Too many login attempts. Please wait 15 minutes.' } })
    : (req, res, next) => next();
  const registerLimiter = limit
    ? rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-7', legacyHeaders: false,
      message: { success: false, error: 'Too many accounts created. Please try again later.' } })
    : (req, res, next) => next();

  router.post('/register', registerLimiter, asyncHandler(c.register));
  router.post('/login', loginLimiter, asyncHandler(c.login));
  router.post('/logout', c.logout);
  router.get('/me', asyncHandler(c.me));
  return router;
}

module.exports = { createAuthRouter };
