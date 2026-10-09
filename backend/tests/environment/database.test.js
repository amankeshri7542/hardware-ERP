const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { databaseOptions } = require('../../src/config/database');
const local = { NODE_ENV: 'test', DB_HOST: '127.0.0.1', DB_NAME: 'config_test', DB_USER: 'local', DB_PASSWORD: 'synthetic-only' };
test('DB config rejects missing production CA, insecure TLS and malformed CA without exposing values', () => {
  assert.equal(databaseOptions(local).ssl, false);
  assert.throws(() => databaseOptions({ ...local, NODE_ENV: 'prod' }), /NODE_ENV/);
  assert.throws(() => databaseOptions({ ...local, NODE_ENV: undefined }), /NODE_ENV/);
  assert.throws(() => databaseOptions({ ...local, NODE_ENV: 'production', DB_SSL: 'true' }), /DB_SSL_CA_PATH/);
  assert.throws(() => databaseOptions({ ...local, DB_SSL: 'sometimes' }), /DB_SSL/);
  assert.throws(() => databaseOptions({ ...local, DB_PORT: '0' }), /DB_PORT/);
  assert.throws(() => databaseOptions({ ...local, NODE_ENV: 'production', DB_SSL: 'true', DB_SSL_CA_PATH: '/missing/private-secret-value' }), (error) => !error.message.includes('private-secret-value'));
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'erp-invalid-ca-')), 'ca.pem');
  try {
    fs.writeFileSync(file, 'not a certificate');
    assert.throws(() => databaseOptions({ ...local, DB_SSL: 'true', DB_SSL_CA_PATH: file }), /Invalid or unreadable/);
  } finally { fs.rmSync(path.dirname(file), { recursive: true }); }
});
