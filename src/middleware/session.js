const session = require('express-session');

const COOKIE_NAME = 'ad.sid';

// Cookie-based server-side sessions. Only a random session id is stored in
// the browser cookie; the session data itself lives in MySQL.
//
// Cookie settings:
//   httpOnly - JavaScript in the page cannot read the cookie (limits XSS damage)
//   sameSite - 'lax' stops the cookie being sent on cross-site POSTs
//   secure   - HTTPS-only in production; off locally because
//              http://localhost has no TLS
//   rolling + maxAge - every request pushes expiry forward, so the cookie
//              dies after `idleMinutes` of INACTIVITY
function createSessionMiddleware({ store, secret, idleMinutes, secure }) {
  return session({
    name: COOKIE_NAME,
    secret,
    store, // undefined -> express-session MemoryStore (tests only)
    resave: false,
    saveUninitialized: false, // no session/cookie until someone logs in
    rolling: true,
    cookie: { httpOnly: true, sameSite: 'lax', secure, maxAge: idleMinutes * 60 * 1000 },
  });
}

// Enforces both timeouts on the server too (not just via cookie expiry):
//   inactivity - no request for `idleMs`
//   absolute   - logged in for longer than `absoluteMs`, even if active
// An expired session is destroyed and the request continues as a guest;
// requireAuth then explains why with a 401.
function sessionTimeouts({ idleMs, absoluteMs, now = () => Date.now() }) {
  return (req, res, next) => {
    const s = req.session;
    if (!s || !s.userId) return next();
    const current = now();
    let expired = null;
    if (current - s.lastSeen > idleMs) expired = 'inactivity';
    else if (current - s.loginAt > absoluteMs) expired = 'lifetime';
    if (!expired) {
      s.lastSeen = current;
      return next();
    }
    return s.destroy((err) => {
      if (err) return next(err);
      res.clearCookie(COOKIE_NAME);
      req.sessionExpired = expired;
      return next();
    });
  };
}

// 401 for guests. Never trusts anything sent by the browser except the
// signed session cookie.
function requireAuth(req, res, next) {
  if (req.session && req.session.userId) return next();
  const error = req.sessionExpired === 'inactivity'
    ? 'Your session expired after 15 minutes of inactivity. Please log in again.'
    : req.sessionExpired === 'lifetime'
      ? 'Your session has expired. Please log in again.'
      : 'Please log in to continue';
  return res.status(401).json({ success: false, error, code: req.sessionExpired ? 'SESSION_EXPIRED' : 'AUTH_REQUIRED' });
}

module.exports = { createSessionMiddleware, sessionTimeouts, requireAuth, COOKIE_NAME };
