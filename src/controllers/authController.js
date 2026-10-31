const { COOKIE_NAME } = require('../middleware/session');
const { issueCsrfToken } = require('../middleware/csrf');

// Session fixation protection: a brand-new session id is issued at login,
// so an id planted before login is useless afterwards.
function regenerate(req) {
  return new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
}

function createAuthController({ auth, users, now = () => Date.now() }) {
  // Returns the new CSRF token: the old one belonged to the old session.
  async function startSession(req, user) {
    await regenerate(req);
    const t = now();
    req.session.userId = user.id;
    req.session.loginAt = t;
    req.session.lastSeen = t;
    return issueCsrfToken(req);
  }

  return {
    async register(req, res) {
      const user = await auth.register(req.body);
      const csrfToken = await startSession(req, user);
      res.status(201).json({ success: true, data: { user, csrfToken } });
    },

    async login(req, res) {
      const user = await auth.login(req.body);
      const csrfToken = await startSession(req, user);
      res.json({ success: true, data: { user, csrfToken } });
    },

    logout(req, res, next) {
      if (!req.session) return res.json({ success: true, data: { loggedOut: true } });
      return req.session.destroy((err) => {
        if (err) return next(err);
        res.clearCookie(COOKIE_NAME);
        return res.json({ success: true, data: { loggedOut: true } });
      });
    },

    // Who am I? Restores the player's identity after a page reload.
    async me(req, res) {
      const user = req.session && req.session.userId ? await users.findById(req.session.userId) : null;
      res.json({ success: true, data: { user, sessionExpired: req.sessionExpired || null } });
    },
  };
}

module.exports = { createAuthController };
