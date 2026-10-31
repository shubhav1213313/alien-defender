const crypto = require('crypto');

// CSRF protection: synchronizer token pattern.
//
// The session cookie is sent automatically by the browser, so another site
// could try to trigger a state-changing request on the player's behalf.
// Every POST/PUT/PATCH/DELETE must therefore carry an X-CSRF-Token header
// matching a random token stored in the server-side session. Another site
// cannot read that token (same-origin policy), so it cannot forge the header.
// SameSite=Lax cookies are a second, independent layer.
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);
const HEADER = 'x-csrf-token';

function newToken() {
  return crypto.randomBytes(32).toString('hex');
}

function tokensMatch(expected, received) {
  if (typeof expected !== 'string' || typeof received !== 'string') return false;
  const a = Buffer.from(expected);
  const b = Buffer.from(received);
  // Constant-time comparison so timing does not leak the token.
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// Issues (or re-issues) the token for this session.
function issueCsrfToken(req) {
  if (!req.session.csrfToken) req.session.csrfToken = newToken();
  return req.session.csrfToken;
}

function csrfProtection(req, res, next) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.session && tokensMatch(req.session.csrfToken, req.get(HEADER))) return next();
  return res.status(403).json({ success: false, error: 'Invalid or missing CSRF token', code: 'CSRF_INVALID' });
}

// GET /api/csrf-token - safe to call any time; creates a (guest) session if needed.
function csrfTokenRoute(req, res) {
  res.json({ success: true, data: { csrfToken: issueCsrfToken(req) } });
}

module.exports = { csrfProtection, csrfTokenRoute, issueCsrfToken, tokensMatch, HEADER };
