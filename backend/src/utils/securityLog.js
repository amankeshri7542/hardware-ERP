const { randomUUID } = require('node:crypto');

function securityLog(event, fields = {}) {
  const entry = { event, requestId: fields.requestId };
  for (const key of ['userId', 'status', 'method', 'code']) {
    const value = fields[key];
    if (typeof value === 'number' || (typeof value === 'string' && /^[A-Z0-9_]{1,64}$/.test(value))) entry[key] = value;
  }
  console.info(JSON.stringify(entry));
}

function requestContext(req, res, next) {
  req.requestId = randomUUID();
  res.setHeader('X-Request-ID', req.requestId);
  next();
}

module.exports = { securityLog, requestContext };
