const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setImmediate } = require('node:timers/promises');
const { post, ownerPool: db, appPool, fixtureCustomer, fixtureProduct, setupActor, close } = require('../helpers/financial');
const { lockWaiters } = require('../helpers/lockWaiters');

after(close);
const endpoint = '/finance/customer/commands';
async function sale(customer, paid = '0.00') {
  const product = await fixtureProduct();
  const result = await post('/invoices', { customer_id: customer?.id ?? null,
    customer_name_walkin: customer ? undefined : 'Synthetic walk-in', bill_type: customer ? 'retail' : 'quickbill', date: '2026-03-01',
    items: [{ product_id: product.id, qty: 1, unit: 'piece', rate: '100.00' }],
    payment: { amount_paid: paid, modes: paid === '0.00' ? [] : [{ mode: 'cash', amount: paid }], due_date: '2026-03-31' } });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const id = result.body.data.invoice_id;
  const { rows: [line] } = await db.query('SELECT id FROM invoice_items WHERE invoice_id=$1', [id]);
  return { id, product, line };
}
async function advance(customer, amount = '100.00') {
  const result = await post('/payments', { customer_id: customer.id, invoice_id: null, amount,
    mode: 'cash', payment_date: '2026-03-01' });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  return result.body.data.id;
}
function command(customer, source, overrides = {}) {
  return { kind: 'customer_refund', customer_id: customer.id, source_type: 'advance', source_id: source,
    date: '2026-03-02', reason: 'Synthetic customer request', operator_confirmed: true,
    amount: '20.00', mode: 'cash', ...overrides };
}
async function snapshot(customer, ids = []) {
  const { rows } = await db.query(`SELECT
    (SELECT jsonb_agg(p ORDER BY id) FROM payments p WHERE customer_id=$1) AS payments,
    (SELECT jsonb_agg(l ORDER BY id) FROM customer_ledger l WHERE customer_id=$1) AS ledger,
    (SELECT jsonb_agg(i ORDER BY id) FROM invoices i WHERE id=ANY($2::int[])) AS invoices,
    (SELECT outstanding_balance FROM customers WHERE id=$1) AS balance`, [customer.id, ids]);
  return rows[0];
}
async function allocationFixture() {
  const customer = await fixtureCustomer();
  const first = await sale(customer); const second = await sale(customer); const source = await advance(customer);
  const body = command(customer, source, { kind: 'customer_allocation', amount: undefined, mode: undefined,
    targets: [{ invoice_id: first.id, amount: '30.25' }, { invoice_id: second.id, amount: '40.25' }] });
  return { customer, first, second, source, body };
}
async function concurrentAt(table, id, calls) {
  const blocker = await db.connect(); let pending; let failure;
  try {
    await blocker.query('BEGIN'); const pid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
    pending = Promise.all(calls.map(call => call()));
    const deadline = Date.now() + 5000; let waiting = 0;
    while (waiting < calls.length && Date.now() < deadline) { waiting = await lockWaiters(db, pid); await setImmediate(); }
    assert.equal(waiting, calls.length, 'Both real PostgreSQL transactions must reach the blocked financial lock');
  } catch (error) { failure = error; }
  finally { await blocker.query('ROLLBACK'); blocker.release(); }
  const results = await pending; if (failure) throw failure; return results;
}

test('customer allocation distributes an existing advance atomically without new cash or ledger credit', async () => {
  const f = await allocationFixture(); const before = await snapshot(f.customer, [f.first.id, f.second.id]);
  const result = await post(endpoint, f.body);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.data.record.kind, 'customer_allocation');
  assert.equal(result.body.data.record.amount, '70.50');
  const after = await snapshot(f.customer, [f.first.id, f.second.id]);
  assert.deepEqual(after.payments, before.payments); assert.deepEqual(after.ledger, before.ledger);
  assert.equal(after.balance, before.balance);
  assert.deepEqual(after.invoices.map(i => [i.amount_paid, i.balance_due]), [[0, 69.75], [0, 59.75]]);
});

