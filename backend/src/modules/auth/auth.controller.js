const authService = require('./auth.service');
const { securityLog } = require('../../utils/securityLog');
const { cookieName, cookieOptions, sessionTtlMs } = require('./sessionCookie');

async function login(req, res, next) {
  try {
    const { email, password } = req.body;
    const user = await authService.findUserByEmail(email);
    const valid = await authService.verifyPassword(password, user?.password_hash);
    if (!user || !valid) {
      securityLog('auth.login_denied', { requestId: req.requestId, status: 401 });
      return res.status(401).json({ success: false, error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    }
    await authService.revokeSession(req.cookies?.[cookieName]);
    const token = await authService.createSession(user);
    if (!token) return res.status(401).json({ success: false, error: 'Invalid email or password', code: 'INVALID_CREDENTIALS' });
    res.clearCookie('refreshToken', { path: '/', httpOnly: true, sameSite: 'lax', secure: cookieOptions.secure });
    res.cookie(cookieName, token, { ...cookieOptions, maxAge: sessionTtlMs });
    res.set('Cache-Control', 'no-store');
    securityLog('auth.login', { requestId: req.requestId, userId: user.id, status: 200 });
    return res.json({ success: true, data: { user: authService.publicUser(user) } });
  } catch (err) {
    return next(err);
  }
}

async function logout(req, res, next) {
  try {
    await authService.revokeSession(req.cookies?.[cookieName]);
    res.clearCookie(cookieName, cookieOptions);
    res.clearCookie('refreshToken', { path: '/', httpOnly: true, sameSite: 'lax', secure: cookieOptions.secure });
    res.set('Cache-Control', 'no-store');
    securityLog('auth.logout', { requestId: req.requestId, status: 200 });
    return res.json({ success: true });
  } catch (err) {
    return next(err);
  }
}

function session(req, res) {
  res.set('Cache-Control', 'no-store');
  return res.json({ success: true, data: { user: req.user } });
}

module.exports = { login, logout, session };
