const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcrypt');
const { createHmac } = require('node:crypto');

assert.equal(process.env.NODE_ENV, 'test');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
assert.match(process.env.DB_NAME || '', /_test$/);
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.TRUST_PROXY = '127.0.0.1/32,::1/128';
const app = require('../../src/app');
const { pool } = require('../../src/config/db');
const origin = 'http://localhost:5173';
const password = 'Synthetic-api-password-54';
let nextIp = 10;
const users = [];
const products = [];
after(async () => {
  for (const id of products) {
    await pool.query('DELETE FROM product_unit_conversions WHERE product_id=$1', [id]);
    await pool.query('DELETE FROM products WHERE id=$1', [id]);
  }
  for (const id of users) await pool.query('DELETE FROM users WHERE id=$1', [id]);
  await pool.end();
});
async function fixture(role = 'admin') {
  const email = `security-${process.pid}-${nextIp}@example.invalid`;
  const { rows } = await pool.query(
    'INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4) RETURNING id',
    ['Synthetic user', email, await bcrypt.hash(password, 4), role]);
  users.push(rows[0].id);
  const ip = `192.0.2.${nextIp++}`;
  const login = await request(app).post('/api/auth/login').set('Origin', origin).set('X-Forwarded-For', ip).send({ email, password });
  assert.equal(login.status, 200, JSON.stringify(login.body));
  const cookie = login.headers['set-cookie'].find((value) => value.startsWith('erp_session=')).split(';')[0];
  return { id: rows[0].id, email, ip, cookie, login };
}
function get(path, cookie) { return request(app).get(path).set('Cookie', cookie); }

test('opaque HttpOnly session persists in PostgreSQL as a digest; legacy JWTs cannot authenticate', async () => {
  const user = await fixture();
  assert.equal(user.login.body.data.accessToken, undefined);
  assert.deepEqual(Object.keys(user.login.body.data), ['user']);
  assert.ok(user.login.body.data.user.capabilities.includes('billing.create'));
  const cookieHeader = user.login.headers['set-cookie'].find((value) => value.startsWith('erp_session='));
  assert.match(cookieHeader, /HttpOnly/);
  assert.match(cookieHeader, /SameSite=Strict/);
  assert.match(cookieHeader, /Max-Age=28800/);
  const token = user.cookie.split('=')[1];
  const { rows } = await pool.query('SELECT token_hash,password_fingerprint,expires_at,created_at FROM auth_sessions WHERE user_id=$1', [user.id]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].token_hash, createHmac('sha256', process.env.SESSION_SECRET).update(token).digest('hex'));
  assert.ok(!JSON.stringify(rows).includes(token));
  assert.equal(rows[0].expires_at - rows[0].created_at, 8 * 60 * 60 * 1000);
  assert.equal((await get('/api/auth/session', user.cookie)).status, 200);
  const unsigned = [Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url'),
    Buffer.from(JSON.stringify({ id: user.id, name: 'Synthetic user', role: 'admin', exp: 9999999999 })).toString('base64url')].join('.');
  const jwt = `${unsigned}.${createHmac('sha256', 'old-test-jwt-secret').update(unsigned).digest('base64url')}`;
  assert.equal((await request(app).get('/api/products').set('Authorization', `Bearer ${jwt}`)).status, 401);
  const responses = await Promise.all(Array.from({ length: 6 }, () => get('/api/auth/session', user.cookie)));
  assert.ok(responses.every((response) => response.status === 200));
  const refreshes = await Promise.all(Array.from({ length: 6 }, () => request(app).post('/api/auth/refresh').set('Origin', origin).set('Cookie', user.cookie)));
  assert.ok(refreshes.every((response) => response.status === 200));
  assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM auth_sessions WHERE user_id=$1', [user.id])).rows[0].count, 1);
});

test('fixed expiry rejects the cookie and clears it', async () => {
  const user = await fixture();
  await pool.query("UPDATE auth_sessions SET created_at=NOW()-INTERVAL '2 hour',expires_at=NOW()-INTERVAL '1 hour' WHERE user_id=$1", [user.id]);
  const expired = await get('/api/auth/session', user.cookie);
  assert.equal(expired.status, 401);
  assert.match(expired.headers['set-cookie'][0], /Expires=Thu, 01 Jan 1970/);
});

