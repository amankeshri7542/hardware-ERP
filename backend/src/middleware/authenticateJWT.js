const { findSession } = require('../modules/auth/auth.service');
const { cookieName, cookieOptions } = require('../modules/auth/sessionCookie');

// The import name is retained for existing routers; bearer tokens are no longer accepted.
async function authenticateSession(req, res, next) {
  if (req.user) return next();
  try {
    const user = await findSession(req.cookies?.[cookieName]);
    res.set('Cache-Control', 'no-store');
    if (!user) {
      res.clearCookie(cookieName, cookieOptions);
      return res.status(401).json({ success: false, error: 'Unauthorized', code: 'UNAUTHORIZED' });
    }
    req.user = user;
    return next();
  } catch (err) {
    return next(err);
  }
}

module.exports = authenticateSession;
