// Role-based access control.
//
// The role is read from the DATABASE on every protected request - never
// from the browser and never from a value cached at login - so promoting or
// demoting a user takes effect immediately and cannot be faked by the client.
//   no session         -> 401 (who are you?)
//   wrong role         -> 403 (we know who you are; you may not do this)
function requireRole(users, ...allowedRoles) {
  return async (req, res, next) => {
    try {
      if (!req.session || !req.session.userId) {
        return res.status(401).json({ success: false, error: 'Please log in to continue', code: 'AUTH_REQUIRED' });
      }
      const user = await users.findById(req.session.userId);
      if (!user) {
        return res.status(401).json({ success: false, error: 'Account no longer exists', code: 'AUTH_REQUIRED' });
      }
      if (!allowedRoles.includes(user.role)) {
        return res.status(403).json({ success: false, error: 'You do not have permission to do that', code: 'FORBIDDEN' });
      }
      req.user = user;
      return next();
    } catch (err) {
      return next(err);
    }
  };
}

module.exports = { requireRole };
