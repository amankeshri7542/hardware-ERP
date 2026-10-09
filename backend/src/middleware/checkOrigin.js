const { validateEnvironment } = require('../config/env');
const { securityLog } = require('../utils/securityLog');
const { corsOrigins } = validateEnvironment();

function checkOrigin(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  if (!corsOrigins.includes(req.get('Origin'))) {
    securityLog('origin.denied', { requestId: req.requestId, method: req.method, status: 403 });
    return res.status(403).json({ success: false, error: 'Request origin is not allowed', code: 'ORIGIN_FORBIDDEN' });
  }
  return next();
}

module.exports = checkOrigin;