test('password changes, account disablement and role changes permanently revoke sessions', async () => {
  for (const kind of ['password', 'disable', 'role']) {
    const user = await fixture();
    if (kind === 'password') await pool.query('UPDATE users SET password_hash=$1 WHERE id=$2', [await bcrypt.hash('Another-synthetic-password', 4), user.id]);
    if (kind === 'disable') {
      await pool.query('UPDATE users SET is_active=false WHERE id=$1', [user.id]);
      await pool.query('UPDATE users SET is_active=true WHERE id=$1', [user.id]);
    }
    if (kind === 'role') await pool.query("UPDATE users SET role='cashier' WHERE id=$1", [user.id]);
    assert.equal((await get('/api/auth/session', user.cookie)).status, 401);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS count FROM auth_sessions WHERE user_id=$1', [user.id])).rows[0].count, 0);
  }
});

test('issuance cannot bypass a concurrent password/account change', async () => {
  const user = await fixture();
  const service = require('../../src/modules/auth/auth.service');
  const snapshot = await service.findUserByEmail(user.email);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('UPDATE users SET is_active=false WHERE id=$1', [user.id]);
    const issuing = service.createSession(snapshot);
    await client.query('COMMIT');
    assert.equal(await issuing, null);
    assert.equal((await get('/api/auth/session', user.cookie)).status, 401);
  } finally {
    await client.query('ROLLBACK');
    client.release();
  }
});

test('unsafe operations reject missing/cross-site Origin and do not log out the victim', async () => {
  const user = await fixture();
  for (const badOrigin of [undefined, 'https://attacker.invalid', 'null']) {
    let logout = request(app).post('/api/auth/logout').set('Cookie', user.cookie);
    if (badOrigin !== undefined) logout = logout.set('Origin', badOrigin);
    assert.equal((await logout).status, 403);
    assert.equal((await get('/api/auth/session', user.cookie)).status, 200);
  }
  assert.equal((await request(app).post('/api/auth/login').send({ email: user.email, password })).status, 403);
  const valid = await request(app).post('/api/auth/logout').set('Origin', origin).set('Cookie', user.cookie);
  assert.equal(valid.status, 200);
  assert.equal((await get('/api/auth/session', user.cookie)).status, 401);
  assert.equal((await request(app).post('/api/auth/logout').set('Origin', origin)).status, 200);
});

test('cashier responses omit costs on every catalog read path and deny privileged API calls', async () => {
  const user = await fixture('cashier');
  const admin = await fixture();
  const { rows } = await pool.query(
    'INSERT INTO products (name,sku,barcode,unit,mrp,wholesale_price,purchase_price,current_stock) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id',
    [`SyntheticSecurity${process.pid}`, `sec-sku-${process.pid}`, `sec-barcode-${process.pid}`, 'pcs', 100, 90, 41, 10]);
  const id = rows[0].id;
  products.push(id);
  await pool.query('INSERT INTO product_unit_conversions (product_id,unit_name,conversion_value,is_sales_unit) VALUES ($1,$2,$3,true)', [id, 'box', 12]);
  const paths = ['/api/products', '/api/products/search?q=SyntheticSecurity', `/api/products/search?barcode=sec-barcode-${process.pid}`, `/api/products/barcode/sec-barcode-${process.pid}`, '/api/products/low-stock', `/api/products/${id}`];
  for (const path of paths) {
    const response = await get(path, user.cookie);
    assert.equal(response.status, 200, path);
    assert.ok(!/purchase_price|cost_price|profit|supplier|last_price/.test(JSON.stringify(response.body)), path);
  }
  assert.equal((await get(`/api/products/${id}`, admin.cookie)).body.data.purchase_price, '41.00');
  const publicProduct = (await get(`/api/products/${id}`, user.cookie)).body.data;
  assert.equal(publicProduct.id, id);
  assert.equal(publicProduct.name, `SyntheticSecurity${process.pid}`);
  assert.equal(publicProduct.conversions[0].unit_name, 'box');
  assert.equal(publicProduct.conversions[0].conversion_value, '12.0000');
  const conversions = await get(`/api/products/${id}/unit-conversions`, user.cookie);
  assert.equal(conversions.status, 200);
  assert.equal(conversions.body.data.conversions[0].unit_name, 'box');
  assert.equal(conversions.body.data.conversions[0].conversion_value, '12.0000');
  for (const [method, path] of [
    ['get', `/api/products/${id}/price-history`], ['get', `/api/products/${id}/stock-ledger`],
    ['get', `/api/products/${id}/suppliers`], ['put', `/api/products/${id}`], ['post', '/api/products'],
    ['post', '/api/invoices'], ['post', '/api/invoices/1/return'], ['get', '/api/invoices'],
    ['get', '/api/reports/profit'], ['get', '/api/reports/full-export'], ['get', '/api/settings'],
    ['get', '/api/dashboard/summary'], ['get', '/api/customers'], ['post', '/api/payments'],
    ['post', '/api/purchases'], ['post', '/api/purchases/1/returns'], ['get', '/api/suppliers'],
  ]) {
    const denied = await request(app)[method](path).set('Origin', origin).set('Cookie', user.cookie).send({});
    assert.equal(denied.status, 403, path);
  }
  assert.equal((await get('/api/unclassified-future-route', admin.cookie)).status, 403);
  assert.deepEqual(require('../../src/middleware/authorize').capabilitiesFor('owner'), []);
  assert.deepEqual(require('../../src/middleware/authorize').capabilitiesFor('__proto__'), []);
});

