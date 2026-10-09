const { isIP } = require('node:net');

function validateEnvironment(env = process.env) {
  const mode = env.NODE_ENV || 'development';
  if (!['development', 'test', 'production'].includes(mode)) throw new Error('Invalid NODE_ENV');
  const production = mode === 'production';
  const sessionSecret = env.SESSION_SECRET || '';
  if (sessionSecret.length < 32 || new Set(sessionSecret).size < 10
    || /change|replace|placeholder|example|development|your[-_ ]|generate[-_ ]/i.test(sessionSecret)
    || (production && /test[-_ ]|testing|synthetic|local[-_ ]/i.test(sessionSecret))) {
    throw new Error('SESSION_SECRET must be a non-placeholder random secret of at least 32 characters');
  }
  if (production && env.HTTPS_ENABLED !== 'true') throw new Error('Production requires HTTPS_ENABLED=true');
  const origins = env.CORS_ORIGIN || (production ? '' : 'http://localhost:5173');
  const corsOrigins = origins.split(',').map((origin) => origin.trim());
  for (const origin of corsOrigins) {
    let parsed;
    try { parsed = new URL(origin); } catch { throw new Error('CORS_ORIGIN requires explicit origins'); }
    if (parsed.origin !== origin || !['http:', 'https:'].includes(parsed.protocol) || (production && parsed.protocol !== 'https:')) {
      throw new Error('CORS_ORIGIN must contain exact origins, with HTTPS in production');
    }
  }
  const trustProxy = env.TRUST_PROXY ? env.TRUST_PROXY.split(',').map((entry) => entry.trim()) : false;
  for (const entry of trustProxy || []) {
    const [ip, prefix, ...extra] = entry.split('/');
    const version = isIP(ip);
    if (!version || extra.length || (prefix !== undefined && (!/^\d+$/.test(prefix) || Number(prefix) < 1 || Number(prefix) > (version === 4 ? 32 : 128)))) {
      throw new Error('TRUST_PROXY must contain explicit IP addresses or bounded CIDRs');
    }
  }
  const storageDriver = env.STORAGE_DRIVER || 'disabled';
  if (!['disabled', 'local', 's3'].includes(storageDriver)) throw new Error('Invalid STORAGE_DRIVER');
  return { production, corsOrigins, trustProxy, sessionSecret, sessionTtlMs: 8 * 60 * 60 * 1000, storageDriver };
}

module.exports = { validateEnvironment };
