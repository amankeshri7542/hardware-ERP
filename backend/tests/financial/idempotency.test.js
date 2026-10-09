const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const bcrypt = require('bcrypt');
const { app, request, ownerPool: owner, origin, setupActor, post, fixtureCustomer, close } = require('../helpers/financial');
const { withIdempotency } = require('../../src/utils/idempotency');
const { normalizePaymentIntent, postPayment } = require('../../src/modules/payments/paymentPosting');
const { lockWaiters } = require('../helpers/lockWaiters');

let actor;
let secondAdmin;
before(async () => { actor = await setupActor(); });
async function otherAdmin() {
  if (secondAdmin) return secondAdmin;
  const password = `Synthetic-second-admin-${randomUUID()}`;
  const email = `second-admin-${randomUUID()}@example.invalid`;
  const user = (await owner.query("INSERT INTO users(name,email,password_hash,role) VALUES('Synthetic second admin',$1,$2,'admin') RETURNING id", [email, await bcrypt.hash(password, 4)])).rows[0];
  const login = await request(app).post('/api/auth/login').set('Origin', origin).set('X-Forwarded-For', '192.0.2.50').send({ email, password });
  assert.equal(login.status, 200);
  secondAdmin = { id: user.id, ip: '192.0.2.50', cookie: login.headers['set-cookie'].find(value => value.startsWith('erp_session=')).split(';')[0] };
  return secondAdmin;
}
after(async () => {
  if (secondAdmin) await request(app).post('/api/auth/logout').set('Origin', origin).set('Cookie', secondAdmin.cookie);
  await close();
});
function advance(customer, overrides = {}) {
  return { customer_id: customer.id, amount: '10.00', mode: 'cash', payment_date: '2026-01-15', ...overrides };
}
async function effects(customer) {
  return (await owner.query(`SELECT
    (SELECT COUNT(*)::int FROM payments WHERE customer_id=$1) AS payments,
    (SELECT COUNT(*)::int FROM payment_modes_detail d JOIN payments p ON p.id=d.payment_id WHERE p.customer_id=$1) AS details,
    (SELECT COUNT(*)::int FROM customer_ledger WHERE customer_id=$1) AS ledger,
    outstanding_balance FROM customers WHERE id=$1`, [customer.id])).rows[0];
}
async function reservationCount(key) {
  return (await owner.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE actor_id=$1 AND key=$2', [actor.id, key])).rows[0].n;
}

test('eight concurrent same-key requests wait for one durable receipt and return identical bodies', async () => {
  const customer = await fixtureCustomer();
  const key = randomUUID();
  const blocker = await owner.connect();
  let requests;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [customer.id]);
    const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    requests = Array.from({ length: 8 }, () => post('/payments', advance(customer), { actor, key }));
    let waiting = 0;
    for (let attempt = 0; attempt < 100; attempt++) {
      waiting = await lockWaiters(owner, blockerPid);
      if (waiting >= 8) break;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    assert.ok(waiting >= 8, `Expected all eight requests to overlap, observed ${waiting} lock waits`);
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  const results = await Promise.all(requests);
  assert.ok(results.every(result => result.status === 201), JSON.stringify(results.map(result => ({status:result.status,body:result.body}))));
  for (const result of results) assert.deepEqual(result.body, results[0].body);
  assert.deepEqual(await effects(customer), { payments: 1, details: 1, ledger: 1, outstanding_balance: '-10.00' });
  assert.equal(await reservationCount(key), 1);
});

test('normalized numeric strings and object ordering replay; changed amount or reference conflicts', async () => {
  const customer = await fixtureCustomer();
  const key = randomUUID();
  const initial = await post('/payments', advance(customer, { amount: 10 }), { actor, key });
  assert.equal(initial.status, 201);
  const reordered = { payment_date: '2026-01-15', mode: 'cash', amount: '10.00', customer_id: String(customer.id), invoice_id: null, notes: '', modes_detail: [] };
  const replay = await post('/payments', reordered, { actor, key });
  assert.equal(replay.status, 201);
  assert.deepEqual(replay.body, initial.body);
  for (const change of [{ amount: '11.00' }, { reference_no: 'Changed synthetic reference' }]) {
    const conflict = await post('/payments', advance(customer, change), { actor, key });
    assert.equal(conflict.status, 409);
    assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT');
  }
  assert.deepEqual(await effects(customer), { payments: 1, details: 1, ledger: 1, outstanding_balance: '-10.00' });
});

test('the same key belongs independently to each authenticated actor', async () => {
  await otherAdmin();
  const customer = await fixtureCustomer();
  const key = randomUUID();
  const results = await Promise.all([actor, secondAdmin].map(current => post('/payments', advance(customer), { actor: current, key })));
  assert.ok(results.every(result => result.status === 201));
  assert.notEqual(results[0].body.data.id, results[1].body.data.id);
  assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE key=$1', [key])).rows[0].n, 2);
  for (let index = 0; index < 2; index++) {
    const replay = await post('/payments', advance(customer), { actor: [actor, secondAdmin][index], key });
    assert.deepEqual(replay.body, results[index].body);
  }
  assert.deepEqual(await effects(customer), { payments: 2, details: 2, ledger: 2, outstanding_balance: '-20.00' });
});

test('an account-switched cookie cannot replay another actors uncertain operation', async () => {
  const replacement = await otherAdmin();
  const customer = await fixtureCustomer();
  const key = randomUUID();
  const payload = advance(customer);
  const send = (authenticated, expectedActor) => request(app).post('/api/payments').set('Origin', origin)
    .set('Cookie', authenticated.cookie).set('Idempotency-Key', key).set('Idempotency-Actor', String(expectedActor)).send(payload);
  const original = await send(actor, actor.id);
  assert.equal(original.status, 201);
  const switched = await send(replacement, actor.id);
  assert.equal(switched.status, 409);
  assert.equal(switched.body.code, 'OPERATION_ACTOR_MISMATCH');
  assert.deepEqual(await effects(customer), { payments: 1, details: 1, ledger: 1, outstanding_balance: '-10.00' });
  assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE actor_id=$1 AND key=$2', [replacement.id, key])).rows[0].n, 0);
  const recovered = await send(actor, actor.id);
  assert.deepEqual(recovered.body, original.body);
  const independent = await send(replacement, replacement.id);
  assert.equal(independent.status, 201);
  assert.notEqual(independent.body.data.id, original.body.data.id);
  assert.deepEqual(await effects(customer), { payments: 2, details: 2, ledger: 2, outstanding_balance: '-20.00' });
});

test('financial actor is required and malformed headers cannot reserve a key', async () => {
  const customer = await fixtureCustomer();
  for (const value of [null, '', '0', '-1', '1.5', '1e2', '2147483648', '1,2']) {
    const key = randomUUID();
    let call = request(app).post('/api/payments').set('Origin', origin).set('Cookie', actor.cookie).set('Idempotency-Key', key);
    if (value !== null) call = call.set('Idempotency-Actor', value);
    const result = await call.send(advance(customer));
    assert.equal(result.status, 400);
    assert.equal(result.body.code, 'INVALID_OPERATION_ACTOR');
    assert.equal(await reservationCount(key), 0);
  }
  const cashier = await setupActor('cashier');
  const denied = await request(app).post('/api/payments').set('Origin', origin).set('Cookie', cashier.cookie)
    .set('Idempotency-Key', randomUUID()).send(advance(customer));
  assert.equal(denied.status, 403, 'Capabilities must run before the actor header guard');
  assert.deepEqual(await effects(customer), { payments: 0, details: 0, ledger: 0, outstanding_balance: '0.00' });
});

test('operation names isolate a key within one actor', async () => {
  const key = randomUUID();
  let calls = 0;
  for (const operation of ['test.operation.one', 'test.operation.two']) {
    const args = { actorId: actor.id, operation, key, intent: { value: 'same intent' } };
    const action = async () => ({ status: 201, body: { operation, call: ++calls } });
    const initial = await withIdempotency(args, action);
    const replay = await withIdempotency(args, action);
    assert.equal(initial.replayed, false);
    assert.equal(replay.replayed, true);
    assert.deepEqual(replay.body, initial.body);
  }
  assert.equal(calls, 2);
  assert.equal(await reservationCount(key), 2);
});

test('a late failure rolls back payment, tender, ledger, cache, and key before same-key recovery', async () => {
  const customer = await fixtureCustomer();
  const key = randomUUID();
  const payload = advance(customer);
  const intent = normalizePaymentIntent(payload);
  await assert.rejects(withIdempotency({ actorId: actor.id, operation: 'payment.create', key, intent }, async client => {
    await client.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [customer.id]);
    await postPayment(client, { customerId: customer.id, invoiceId: null, payment: intent.payment, paymentDate: intent.payment_date, userId: actor.id });
    throw new Error('Synthetic failure after all receipt writes');
  }), /Synthetic failure after all receipt writes/);
  assert.deepEqual(await effects(customer), { payments: 0, details: 0, ledger: 0, outstanding_balance: '0.00' });
  assert.equal(await reservationCount(key), 0);
  const recovered = await post('/payments', payload, { actor, key });
  assert.equal(recovered.status, 201);
  assert.deepEqual(await effects(customer), { payments: 1, details: 1, ledger: 1, outstanding_balance: '-10.00' });
});