test('customer refund records exact outgoing split and one account debit; replay remains one event', async () => {
  const customer = await fixtureCustomer(); const source = await advance(customer);
  const body = command(customer, source, { amount: '20.10', mode: 'mixed', modes_detail: [
    { mode: 'cash', amount: '10.05' }, { mode: 'upi', amount: '10.05', reference_no: 'Synthetic refund' }] });
  const key = randomUUID(); const result = await post(endpoint, body, { key });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.deepEqual((await post(endpoint, body, { key })).body, result.body);
  const id = result.body.data.record.id;
  assert.deepEqual((await db.query('SELECT mode,amount FROM settlement_tenders WHERE event_id=$1 ORDER BY id', [id])).rows,
    [{ mode: 'cash', amount: '10.05' }, { mode: 'upi', amount: '10.05' }]);
  assert.deepEqual((await db.query("SELECT debit,credit FROM customer_ledger WHERE reference_type='settlement' AND reference_id=$1", [id])).rows,
    [{ debit: '20.10', credit: '0.00' }]);
  assert.equal((await db.query('SELECT outstanding_balance FROM customers WHERE id=$1', [customer.id])).rows[0].outstanding_balance, '-79.90');
  assert.equal((await post(endpoint, { ...body, reason: 'Changed request' }, { key })).body.code, 'IDEMPOTENCY_CONFLICT');
});

test('allocation preserves payment reconciliation and later direct payment uses only remaining due', async () => {
  const f = await allocationFixture(); assert.equal((await post(endpoint, f.body)).status, 201);
  const result = await post('/payments', { customer_id: f.customer.id, invoice_id: f.first.id,
    amount: '69.75', mode: 'cash', payment_date: '2026-03-03' });
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.data.invoice_amount_paid, '69.75'); assert.equal(result.body.data.invoice_balance_due, '0.00');
});

test('invalid customer settlement attempts have no financial effects or permanent key', async () => {
  const customer = await fixtureCustomer(); const source = await advance(customer);
  const other = await fixtureCustomer(); const foreign = await sale(other);
  const attempts = [
    [command(customer, source, { amount: '101.00' }), 'SOURCE_INSUFFICIENT'],
    [command(customer, source, { operator_confirmed: false }), 'OPERATOR_CONFIRMATION_REQUIRED'],
    [command(customer, source, { amount: '0.001' }), 'DECIMAL_PRECISION'],
    [command(customer, source, { mode: 'mixed', modes_detail: [{ mode: 'cash', amount: '10.00' }, { mode: 'bank', amount: '9.99' }] }), 'PAYMENT_SPLIT_MISMATCH'],
    [command(customer, source, { kind: 'customer_allocation', amount: undefined, mode: undefined, targets: [{ invoice_id: foreign.id, amount: '1.00' }] }), 'INVOICE_CUSTOMER_MISMATCH'],
    [command(customer, source, { date: '2026-02-28' }), 'BACKDATED_SETTLEMENT_UNSUPPORTED'],
  ];
  const before = await snapshot(customer, [foreign.id]);
  for (const [body, expectedCode] of attempts) {
    const key = randomUUID(); const response = await post(endpoint, body, { key });
    assert.equal(response.status, 422, JSON.stringify(response.body));
    assert.equal(response.body.code, expectedCode);
    assert.deepEqual(await snapshot(customer, [foreign.id]), before);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM idempotency_keys WHERE key=$1', [key])).rows[0].count, 0);
  }
});

test('concurrent refund and allocation cannot consume the same advance twice', async () => {
  const f = await allocationFixture();
  const refund = command(f.customer, f.source, { amount: '60.00' });
  const allocate = { ...f.body, targets: [{ invoice_id: f.first.id, amount: '60.00' }] };
  const results = await concurrentAt('payments', f.source, [() => post(endpoint, refund), () => post(endpoint, allocate)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 422], JSON.stringify(results.map(r => r.body)));
  assert.equal((await db.query('SELECT SUM(amount)::text AS used FROM settlement_events WHERE source_type=$1 AND source_id=$2', ['advance', f.source])).rows[0].used, '60.00');
});

