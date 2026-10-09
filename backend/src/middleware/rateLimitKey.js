const { isIP } = require('node:net');
const { ipKeyGenerator } = require('express-rate-limit');

module.exports = function rateLimitKey(req) {
  // Malformed forwarding headers must neither evade the limit nor enter diagnostic logs.
  return ipKeyGenerator(isIP(req.ip) ? req.ip : req.socket.remoteAddress);
};
