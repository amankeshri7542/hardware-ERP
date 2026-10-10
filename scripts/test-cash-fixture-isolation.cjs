const { test } = require('node:test');
const assert = require('node:assert/strict');
const { Pool } = require('../backend/node_modules/pg');
const { disposableDatabase } = require('../backend/tests/helpers/disposableDatabase');
const { getCashMovements } = require('../backend/src/modules/settlements/cashMovements');

test('corrupt fixture reports reject while a separately migrated restricted book reconciles', async () => {
  const corruptDatabase = await disposableDatabase('cash_corrupt');
  const cleanDatabase = await disposableDatabase('cash_clean');
  process.env.DB_NAME = corruptDatabase;
  const h = require('../backend/tests/helpers/financial');
  let clean;
  try {
    const actor = await h.setupActor(); const customer = await h.fixtureCustomer();
    const { rows: [payment] } = await h.ownerPool.query(`INSERT INTO payments(customer_id,amount,mode,payment_date,created_by)
      VALUES($1,10,'mixed','2026-01-15',$2) RETURNING id`, [customer.id, actor.id]);
    await h.ownerPool.query("INSERT INTO payment_modes_detail(payment_id,mode,amount) VALUES($1,'cash',4),($1,'upi',4)", [payment.id]);
    const before = (await h.ownerPool.query('SELECT id,amount,mode FROM payments WHERE id=$1', [payment.id])).rows;
    const response = await h.request(h.app).get('/api/finance/reports').set('Cookie', actor.cookie);
    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'CASH_RECONCILIATION_REQUIRED');
    assert.ok(response.body.requestId, 'Capture the correlated rejection, not an auth failure');
    assert.notEqual(cleanDatabase, corruptDatabase);
    clean = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: cleanDatabase,
      user: process.env.TEST_APP_DB_USER, password: process.env.TEST_APP_DB_PASSWORD });
    assert.deepEqual(await getCashMovements(clean), []);
    const { rows: [role] } = await clean.query('SELECT current_user AS name,rolsuper,rolcreatedb FROM pg_roles WHERE rolname=current_user');
    assert.deepEqual(role, { name: process.env.TEST_APP_DB_USER, rolsuper: false, rolcreatedb: false });
    await assert.rejects(clean.query('DELETE FROM customer_ledger'), error => error.code === '42501');
    assert.deepEqual((await h.ownerPool.query('SELECT id,amount,mode FROM payments WHERE id=$1', [payment.id])).rows, before);
    assert.equal((await h.ownerPool.query('SELECT SUM(amount)::text AS total FROM payment_modes_detail WHERE payment_id=$1', [payment.id])).rows[0].total, '8.00');
    console.log(JSON.stringify({ corruptDatabase, cleanDatabase, offendingPayment: payment.id, requestId: response.body.requestId, corruptionRetained: true }));
  } finally { if (clean) await clean.end(); await h.close(); }
});
