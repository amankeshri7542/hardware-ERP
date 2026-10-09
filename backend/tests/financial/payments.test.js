const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { app, request, ownerPool: owner, origin, setupActor, fixtureCustomer, close } = require('../helpers/financial');
let actor;
let cookie;
before(async () => { actor = await setupActor(); cookie = actor.cookie; });
after(close);
async function fixture(customerId, withDebit = true) {
  const customer = customerId || (await fixtureCustomer()).id;
  const invoice = (await owner.query("INSERT INTO invoices(customer_id,bill_type,date,grand_total,amount_paid,balance_due,status,created_by) VALUES($1,'retail','2026-01-15',100,0,100,'unpaid',$2) RETURNING id", [customer, actor.id])).rows[0].id;
  if (withDebit) await owner.query("INSERT INTO customer_ledger(customer_id,date,entry_type,reference_id,reference_type,debit,credit,balance) VALUES($1,'2026-01-15','invoice',$2,'invoice',100,0,0)", [customer, invoice]);
  return { customer, invoice };
}
function body(f, overrides = {}) {
  return { customer_id: f.customer, invoice_id: f.invoice, amount: 10, mode: 'cash', payment_date: '2026-01-15', ...overrides };
}
function post(data, key = randomUUID()) {
  return request(app).post('/api/payments').set('Origin', origin).set('Cookie', cookie).set('Idempotency-Key', key).set('Idempotency-Actor', String(actor.id)).send(data);
}

test('payment IDs and amount accept decimal strings and add exact cents', async () => {
  const f = await fixture();
  const response = await post(body(f, { customer_id: String(f.customer), invoice_id: String(f.invoice), amount: '10.25' }));
  assert.equal(response.status, 201);
  const row = (await owner.query('SELECT amount_paid,balance_due FROM invoices WHERE id=$1', [f.invoice])).rows[0];
  assert.equal(row.amount_paid, '10.25');
  assert.equal(row.balance_due, '89.75');
});

test('retrying the same payment key returns the one committed receipt', async () => {
  const f = await fixture();
  const key = randomUUID();
  const first = await post(body(f), key);
  const second = await post(body(f), key);
  assert.equal(first.status, 201);
  assert.equal(second.status, 201);
  assert.deepEqual(second.body, first.body);
  assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id=$1', [f.invoice])).rows[0].n, 1);
});

test('fractional cents and contradictory single-mode detail are rejected without payment writes', async () => {
  const f = await fixture();
  for (const overrides of [{ amount: '0.001' }, { modes_detail: [{ mode: 'upi', amount: 10 }] }]) {
    assert.equal((await post(body(f, overrides))).status, 422);
  }
  assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id=$1', [f.invoice])).rows[0].n, 0);
});

test('concrete tenders require positive exact cents and a split exactly equal to the receipt', async () => {
  const f = await fixture();
  const invalid = [
    { mode: 'mixed', modes_detail: [{ mode: 'cash', amount: 5 }, { mode: 'upi', amount: '4.99' }] },
    { mode: 'mixed', modes_detail: [{ amount: 5 }, { mode: 'upi', amount: 5 }] },
    { mode: 'mixed', modes_detail: [{ mode: 'mixed', amount: 5 }, { mode: 'upi', amount: 5 }] },
    { mode: 'mixed', modes_detail: [{ mode: 'cash', amount: 10 }, { mode: 'upi', amount: 0 }] },
    { mode: 'mixed', modes_detail: [{ mode: 'cash', amount: '5.001' }, { mode: 'upi', amount: '4.999' }] },
    { amount: '1e1' }, { amount: '10000000000.00' }, { amount: true }, { amount: null },
    { payment_date: '2026-02-30' }, { invoice_id: '1.5' }, { refund: true },
  ];
  for (const overrides of invalid) assert.equal((await post(body(f, overrides))).status, 422);
  const paid = await post(body(f, { amount: '20.10', mode: 'mixed', modes_detail: [
    { mode: 'cash', amount: '10.05' }, { mode: 'upi', amount: '10.05', reference_no: 'Synthetic ref' },
  ] }));
  assert.equal(paid.status, 201);
  assert.equal(paid.body.data.amount, '20.10');
  assert.equal(paid.body.data.outstanding_balance, '79.90');
  assert.equal(paid.body.data.invoice_balance_due, '79.90');
  assert.equal(paid.body.data.invoice_amount_paid, '20.10');
  assert.equal(paid.body.data.payment_date, '2026-01-15');
  assert.deepEqual((await owner.query('SELECT mode,amount FROM payment_modes_detail WHERE payment_id=$1 ORDER BY id', [paid.body.data.id])).rows,
    [{ mode: 'cash', amount: '10.05' }, { mode: 'upi', amount: '10.05' }]);
});

test('invoice ownership and active customer are enforced; overpayment rolls back and releases its key', async () => {
  const f = await fixture();
  const other = await fixtureCustomer();
  assert.equal((await post(body(f, { customer_id: other.id }))).status, 422);
  const key = randomUUID();
  assert.equal((await post(body(f, { amount: 101 }), key)).status, 422);
  assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE actor_id=$1 AND key=$2', [actor.id, key])).rows[0].n, 0);
  await owner.query('UPDATE customers SET is_active=false WHERE id=$1', [f.customer]);
  assert.equal((await post(body(f))).status, 404);
  await owner.query('UPDATE customers SET is_active=true WHERE id=$1', [f.customer]);
  assert.equal((await owner.query('SELECT amount_paid FROM invoices WHERE id=$1', [f.invoice])).rows[0].amount_paid, '0.00');
  const settled = await post(body(f, { amount: 100 }), key);
  assert.equal(settled.status, 201);
  assert.equal(settled.body.data.invoice_balance_due, '0.00');
  assert.equal((await post(body(f))).status, 422);
  assert.equal((await owner.query('SELECT status FROM invoices WHERE id=$1', [f.invoice])).rows[0].status, 'paid');
});