test('allocation and direct receipt overlap on the original invoice lock without overpayment', async () => {
  const f = await allocationFixture();
  const allocation = { ...f.body, targets: [{ invoice_id: f.first.id, amount: '60.00' }] };
  const receipt = { customer_id: f.customer.id, invoice_id: f.first.id, amount: '60.00', mode: 'cash', payment_date: '2026-03-02' };
  const results = await concurrentAt('invoices', f.first.id, [() => post(endpoint, allocation), () => post('/payments', receipt)]);
  assert.deepEqual(results.map(r => r.status).sort(), [201, 422], JSON.stringify(results.map(r => r.body)));
  const invoice = (await db.query('SELECT amount_paid,balance_due FROM invoices WHERE id=$1', [f.first.id])).rows[0];
  assert.equal(invoice.balance_due, '40.00'); assert.ok(['0.00', '60.00'].includes(invoice.amount_paid));
});

test('allocation and original-line return overlap without minting extra credit or cash', async () => {
  const f = await allocationFixture();
  const allocation = { ...f.body, targets: [{ invoice_id: f.first.id, amount: '60.00' }] };
  const returned = { return_date: '2026-03-02', reason: 'Synthetic concurrent return', disposition: 'sellable', items: [{ invoice_item_id: f.first.line.id, qty_returned: 1 }] };
  const results = await concurrentAt('invoices', f.first.id, [() => post(endpoint, allocation), () => post(`/invoices/${f.first.id}/return`, returned)]);
  assert.equal(results[1].status, 201, JSON.stringify(results[1].body)); assert.ok([201,422].includes(results[0].status));
  const { rows: [proof] } = await db.query(`SELECT i.grand_total=i.amount_paid+i.balance_due+
    (SELECT COALESCE(SUM(applied_amount),0) FROM sales_return_applications WHERE original_invoice_id=i.id)+
    (SELECT COALESCE(SUM(l.amount),0) FROM settlement_lines l JOIN settlement_events e ON e.id=l.event_id WHERE l.target_type='invoice' AND l.target_id=i.id) AS balanced,
    i.amount_paid,i.balance_due FROM invoices i WHERE id=$1`, [f.first.id]);
  assert.deepEqual(proof, { balanced: true, amount_paid: '0.00', balance_due: '0.00' });
});

test('opposite multi-invoice target order locks deterministically without deadlock or duplicate cash', async () => {
  const f = await allocationFixture(); const secondSource = await advance(f.customer);
  const before = await snapshot(f.customer, [f.first.id,f.second.id]);
  const forward = { ...f.body, targets: [{ invoice_id: f.first.id, amount: '30.00' }, { invoice_id: f.second.id, amount: '30.00' }] };
  const backward = { ...forward, source_id: secondSource, targets: [...forward.targets].reverse() };
  const results = await concurrentAt('invoices', Math.min(f.first.id,f.second.id), [() => post(endpoint,forward), () => post(endpoint,backward)]);
  assert.deepEqual(results.map(result => result.status), [201,201], JSON.stringify(results.map(result => result.body)));
  const after = await snapshot(f.customer, [f.first.id,f.second.id]);
  assert.deepEqual(after.payments,before.payments); assert.deepEqual(after.ledger,before.ledger);
  assert.deepEqual((await db.query('SELECT amount_paid,balance_due FROM invoices WHERE id=ANY($1::int[]) ORDER BY id', [[f.first.id,f.second.id]])).rows,
    [{ amount_paid:'0.00',balance_due:'40.00' },{ amount_paid:'0.00',balance_due:'40.00' }]);
});

test('zero negative nonfinite and overflowing refund amounts reject with exact validation and no effects', async () => {
  const customer = await fixtureCustomer(); const source = await advance(customer); const before = await snapshot(customer);
  for (const [amount,code] of [['0.00','DECIMAL_RANGE'],['-1.00','INVALID_DECIMAL'],[Number.NaN,'INVALID_DECIMAL'],
    [Number.POSITIVE_INFINITY,'INVALID_DECIMAL'],['10000000000.00','DECIMAL_RANGE']]) {
    const key = randomUUID(); const result = await post(endpoint,command(customer,source,{amount}),{key});
    assert.equal(result.status,422,JSON.stringify(result.body)); assert.equal(result.body.code,code);
    assert.deepEqual(await snapshot(customer),before);
    assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM idempotency_keys WHERE key=$1',[key])).rows[0].count,0);
  }
});

