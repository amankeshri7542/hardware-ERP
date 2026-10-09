const { production, sessionTtlMs } = require('../../config/env').validateEnvironment();

module.exports = {
  cookieName: production ? '__Host-erp_session' : 'erp_session',
  cookieOptions: { httpOnly: true, sameSite: 'strict', secure: production, path: '/' },
  sessionTtlMs,
};