test('authentication errors are generic, validation never returns the password, and logins are rate limited', async () => {
  const user = await fixture();
  const invalid = await request(app).post('/api/auth/login').set('Origin', origin).set('X-Forwarded-For', '192.0.2.230').send({ email: user.email, password: 'wrong' });
  const unknown = await request(app).post('/api/auth/login').set('Origin', origin).set('X-Forwarded-For', '192.0.2.231').send({ email: 'nobody@example.invalid', password: 'wrong' });
  assert.equal(invalid.status, 401);
  assert.deepEqual(invalid.body, unknown.body);
  const logs = [];
  const originalError = console.error;
  const originalInfo = console.info;
  console.error = (...args) => logs.push(JSON.stringify(args));
  console.info = (...args) => logs.push(JSON.stringify(args));
  try {
    const validation = await request(app).post('/api/auth/login').set('Origin', origin).set('X-Forwarded-For', 'sensitive-forwarded-header').send({ email: {}, password: 'sensitive-marker'.repeat(10) });
    assert.equal(validation.status, 422);
    assert.ok(!JSON.stringify(validation.body).includes('sensitive-marker'));
    assert.ok(!logs.join(' ').includes('sensitive-marker'));
    assert.ok(!logs.join(' ').includes('sensitive-forwarded-header'));
    assert.ok(logs.join(' ').includes('validation.failed'));
    assert.match(validation.headers['x-request-id'], /^[0-9a-f-]{36}$/);
  } finally {
    console.error = originalError;
    console.info = originalInfo;
  }
  for (let i = 0; i < 5; i++) {
    assert.equal((await request(app).post('/api/auth/login').set('Origin', origin).set('X-Forwarded-For', '192.0.2.233').send({ email: user.email, password: 'wrong' })).status, 401);
  }
  assert.equal((await request(app).post('/api/auth/login').set('Origin', origin).set('X-Forwarded-For', '192.0.2.233').send({ email: user.email, password })).status, 429);
});

test('restricted application role can log in and revoke sessions without modifying users', async () => {
  assert.ok(process.env.TEST_APP_DB_USER, 'TEST_APP_DB_USER must name the restricted application role');
  assert.ok(process.env.TEST_APP_DB_PASSWORD, 'TEST_APP_DB_PASSWORD must configure the isolated application role');
  const user = await fixture();
  const script = `
    const assert = require('node:assert/strict');
    const request = require('supertest');
    const app = require('./src/app');
    const { pool } = require('./src/config/db');
    (async () => {
      try {
        const { rows } = await pool.query("SELECT has_table_privilege(current_user,'users','UPDATE') AS can_update, has_table_privilege(current_user,'users','INSERT') AS can_insert, has_table_privilege(current_user,'invoices','DELETE') AS can_delete_invoice, has_table_privilege(current_user,'payments','DELETE') AS can_delete_payment");
        assert.equal(rows[0].can_update, false);
        assert.equal(rows[0].can_insert, false);
        assert.equal(rows[0].can_delete_invoice, false);
        assert.equal(rows[0].can_delete_payment, false);
        const login = await request(app).post('/api/auth/login').set('Origin','http://localhost:5173').send({email:process.env.TEST_EMAIL,password:process.env.TEST_PASSWORD});
        assert.equal(login.status, 200, JSON.stringify(login.body));
        const cookie = login.headers['set-cookie'].find((value) => value.startsWith('erp_session=')).split(';')[0];
        assert.equal((await request(app).get('/api/auth/session').set('Cookie',cookie)).status,200);
        assert.equal((await request(app).post('/api/auth/logout').set('Origin','http://localhost:5173').set('Cookie',cookie)).status,200);
        assert.equal((await request(app).get('/api/auth/session').set('Cookie',cookie)).status,401);
      } finally { await pool.end(); }
    })().catch((error) => { console.error(error); process.exitCode=1; });
  `;
  require('node:child_process').execFileSync(process.execPath, ['-e', script], {
    cwd: require('node:path').resolve(__dirname, '../..'),
    env: { ...process.env, DB_USER: process.env.TEST_APP_DB_USER, DB_PASSWORD: process.env.TEST_APP_DB_PASSWORD,
      TEST_EMAIL: user.email, TEST_PASSWORD: password },
    stdio: 'pipe',
  });
});