test('reversal restores allocation availability and target due, preserving original events', async () => {
  const f = await allocationFixture(); const first = await post(endpoint, f.body);
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const reversed = await post(endpoint, command(f.customer, first.body.data.record.id, { kind: 'reversal', source_type: 'event',
    date: '2026-03-03', amount: undefined, mode: undefined }));
  assert.equal(reversed.status, 201, JSON.stringify(reversed.body));
  assert.equal(reversed.body.data.record.reverses_event_id, first.body.data.record.id);
  assert.deepEqual((await db.query('SELECT amount_paid,balance_due FROM invoices WHERE id=ANY($1::int[]) ORDER BY id', [[f.first.id, f.second.id]])).rows,
    [{ amount_paid: '0.00', balance_due: '100.00' }, { amount_paid: '0.00', balance_due: '100.00' }]);
  assert.equal((await post(endpoint, command(f.customer, f.source, { amount: '100.00', date: '2026-03-04' }))).status, 201);
});

test('consumed advance cannot be reversed before explicit deallocation; original actor is enforced', async () => {
  const f = await allocationFixture(); assert.equal((await post(endpoint, f.body)).status, 201);
  const body = command(f.customer, f.source, { kind: 'payment_reversal', source_type: 'payment', amount: undefined, mode: undefined, date: '2026-03-03' });
  const result = await post(endpoint, body);
  assert.equal(result.status, 422, JSON.stringify(result.body));
  assert.equal(result.body.code, 'SOURCE_HAS_DEPENDENCIES');
  const actor = await setupActor('admin', 'other-settlement-actor');
  const original = await setupActor();
  assert.equal((await post(endpoint, body, { actor, operationActor: original.id })).status, 409);
});

test('paid anonymous sellable return recognizes a liability, then partial refund records no customer ledger', async () => {
  const invoice = await sale(null, '100.00');
  const returned = await post(`/invoices/${invoice.id}/return`, { return_date: '2026-03-02', reason: 'Synthetic anonymous return',
    disposition: 'sellable', items: [{ invoice_item_id: invoice.line.id, qty_returned: '1.000' }] });
  assert.equal(returned.status, 201, JSON.stringify(returned.body));
  const liability = (await db.query('SELECT * FROM anonymous_return_liabilities WHERE original_invoice_id=$1', [invoice.id])).rows[0];
  assert.equal(liability.amount, '100.00');
  const refund = await post(endpoint, { kind: 'anonymous_refund', source_type: 'anonymous_liability', source_id: liability.id,
    amount: '30.25', mode: 'cash', date: '2026-03-03', reason: 'Synthetic partial discharge', operator_confirmed: true });
  assert.equal(refund.status, 201, JSON.stringify(refund.body));
  assert.equal(refund.body.data.record.customer_id, null);
  assert.equal((await db.query("SELECT COUNT(*)::int AS count FROM customer_ledger WHERE reference_type='settlement' AND reference_id=$1", [refund.body.data.record.id])).rows[0].count, 0);
  assert.deepEqual((await db.query('SELECT amount_paid,balance_due FROM invoices WHERE id=$1', [invoice.id])).rows[0], { amount_paid: '100.00', balance_due: '0.00' });
  const service = require('../../src/modules/settlements/customer');
  const listed = (await service.listAnonymous({ as_of: '2026-03-03' })).find(row => row.source_id === liability.id);
  assert.equal(listed.available_amount, '69.75'); assert.equal(listed.events[0].id, refund.body.data.record.id);
  const reversal = await post(endpoint, { kind: 'reversal', source_type: 'event', source_id: refund.body.data.record.id,
    date: '2026-03-04', reason: 'Synthetic anonymous correction', operator_confirmed: true });
  assert.equal(reversal.status, 201, JSON.stringify(reversal.body)); assert.equal(reversal.body.data.record.customer_id, null);
  assert.equal(reversal.body.data.cash_direction, 'in');
  assert.equal((await service.listAnonymous({ as_of: '2026-03-04' })).find(row => row.source_id === liability.id).available_amount, '100.00');
});