test('a real advance writes a credit without allocating or changing an existing invoice', async () => {
  const f = await fixture();
  const result = await post(body(f, { invoice_id: null, amount: '12.34', mode: 'bank' }));
  assert.equal(result.status, 201);
  assert.equal(result.body.data.invoice_id, null);
  assert.equal(result.body.data.outstanding_balance, '87.66');
  assert.equal((await owner.query('SELECT balance_due FROM invoices WHERE id=$1', [f.invoice])).rows[0].balance_due, '100.00');
  const ledger = (await owner.query("SELECT entry_type,credit,balance FROM customer_ledger WHERE reference_type='payment' AND reference_id=$1", [result.body.data.id])).rows[0];
  assert.deepEqual(ledger, { entry_type: 'advance', credit: '12.34', balance: '87.66' });
  assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM payment_modes_detail WHERE payment_id=$1', [result.body.data.id])).rows[0].n, 1);
});

test('concurrent receipts on different invoices serialize the same customer ledger and cache', async () => {
  const first = await fixture();
  const second = await fixture(first.customer);
  const results = await Promise.all([post(body(first)), post(body(second))]);
  assert.ok(results.every((result) => result.status === 201));
  assert.deepEqual(results.map((result) => result.body.data.outstanding_balance).sort(), ['180.00', '190.00']);
  const rows = (await owner.query("SELECT credit,balance FROM customer_ledger WHERE customer_id=$1 AND entry_type='payment' ORDER BY id", [first.customer])).rows;
  assert.deepEqual(rows, [{ credit: '10.00', balance: '190.00' }, { credit: '10.00', balance: '180.00' }]);
  assert.equal((await owner.query('SELECT outstanding_balance FROM customers WHERE id=$1', [first.customer])).rows[0].outstanding_balance, '180.00');
});

test('concurrent distinct keys cannot overpay one invoice', async () => {
  const f = await fixture();
  const results = await Promise.all([post(body(f, { amount: 60 })), post(body(f, { amount: 60 }))]);
  assert.deepEqual(results.map((result) => result.status).sort(), [201, 422]);
  const invoice = (await owner.query('SELECT amount_paid,balance_due FROM invoices WHERE id=$1', [f.invoice])).rows[0];
  assert.deepEqual(invoice, { amount_paid: '60.00', balance_due: '40.00' });
  assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM payments WHERE invoice_id=$1', [f.invoice])).rows[0].n, 1);
});

async function financialSnapshot(f) {
  return {
    invoice: (await owner.query('SELECT grand_total,amount_paid,balance_due,status FROM invoices WHERE id=$1', [f.invoice])).rows,
    payments: (await owner.query('SELECT id,amount,mode FROM payments WHERE invoice_id=$1 ORDER BY id', [f.invoice])).rows,
    details: (await owner.query('SELECT d.id,d.mode,d.amount FROM payment_modes_detail d JOIN payments p ON p.id=d.payment_id WHERE p.invoice_id=$1 ORDER BY d.id', [f.invoice])).rows,
    ledger: (await owner.query('SELECT id,debit,credit,balance FROM customer_ledger WHERE customer_id=$1 ORDER BY id', [f.customer])).rows,
    customer: (await owner.query('SELECT outstanding_balance FROM customers WHERE id=$1', [f.customer])).rows,
  };
}

async function historicalPayment(f, mode = 'cash') {
  const payment = (await owner.query("INSERT INTO payments(customer_id,invoice_id,amount,mode,payment_date,created_by) VALUES($1,$2,10,$3,'2026-01-15',$4) RETURNING id", [f.customer, f.invoice, mode, actor.id])).rows[0];
  await owner.query('UPDATE invoices SET amount_paid=10,balance_due=90,status=\'partial\' WHERE id=$1', [f.invoice]);
  await owner.query("INSERT INTO customer_ledger(customer_id,date,entry_type,reference_id,reference_type,debit,credit,balance) VALUES($1,'2026-01-15','payment',$2,'payment',0,10,0)", [f.customer, payment.id]);
  return payment;
}

for (const inconsistency of ['missing invoice debit', 'inconsistent invoice header', 'incorrect historical split']) {
  test(`historical reconciliation rejects ${inconsistency} without changing history`, async () => {
    const f = await fixture(undefined, inconsistency !== 'missing invoice debit');
    if (inconsistency === 'inconsistent invoice header') await owner.query('UPDATE invoices SET amount_paid=20,balance_due=90 WHERE id=$1', [f.invoice]);
    if (inconsistency === 'incorrect historical split') {
      const payment = await historicalPayment(f, 'mixed');
      await owner.query("INSERT INTO payment_modes_detail(payment_id,mode,amount) VALUES($1,'cash',4),($1,'upi',4)", [payment.id]);
    }
    const before = await financialSnapshot(f);
    const key = randomUUID();
    const response = await post(body(f), key);
    assert.equal(response.status, 422);
    assert.equal(response.body.code, 'INVOICE_RECONCILIATION_REQUIRED');
    assert.deepEqual(await financialSnapshot(f), before);
    assert.equal((await owner.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE actor_id=$1 AND key=$2', [actor.id, key])).rows[0].n, 0);
  });
}

test('a reconciled legacy single-mode payment without detail rows remains payable', async () => {
  const f = await fixture();
  await historicalPayment(f);
  const result = await post(body(f));
  assert.equal(result.status, 201);
  assert.equal(result.body.data.invoice_amount_paid, '20.00');
  assert.equal(result.body.data.invoice_balance_due, '80.00');
  assert.equal(result.body.data.outstanding_balance, '80.00');
});