test('a fresh application process recovers the committed response from PostgreSQL', async () => {
  const customer = await fixtureCustomer();
  const key = randomUUID();
  const payload = advance(customer);
  const initial = await post('/payments', payload, { actor, key });
  assert.equal(initial.status, 201);
  const childSource = `
    require('node:assert/strict').equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true);
    const app = require('./src/app');
    const request = require('supertest');
    const { pool } = require('./src/config/db');
    let input = '';
    process.stdin.on('data', chunk => input += chunk);
    process.stdin.on('end', async () => {
      try {
        const { origin, cookie, actorId, key, payload } = JSON.parse(input);
        const response = await request(app).post('/api/payments').set('Origin', origin).set('Cookie', cookie).set('Idempotency-Key', key).set('Idempotency-Actor', String(actorId)).send(payload);
        console.log(JSON.stringify({ status: response.status, body: response.body }));
      } catch { process.exitCode = 1; }
      finally { await pool.end(); }
    });
  `;
  const output = await new Promise((resolve, reject) => {
    const child = execFile(process.execPath, ['-e', childSource], { cwd: require('node:path').resolve(__dirname, '../..'), env: process.env, timeout: 15000 }, (error, stdout) => {
      if (error) reject(error); else resolve(stdout);
    });
    child.stdin.end(JSON.stringify({ origin, cookie: actor.cookie, actorId: actor.id, key, payload }));
  });
  assert.deepEqual(JSON.parse(output.trim()), { status: initial.status, body: initial.body });
  assert.deepEqual(await effects(customer), { payments: 1, details: 1, ledger: 1, outstanding_balance: '-10.00' });
});