test('a paid customer return credit allocates to another invoice without changing cash receipts', async () => {
  const customer = await fixtureCustomer(); const original = await sale(customer, '100.00'); const target = await sale(customer);
  const returned = await post(`/invoices/${original.id}/return`, { return_date: '2026-03-02', reason: 'Synthetic customer credit',
    disposition: 'sellable', items: [{ invoice_item_id: original.line.id, qty_returned: 1 }] });
  assert.equal(returned.status, 201, JSON.stringify(returned.body));
  const source = (await db.query('SELECT id FROM sales_return_applications WHERE credit_invoice_id=$1', [returned.body.data.credit_note_id])).rows[0].id;
  const before = await snapshot(customer, [original.id, target.id]);
  const result = await post(endpoint, command(customer, source, { source_type: 'return_credit', kind: 'customer_allocation',
    date: '2026-03-03', amount: undefined, mode: undefined, targets: [{ invoice_id: target.id, amount: '100.00' }] }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  const after = await snapshot(customer, [original.id, target.id]);
  assert.deepEqual(after.payments, before.payments); assert.deepEqual(after.ledger, before.ledger);
  assert.equal((await db.query('SELECT amount_paid,balance_due FROM invoices WHERE id=$1', [target.id])).rows[0].amount_paid, '0.00');
  assert.equal((await db.query('SELECT amount_paid,balance_due FROM invoices WHERE id=$1', [target.id])).rows[0].balance_due, '0.00');
});

test('review quote is read-only and intervening consumption rejects stale confirmation without effects', async () => {
  const customer = await fixtureCustomer(); const source = await advance(customer); const body = command(customer, source);
  const before = await snapshot(customer);
  const quote = await post('/finance/customer/quote', body);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.match(quote.body.data.quote_hash, /^[a-f0-9]{64}$/); assert.deepEqual(await snapshot(customer), before);
  assert.equal((await post(endpoint, { ...body, amount: '10.00' })).status, 201);
  const consumed = await snapshot(customer);
  const stale = await post(endpoint, { ...body, quote_hash: quote.body.data.quote_hash });
  assert.equal(stale.status, 409); assert.equal(stale.body.code, 'SETTLEMENT_QUOTE_CHANGED');
  assert.deepEqual(await snapshot(customer), consumed);
});

test('same-key concurrent customer refund returns one saved receipt', async () => {
  const customer = await fixtureCustomer(); const source = await advance(customer); const body = command(customer, source); const key = randomUUID();
  const [one, two] = await Promise.all([post(endpoint, body, { key }), post(endpoint, body, { key })]);
  assert.equal(one.status, 201, JSON.stringify(one.body)); assert.deepEqual(two.body, one.body);
  assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM settlement_events WHERE source_type=$1 AND source_id=$2', ['advance', source])).rows[0].count, 1);
});

test('refund reversal records opposite tenders and account credit exactly once', async () => {
  const customer = await fixtureCustomer(); const source = await advance(customer);
  const refund = await post(endpoint, command(customer, source)); assert.equal(refund.status, 201, JSON.stringify(refund.body));
  const body = command(customer, refund.body.data.record.id, { kind: 'reversal', source_type: 'event', amount: undefined, mode: undefined, date: '2026-03-03' });
  const result = await post(endpoint, body); assert.equal(result.status, 201, JSON.stringify(result.body));
  const row = (await db.query("SELECT debit,credit FROM customer_ledger WHERE reference_type='settlement' AND reference_id=$1", [result.body.data.record.id])).rows[0];
  assert.deepEqual(row, { debit: '0.00', credit: '20.00' });
  assert.equal((await post(endpoint, body)).body.code, 'SETTLEMENT_ALREADY_REVERSED');
});

test('direct receipt reversal preserves original payment and restores invoice due', async () => {
  const customer = await fixtureCustomer(); const invoice = await sale(customer);
  const paid = await post('/payments', { customer_id: customer.id, invoice_id: invoice.id, amount: '40.00', mode: 'cash', payment_date: '2026-03-02' });
  assert.equal(paid.status, 201);
  const result = await post(endpoint, command(customer, paid.body.data.id, { kind: 'payment_reversal', source_type: 'payment',
    date: '2026-03-03', amount: undefined, mode: undefined }));
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.deepEqual((await db.query('SELECT amount_paid,balance_due FROM invoices WHERE id=$1', [invoice.id])).rows[0], { amount_paid: '0.00', balance_due: '100.00' });
  assert.equal((await db.query('SELECT amount FROM payments WHERE id=$1', [paid.body.data.id])).rows[0].amount, '40.00');
  const final = await post('/payments', { customer_id: customer.id, invoice_id: invoice.id, amount: '100.00', mode: 'bank', payment_date: '2026-03-04' });
  assert.equal(final.status, 201, JSON.stringify(final.body));
});

test('legacy unproven advance is not spendable even when the account cache claims credit', async () => {
  const customer = await fixtureCustomer(); const actor = await setupActor();
  const source = (await db.query("INSERT INTO payments(customer_id,amount,mode,payment_date,created_by) VALUES($1,100,'cash','2026-03-01',$2) RETURNING id", [customer.id, actor.id])).rows[0].id;
  await db.query("INSERT INTO customer_ledger(customer_id,date,entry_type,reference_id,reference_type,debit,credit,balance) VALUES($1,'2026-03-01','advance',$2,'payment',0,100,0)", [customer.id, source]);
  const before = await snapshot(customer);
  const response = await post(endpoint, command(customer, source));
  assert.equal(response.status, 422); assert.equal(response.body.code, 'SOURCE_RECONCILIATION_REQUIRED'); assert.deepEqual(await snapshot(customer), before);
});

test('a command cannot backdate before a later refund reversal and change prior availability', async () => {
  const customer = await fixtureCustomer(); const source = await advance(customer);
  const refund = await post(endpoint, command(customer, source, { amount: '100.00', date: '2026-03-04' }));
  assert.equal(refund.status, 201, JSON.stringify(refund.body));
  assert.equal((await post(endpoint, command(customer, refund.body.data.record.id, { kind: 'reversal', source_type: 'event',
    date: '2026-03-05', amount: undefined, mode: undefined }))).status, 201);
  const before = await snapshot(customer);
  const response = await post(endpoint, command(customer, source, { date: '2026-03-03' }));
  assert.equal(response.status, 422); assert.equal(response.body.code, 'BACKDATED_SETTLEMENT_UNSUPPORTED'); assert.deepEqual(await snapshot(customer), before);
});

test('restricted role can lock immutable financial evidence but cannot rewrite it', async () => {
  const customer = await fixtureCustomer(); const source = await advance(customer);
  const result = await post(endpoint, command(customer, source)); assert.equal(result.status, 201, JSON.stringify(result.body));
  const id = result.body.data.record.id;
  const client = await appPool.connect();
  try {
    await client.query('BEGIN'); await client.query('SELECT id FROM settlement_events WHERE id=$1 FOR UPDATE', [id]); await client.query('ROLLBACK');
    await assert.rejects(client.query('UPDATE settlement_events SET id=id WHERE id=$1', [id]), /append.only|immutable/i);
    await assert.rejects(client.query('UPDATE settlement_events SET amount=1 WHERE id=$1', [id]), /permission denied/i);
  } finally { client.release(); }
});

test('as-of account residuals preserve history before a later allocation reversal', async () => {
  const f = await allocationFixture(); const allocation = await post(endpoint, f.body); assert.equal(allocation.status, 201, JSON.stringify(allocation.body));
  assert.equal((await post(endpoint, command(f.customer, allocation.body.data.record.id, { kind: 'reversal', source_type: 'event',
    date: '2026-03-04', amount: undefined, mode: undefined }))).status, 201);
  const service = require('../../src/modules/settlements/customer');
  const before = await service.getAccount(f.customer.id, { as_of: '2026-03-03' });
  assert.equal(before.sources.find(source => source.source_id === f.source && source.source_type === 'advance').available_amount, '29.50');
  assert.equal(before.invoices.find(invoice => invoice.id === f.first.id).balance_due, '69.75');
  const after = await service.getAccount(f.customer.id, { as_of: '2026-03-04' });
  assert.equal(after.sources.find(source => source.source_id === f.source && source.source_type === 'advance').available_amount, '100.00');
  assert.equal(after.invoices.find(invoice => invoice.id === f.first.id).balance_due, '100.00');
});

test('anonymous liability cannot be discharged across parties or exceeded and original receipt stays dependent', async () => {
  const invoice = await sale(null, '100.00');
  const returned = await post(`/invoices/${invoice.id}/return`, { return_date: '2026-03-02', reason: 'Synthetic anonymous source', disposition: 'sellable',
    items: [{ invoice_item_id: invoice.line.id, qty_returned: 1 }] });
  assert.equal(returned.status, 201, JSON.stringify(returned.body));
  const body = { kind: 'anonymous_refund', source_type: 'anonymous_liability', source_id: returned.body.data.anonymous_liability_id,
    amount: '100.01', mode: 'cash', date: '2026-03-03', reason: 'Synthetic excess attempt', operator_confirmed: true };
  const excess = await post(endpoint, body); assert.equal(excess.status, 422); assert.equal(excess.body.code, 'SOURCE_INSUFFICIENT');
  const customer = await fixtureCustomer();
  assert.equal((await post(endpoint, { ...body, customer_id: customer.id, amount: '1.00' })).body.code, 'CUSTOMER_SOURCE_MISMATCH');
  const payment = (await db.query('SELECT id FROM payments WHERE invoice_id=$1', [invoice.id])).rows[0].id;
  assert.equal((await post(endpoint, { ...body, kind: 'payment_reversal', source_type: 'payment', source_id: payment, amount: undefined, mode: undefined })).body.code, 'SOURCE_HAS_DEPENDENCIES');
});

for (const table of ['settlement_events', 'settlement_lines', 'settlement_tenders', 'customer_ledger', 'invoices']) {
  test(`customer transaction rolls back every effect after injected ${table} failure`, async () => {
    const f = await allocationFixture(); const allocating = ['settlement_lines', 'invoices'].includes(table);
    const body = allocating ? f.body : command(f.customer, f.source);
    const before = await snapshot(f.customer, [f.first.id, f.second.id]);
    const name = `customer_failure_${f.customer.id}`;
    const predicate = table === 'invoices' ? `NEW.id=${f.second.id}`
      : ['settlement_lines', 'settlement_tenders'].includes(table)
        ? `EXISTS(SELECT 1 FROM settlement_events WHERE id=NEW.event_id AND customer_id=${f.customer.id})`
        : `NEW.customer_id=${f.customer.id}`;
    await db.query(`CREATE FUNCTION ${name}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF ${predicate} THEN RAISE EXCEPTION 'Synthetic settlement write failure'; END IF; RETURN NEW; END $$`);
    await db.query(`CREATE TRIGGER ${name} AFTER ${table === 'invoices' ? 'UPDATE' : 'INSERT'} ON ${table} FOR EACH ROW EXECUTE FUNCTION ${name}()`);
    const key = randomUUID();
    try {
      const response = await post(endpoint, body, { key }); assert.equal(response.status, 500, JSON.stringify(response.body));
      assert.deepEqual(await snapshot(f.customer, [f.first.id, f.second.id]), before);
      assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM settlement_events WHERE customer_id=$1', [f.customer.id])).rows[0].count, 0);
      assert.equal((await db.query('SELECT COUNT(*)::int AS count FROM idempotency_keys WHERE key=$1', [key])).rows[0].count, 0);
    } finally {
      await db.query(`DROP TRIGGER ${name} ON ${table}`); await db.query(`DROP FUNCTION ${name}()`);
    }
    assert.equal((await post(endpoint, body, { key })).status, 201, 'A rolled-back reservation must remain retryable');
  });
}
