const { test } = require('node:test');
const assert = require('node:assert/strict');
const { validateEnvironment } = require('../../src/config/env');
const { securityLog } = require('../../src/utils/securityLog');
const errorHandler = require('../../src/middleware/errorHandler');
const valid = {
  NODE_ENV: 'production', SESSION_SECRET: require('node:crypto').randomBytes(32).toString('hex'),
  CORS_ORIGIN: 'https://erp.example.invalid', HTTPS_ENABLED: 'true',
  TRUST_PROXY: '127.0.0.1/32,::1/128', STORAGE_DRIVER: 'disabled',
};

test('production accepts explicit secure settings and rejects unsafe configuration without leaking values', () => {
  const config = validateEnvironment(valid);
  assert.equal(config.production, true);
  assert.deepEqual(config.corsOrigins, [valid.CORS_ORIGIN]);
  assert.deepEqual(config.trustProxy, ['127.0.0.1/32', '::1/128']);
  for (const change of [
    { SESSION_SECRET: '' }, { SESSION_SECRET: 'a'.repeat(64) },
    { SESSION_SECRET: 'change-me-to-a-long-random-production-secret' },
    { SESSION_SECRET: 'REPLACE_WITH_A_RANDOM_PRODUCTION_SECRET_VALUE' },
    { SESSION_SECRET: 'development-only-secret-do-not-use-in-production' },
    { SESSION_SECRET: 'test-only-secret-not-for-production-use' },
    { HTTPS_ENABLED: 'false' }, { CORS_ORIGIN: '*' }, { CORS_ORIGIN: 'null' },
    { CORS_ORIGIN: '' }, { CORS_ORIGIN: 'http://erp.example.invalid' },
    { CORS_ORIGIN: 'https://erp.example.invalid/path' },
    { CORS_ORIGIN: 'https://user:password@erp.example.invalid' },
    { TRUST_PROXY: 'true' }, { TRUST_PROXY: '1' }, { TRUST_PROXY: '0.0.0.0/0' },
    { TRUST_PROXY: '10.0.0.1/99' }, { STORAGE_DRIVER: 'automatic' }, { NODE_ENV: 'prod' },
  ]) assert.throws(() => validateEnvironment({ ...valid, ...change }));
  assert.equal(validateEnvironment({ ...valid, NODE_ENV: 'test', HTTPS_ENABLED: 'false', CORS_ORIGIN: 'http://localhost:5173', TRUST_PROXY: '' }).trustProxy, false);
});

test('production cookie is Secure, HttpOnly, host-only and SameSite Strict', () => {
  const { execFileSync } = require('node:child_process');
  const output = execFileSync(process.execPath, ['-e', "process.stdout.write(JSON.stringify(require('./src/modules/auth/sessionCookie')))"],
    { cwd: require('node:path').resolve(__dirname, '../..'), env: { ...process.env, ...valid }, encoding: 'utf8' });
  const cookie = JSON.parse(output);
  assert.equal(cookie.cookieName, '__Host-erp_session');
  assert.deepEqual(cookie.cookieOptions, { httpOnly: true, sameSite: 'strict', secure: true, path: '/' });
});

test('logs and client errors exclude raw errors, passwords, cookies, tokens and connection strings', () => {
  const output = [];
  const original = console.info;
  console.info = (line) => output.push(line);
  try {
    securityLog('test.event', {
      requestId: 'trusted-correlation-id', userId: 2, status: 500, code: '23505',
      password: 'password-marker', cookie: 'cookie-marker', token: 'token-marker',
      connectionString: 'postgres://admin:db-secret@127.0.0.1/db',
    });
    let response;
    const res = { status(value) { this.statusCode = value; return this; }, json(body) { response = body; return this; } };
    const req = { requestId: 'trusted-correlation-id', method: 'POST', path: '/secret-in-url' };
    errorHandler({ code: '23505', message: 'password-marker', detail: 'postgres://admin:db-secret@127.0.0.1/db', stack: 'token-marker' }, req, res, () => {});
    assert.equal(res.statusCode, 409);
    assert.equal(response.error, 'A record with this value already exists');
    errorHandler({ statusCode: 400, message: 'cookie-marker', errorCode: 'APPLICATION_ERROR' }, req, res, () => {});
    assert.equal(res.statusCode, 400);
    const combined = output.join(' ') + JSON.stringify(response);
    for (const marker of ['password-marker', 'cookie-marker', 'token-marker', 'db-secret', 'postgres://', 'secret-in-url']) assert.ok(!combined.includes(marker), marker);
    assert.ok(combined.includes('trusted-correlation-id'));
  } finally { console.info = original; }
});
