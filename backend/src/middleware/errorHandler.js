const { securityLog } = require('../utils/securityLog');

const PG_ERROR_MAP = {
  '23505': { status: 409, code: 'DUPLICATE_ENTRY', message: 'A record with this value already exists' },
  '23514': { status: 422, code: 'CHECK_VIOLATION', message: 'Data validation failed' },
  '23503': { status: 409, code: 'FOREIGN_KEY_VIOLATION', message: 'Referenced record does not exist' },
  '23502': { status: 422, code: 'NOT_NULL_VIOLATION', message: 'Required field missing' },
};

function errorHandler(err, req, res, _next) {
  const mapped = PG_ERROR_MAP[err.code];
  let status = mapped?.status || err.statusCode || err.status || 500;
  if (!Number.isInteger(status) || status < 400 || status > 599) status = 500;
  let code = mapped?.code || 'INTERNAL_ERROR';
  let message = mapped?.message || 'Request could not be completed';
  if (err.type === 'entity.parse.failed') {
    status = 400;
    code = 'INVALID_JSON';
    message = 'Invalid JSON in request body';
  } else if (err.type === 'entity.too.large') {
    status = 413;
    code = 'PAYLOAD_TOO_LARGE';
    message = 'Request body is too large';
  } else if (typeof err.errorCode === 'string' && /^[A-Z_]{1,64}$/.test(err.errorCode)) {
    code = err.errorCode;
    // Application messages may contain submitted data; return a bounded public message.
    message = code === 'PDF_DISABLED' ? 'PDF generation and download are unavailable during security containment'
      : code === 'ATTACHMENTS_DISABLED' ? 'Purchase attachments are unavailable during security containment'
        : status === 404 ? 'Requested record was not found' : 'Request could not be completed';
  }
  securityLog('request.failed', { requestId: req.requestId, method: req.method, status, code });
  return res.status(status).json({ success: false, error: message, code, requestId: req.requestId });
}

module.exports = errorHandler;
