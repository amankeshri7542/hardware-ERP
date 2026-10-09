const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const request = require('supertest');
const bcrypt = require('bcrypt');

assert.equal(process.env.NODE_ENV, 'test');
assert.equal(process.env.DB_HOST, '127.0.0.1');
assert.match(process.env.DB_NAME || '', /_test$/);
const { pool } = require('../../src/config/db');
const app = require('../../src/app');
const origin = 'http://localhost:5173';
const output = path.join(__dirname, '../../pdf-output');
let userId, supplierId, purchaseId, invoiceId, cookies;
const email = `containment-${process.pid}@example.invalid`;
const password = 'Synthetic-containment-test-only-37';

before(async () => {
  userId = (await pool.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id',
    ['Synthetic admin', email, await bcrypt.hash(password, 4), 'admin'])).rows[0].id;
  supplierId = (await pool.query('INSERT INTO suppliers(name) VALUES($1) RETURNING id', ['Synthetic supplier'])).rows[0].id;
  purchaseId = (await pool.query('INSERT INTO purchases(supplier_id,created_by) VALUES($1,$2) RETURNING id', [supplierId, userId])).rows[0].id;
  invoiceId = (await pool.query('INSERT INTO invoices(bill_type,customer_name_walkin,created_by) VALUES($1,$2,$3) RETURNING id',
    ['quickbill', '<img src="http://127.0.0.1:9/canary">', userId])).rows[0].id;
  const login = await request(app).post('/api/auth/login').set('Origin', origin).set('X-Forwarded-For', '192.0.2.51').send({ email, password });
  assert.equal(login.status, 200);
  cookies = login.headers['set-cookie'].map(cookie => cookie.split(';')[0]);
});

after(async () => {
  if (invoiceId) await pool.query('DELETE FROM invoices WHERE id=$1', [invoiceId]);
  if (purchaseId) await pool.query('DELETE FROM purchases WHERE id=$1', [purchaseId]);
  if (supplierId) await pool.query('DELETE FROM suppliers WHERE id=$1', [supplierId]);
  if (userId) await pool.query('DELETE FROM users WHERE id=$1', [userId]);
  await pool.end();
});

test('PDF status/download/regeneration API entrypoints are contained', async () => {
  for (const [method, suffix] of [['get', 'pdf-status'], ['get', 'pdf'], ['post', 'regenerate-pdf']]) {
    const result = await request(app)[method](`/api/invoices/${invoiceId}/${suffix}`).set('Cookie', cookies).set('Origin', origin);
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'PDF_DISABLED');
  }
  const invoice = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', cookies);
  assert.equal(invoice.status, 200);
  assert.match(invoice.headers['content-type'], /application\/json/);
  assert.equal(invoice.body.data.customer_name_walkin, '<img src="http://127.0.0.1:9/canary">');
  for (const report of ['sales', 'gst', 'stock', 'stock-movement', 'customer-dues', 'profit', 'collections']) {
    const result = await request(app).get(`/api/reports/${report}/export-pdf`).set('Cookie', cookies);
    assert.equal(result.status, 503, report);
    assert.equal(result.body.code, 'PDF_DISABLED', report);
  }
});

test('attachment spoofing, oversize, invalid/missing parents and retrieval create no files', async () => {
  const beforeFiles = fs.existsSync(output) ? fs.readdirSync(output, { recursive: true }).sort() : [];
  for (const buffer of [Buffer.from('<script>not a PDF</script>'), Buffer.alloc(6 * 1024 * 1024)]) {
    const result = await request(app).post(`/api/purchases/${purchaseId}/invoice`).set('Cookie', cookies).set('Origin', origin)
      .attach('invoice', buffer, { filename: '../../payload.pdf', contentType: 'application/pdf' });
    assert.equal(result.status, 503);
    assert.equal(result.body.code, 'ATTACHMENTS_DISABLED');
  }
  const missing = await request(app).post('/api/purchases/2147483647/invoice').set('Cookie', cookies).set('Origin', origin)
    .attach('invoice', Buffer.from('synthetic'), { filename: 'fixture.pdf', contentType: 'application/pdf' });
  assert.equal(missing.status, 404);
  const invalid = await request(app).post('/api/purchases/not-an-id/invoice').set('Cookie', cookies).set('Origin', origin);
  assert.equal(invalid.status, 400);
  const overflow = await request(app).post('/api/purchases/2147483648/invoice').set('Cookie', cookies).set('Origin', origin);
  assert.equal(overflow.status, 400);
  const retrieval = await request(app).get(`/api/purchases/${purchaseId}/invoice`).set('Cookie', cookies);
  assert.equal(retrieval.status, 503);
  const anonymous = await request(app).post(`/api/purchases/${purchaseId}/invoice`).set('Origin', origin);
  assert.equal(anonymous.status, 401);
  assert.equal((await pool.query('SELECT invoice_file_url FROM purchases WHERE id=$1', [purchaseId])).rows[0].invoice_file_url, null);
  assert.deepEqual(fs.existsSync(output) ? fs.readdirSync(output, { recursive: true }).sort() : [], beforeFiles);
});