test('authentication and capabilities run before a stored result can be replayed', async () => {
  const customer = await fixtureCustomer();
  const key = randomUUID();
  const payload = advance(customer);
  assert.equal((await post('/payments', payload, { actor, key })).status, 201);
  const anonymous = await request(app).post('/api/payments').set('Origin', origin).set('Idempotency-Key', key).send(payload);
  assert.equal(anonymous.status, 401);
  const cashier = await setupActor('cashier');
  assert.equal((await post('/payments', payload, { actor: cashier, key })).status, 403);
  assert.deepEqual(await effects(customer), { payments: 1, details: 1, ledger: 1, outstanding_balance: '-10.00' });
});

test('missing and malformed keys reject before reserving or posting anything', async () => {
  const customer = await fixtureCustomer();
  const before = (await owner.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE actor_id=$1', [actor.id])).rows[0].n;
  for (const key of [null, 'short', '-starts-with-dash', 'contains/slash', 'a'.repeat(129)]) {
    const response = await post('/payments', advance(customer), { actor, key });
    assert.equal(response.status, 400);
    assert.equal(response.body.code, 'INVALID_IDEMPOTENCY_KEY');
  }
  assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE actor_id=$1', [actor.id])).rows[0].n, before);
  assert.deepEqual(await effects(customer), { payments: 0, details: 0, ledger: 0, outstanding_balance: '0.00' });
});
