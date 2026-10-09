const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const { databaseOptions } = require('../../src/config/database');
test('real PostgreSQL TLS verifies the CA and hostname and requires separate migration credentials', async () => {
  assert.ok(process.env.TEST_DB_TLS_CA, 'Run through scripts/test-db-tls.sh');
  const env = {
    NODE_ENV: 'production', DB_HOST: 'localhost', DB_PORT: process.env.TEST_DB_TLS_PORT,
    DB_NAME: 'tls_test', DB_USER: 'phase1_tls', DB_PASSWORD: 'synthetic-tls-only',
    DB_SSL: 'true', DB_SSL_CA_PATH: process.env.TEST_DB_TLS_CA,
  };
  assert.equal(databaseOptions(env).ssl.rejectUnauthorized, true);
  const client = new Client(databaseOptions(env));
  try { await client.connect(); assert.equal((await client.query('SELECT 1 AS value')).rows[0].value, 1); }
  finally { await client.end(); }
  const wrongHost = new Client(databaseOptions({ ...env, DB_HOST: '127.0.0.1' }));
  try { await assert.rejects(wrongHost.connect(), /IP|altname|hostname|certificate/i); }
  finally { await wrongHost.end(); }
  const wrongCA = new Client(databaseOptions({ ...env, DB_SSL_CA_PATH: process.env.TEST_DB_TLS_WRONG_CA }));
  try { await assert.rejects(wrongCA.connect(), /self.signed|certificate|verify/i); }
  finally { await wrongCA.end(); }
  assert.throws(() => databaseOptions({ ...env, DB_SSL: 'false' }), /DB_SSL=true/);
  assert.throws(() => databaseOptions(env, { migration: true }), /MIGRATION_DB_USER/);
  assert.equal(databaseOptions({ ...env, MIGRATION_DB_USER: 'owner', MIGRATION_DB_PASSWORD: 'synthetic-owner' }, { migration: true }).user, 'owner');
});
