const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { app, request, pool, appPool, origin, setupActor, post, fixtureProduct, close } = require('../helpers/financial');
const { lockWaiters } = require('../helpers/lockWaiters');
after(close);

async function fixture() {
  const actor = await setupActor();
  const { rows: [supplier] } = await pool.query('INSERT INTO suppliers(name) VALUES($1) RETURNING *', [`Settlement supplier ${randomUUID()}`]);
  const product = await fixtureProduct();
  const response = await post('/purchases', { supplier_id: supplier.id, date: '2026-01-01', items: [{ product_id: product.id, qty: 4, unit: 'piece', cost_price: 25 }] }, { actor });
  assert.equal(response.status, 201, 'Modern receipt fixture must succeed before settlement assertions');
  const purchase = response.body.data.purchase;
  const purchaseId = purchase.id;
  assert.ok(purchaseId);
  const { rows: lines } = await pool.query('SELECT * FROM purchase_items WHERE purchase_id=$1 ORDER BY id', [purchaseId]);
  return { actor, supplier, product, purchaseId, lines };
}
function recognition(f, overrides = {}) {
  return { kind: 'payable_recognition', supplier_id: f.supplier.id, purchase_id: f.purchaseId, amount: '100.00', date: '2026-01-02', due_date: '2026-01-05', document_reference: `SUP-${f.purchaseId}`, reason: 'Confirmed supplier obligation', ...overrides };
}
async function command(body, options = {}) {
  const quote = await post('/finance/supplier/quote', body, options);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.match(quote.body.data.quote_hash, /^[a-f0-9]{64}$/);
  const result = await post('/finance/supplier/commands', { ...body, quote_hash: quote.body.data.quote_hash }, options);
  assert.equal(result.status, 201, JSON.stringify(result.body));
  assert.equal(result.body.data.record.kind, body.kind);
  return result.body.data.record;
}
async function payable(f) { return command(recognition(f), { actor: f.actor }); }
async function debit(f) {
  const response = await post(`/purchases/${f.purchaseId}/returns`, { items: [{ purchase_item_id: f.lines[0].id, qty_returned: 1 }], return_date: '2026-01-03', reason: 'Synthetic supplier return' }, { actor: f.actor });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data.debit_note;
}
function payment(f, p, overrides = {}) {
  return { kind: 'supplier_payment', supplier_id: f.supplier.id, source_type: 'payable', source_id: p.id, amount: '20.00', date: '2026-01-04', reason: 'Operator recorded supplier payment', operator_confirmed: true, mode: 'cash', ...overrides };
}
async function account(f, query = '') {
  const response = await request(app).get(`/api/finance/suppliers/${f.supplier.id}${query}`).set('Cookie', f.actor.cookie).set('Origin', origin);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  return response.body.data;
}
async function effects(f) {
  return (await pool.query(`SELECT
    (SELECT count(*)::int FROM supplier_payables WHERE supplier_id=$1) AS payables,
    (SELECT count(*)::int FROM settlement_events WHERE supplier_id=$1) AS events,
    (SELECT count(*)::int FROM settlement_tenders t JOIN settlement_events e ON e.id=t.event_id WHERE e.supplier_id=$1) AS tenders,
    (SELECT count(*)::int FROM settlement_lines l JOIN settlement_events e ON e.id=l.event_id WHERE e.supplier_id=$1) AS applications,
    (SELECT current_stock FROM products WHERE id=$2) AS stock,
    (SELECT count(*)::int FROM stock_ledger WHERE product_id=$2) AS movements`, [f.supplier.id, f.product.id])).rows[0];
}

test('Phase4 a received purchase is eligible evidence but never an automatic supplier payable', async () => {
  const f = await fixture();
  const state = await account(f);
  assert.equal(state.payables.length, 0);
  assert.ok(state.receipts.some(r => r.purchase_id === f.purchaseId && r.eligible === true));
});

test('Phase4 explicit full payable recognition is immutable, has no cash or stock effect, and cannot duplicate its receipt', async () => {
  const f = await fixture(); const before = await effects(f); const p = await payable(f);
  assert.equal(p.amount, '100.00'); assert.equal(p.source_type, 'purchase'); assert.equal(p.source_id, f.purchaseId);
  assert.deepEqual(await effects(f), { ...before, payables: 1 });
  const duplicate = await post('/finance/supplier/commands', recognition(f), { actor: f.actor });
  assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, 'PAYABLE_ALREADY_RECOGNIZED');
  assert.equal((await account(f)).payables[0].due, '100.00');
});

test('Phase4 payable recognition rejects forged amount and wrong supplier before writes', async () => {
  const f = await fixture(); const other = await fixture(); const before = await effects(f);
  for (const override of [{ amount: '99.00' }, { supplier_id: other.supplier.id }]) {
    const response = await post('/finance/supplier/commands', recognition(f, override));
    assert.equal(response.status, 422, JSON.stringify(response.body));
  }
  assert.deepEqual(await effects(f), before);
});

test('Phase4 confirmed supplier payment stores exact tender portions without changing receipt or stock', async () => {
  const f = await fixture(); const p = await payable(f); const before = await effects(f);
  const record = await command(payment(f, p, { mode: 'mixed', modes_detail: [{ mode: 'cash', amount: '7.00' }, { mode: 'bank', amount: '13.00', reference_no: 'Synthetic-bank-reference' }] }));
  assert.equal(record.amount, '20.00'); assert.equal(record.operator_confirmed, true);
  assert.equal((await account(f)).payables[0].due, '80.00');
  assert.deepEqual(await effects(f), { ...before, events: before.events + 1, tenders: before.tenders + 2, applications: before.applications + 1 });
  assert.equal((await pool.query('SELECT total_amount FROM purchases WHERE id=$1', [f.purchaseId])).rows[0].total_amount, '100.00');
});

test('Phase4 cash commands reject missing confirmation, nonexact tenders, and overpayment without effects', async () => {
  const f = await fixture(); const p = await payable(f); const before = await effects(f);
  const bad = [payment(f, p, { operator_confirmed: false }), payment(f, p, { mode: 'mixed', modes_detail: [{ mode: 'cash', amount: '5.00' }, { mode: 'bank', amount: '5.00' }] }), payment(f, p, { amount: '100.01' })];
  for (const body of bad) assert.equal((await post('/finance/supplier/commands', body)).status, 422);
  assert.deepEqual(await effects(f), before);
});

test('Phase4 original debit claim is consumed once across application and refund; its issued status and stock remain unchanged', async () => {
  const f = await fixture(); const p = await payable(f); const d = await debit(f); const before = await effects(f);
  await command({ kind: 'supplier_debit_application', supplier_id: f.supplier.id, source_type: 'debit', source_id: d.id, amount: '10.00', date: '2026-01-04', reason: 'Apply agreed supplier claim', targets: [{ payable_id: p.id, amount: '10.00' }] });
  const applied = await account(f); assert.equal(applied.payables[0].due, '90.00'); assert.equal(applied.debits[0].available, '15.00');
  await command({ kind: 'supplier_refund', supplier_id: f.supplier.id, source_type: 'debit', source_id: d.id, amount: '15.00', date: '2026-01-05', reason: 'Operator received supplier refund', operator_confirmed: true, mode: 'cash' });
  const state = await account(f); assert.equal(state.debits[0].available, '0.00'); assert.equal(state.payables[0].due, '90.00');
  assert.equal((await pool.query('SELECT status,amount FROM supplier_debit_notes WHERE id=$1', [d.id])).rows[0].status, 'outstanding');
  const after = await effects(f); assert.equal(after.stock, before.stock); assert.equal(after.movements, before.movements); assert.equal(after.tenders - before.tenders, 1);
  assert.equal((await post('/finance/supplier/commands', { kind: 'supplier_refund', supplier_id: f.supplier.id, source_type: 'debit', source_id: d.id, amount: '0.01', date: '2026-01-06', reason: 'Must reject exhausted claim', operator_confirmed: true, mode: 'cash' })).status, 422);
});

test('Phase4 supplier debit targets must belong to the source supplier', async () => {
  const f = await fixture(); const d = await debit(f); const other = await fixture(); const p = await payable(other); const before = await effects(f);
  const response = await post('/finance/supplier/commands', { kind: 'supplier_debit_application', supplier_id: f.supplier.id, source_type: 'debit', source_id: d.id, amount: '10.00', date: '2026-01-04', reason: 'Wrong party must reject', targets: [{ payable_id: p.id, amount: '10.00' }] });
  assert.equal(response.status, 422); assert.equal(response.body.code, 'SUPPLIER_MISMATCH'); assert.deepEqual(await effects(f), before);
});

test('Phase4 full payment reversal restores payable prospectively and cannot be reversed twice', async () => {
  const f = await fixture(); const p = await payable(f); const paid = await command(payment(f, p));
  const body = { kind: 'reversal', supplier_id: f.supplier.id, source_type: 'event', source_id: paid.id, amount: '20.00', date: '2026-01-05', reason: 'Confirmed correction of payment', operator_confirmed: true, mode: 'cash' };
  const reversed = await command(body); assert.equal(reversed.reverses_event_id, paid.id);
  assert.equal((await account(f)).payables[0].due, '100.00');
  assert.equal((await account(f, '?as_of=2026-01-04')).payables[0].due, '80.00');
  const duplicate = await post('/finance/supplier/commands', body); assert.equal(duplicate.status, 409); assert.equal(duplicate.body.code, 'ALREADY_REVERSED');
  assert.equal((await pool.query('SELECT amount FROM settlement_events WHERE id=$1', [paid.id])).rows[0].amount, '20.00');
});

test('Phase4 recognition reversal rejects dependent settlement and preserves its original recognition', async () => {
  const f = await fixture(); const p = await payable(f); await command(payment(f, p)); const before = await effects(f);
  const response = await post('/finance/supplier/commands', { kind: 'payable_reversal', supplier_id: f.supplier.id, source_type: 'payable', source_id: p.id, amount: '100.00', date: '2026-01-05', reason: 'Reject recognition with active use' });
  assert.equal(response.status, 422); assert.equal(response.body.code, 'PAYABLE_HAS_SETTLEMENTS'); assert.deepEqual(await effects(f), before);
});

test('Phase4 a new source or target event cannot backdate before later settlement evidence', async () => {
  const f = await fixture(); const p = await payable(f); await command(payment(f, p, { date: '2026-01-06' })); const before = await effects(f);
  const response = await post('/finance/supplier/commands', payment(f, p, { date: '2026-01-05' }));
  assert.equal(response.status, 409); assert.equal(response.body.code, 'BACKDATED_SETTLEMENT_UNSUPPORTED'); assert.deepEqual(await effects(f), before);
});

test('Phase4 same-key supplier payments replay one event while changed intent conflicts', async () => {
  const f = await fixture(); const p = await payable(f); const body = payment(f, p); const key = randomUUID();
  const first = await post('/finance/supplier/commands', body, { key }); const second = await post('/finance/supplier/commands', body, { key });
  assert.equal(first.status, 201, JSON.stringify(first.body)); assert.deepEqual(second.body, first.body);
  const conflict = await post('/finance/supplier/commands', { ...body, reason: 'Different business intent' }, { key }); assert.equal(conflict.status, 409); assert.equal(conflict.body.code, 'IDEMPOTENCY_CONFLICT');
  assert.equal((await effects(f)).events, 1);
});

test('Phase4 concurrent supplier application and refund cannot overconsume one debit claim', async () => {
  const f = await fixture(); const p = await payable(f); const d = await debit(f); const blocker = await pool.connect(); let pending;
  try {
    await blocker.query('BEGIN'); await blocker.query('SELECT id FROM supplier_debit_notes WHERE id=$1 FOR UPDATE', [d.id]);
    pending = Promise.all([
      post('/finance/supplier/commands', { kind: 'supplier_debit_application', supplier_id: f.supplier.id, source_type: 'debit', source_id: d.id, amount: '20.00', date: '2026-01-04', reason: 'Concurrent application', targets: [{ payable_id: p.id, amount: '20.00' }] }),
      post('/finance/supplier/commands', { kind: 'supplier_refund', supplier_id: f.supplier.id, source_type: 'debit', source_id: d.id, amount: '20.00', date: '2026-01-04', reason: 'Concurrent confirmed refund', operator_confirmed: true, mode: 'cash' }),
    ]);
    let waiting = 0; const until = Date.now() + 5000;
    while (Date.now() < until) { waiting = await lockWaiters(pool, blocker.processID); if (waiting >= 2) break; await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.ok(waiting >= 2, 'Both requests must contend on this debit source'); await blocker.query('COMMIT');
    const results = await pending; assert.deepEqual(results.map(r => r.status).sort(), [201, 422], JSON.stringify(results.map(r => r.body)));
  } finally { await blocker.query('ROLLBACK'); blocker.release(); if (pending) await pending; }
  assert.equal((await account(f)).debits[0].available, '5.00'); assert.equal((await effects(f)).events, 1);
});

test('Phase4 late supplier tender failure rolls back the event and permits reuse of its operation key', async () => {
  const f = await fixture(); const p = await payable(f); const actor = await setupActor(); const suffix = f.supplier.id; const body = payment(f, p); const key = randomUUID(); const before = await effects(f);
  await pool.query(`CREATE FUNCTION phase4_supplier_tender_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM settlement_events WHERE id=NEW.event_id AND supplier_id=${suffix}) THEN RAISE EXCEPTION 'synthetic settlement tender failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER phase4_supplier_tender_failure_${suffix} BEFORE INSERT ON settlement_tenders FOR EACH ROW EXECUTE FUNCTION phase4_supplier_tender_failure_${suffix}()`);
  try {
    const response = await post('/finance/supplier/commands', body, { actor, key }); assert.equal(response.status, 500); assert.deepEqual(await effects(f), before);
    assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE actor_id=$1 AND key=$2', [actor.id, key])).rowCount, 0);
  } finally { await pool.query(`DROP TRIGGER phase4_supplier_tender_failure_${suffix} ON settlement_tenders`); await pool.query(`DROP FUNCTION phase4_supplier_tender_failure_${suffix}()`); }
  const retried = await post('/finance/supplier/commands', body, { actor, key }); assert.equal(retried.status, 201, JSON.stringify(retried.body)); assert.equal((await effects(f)).events, 1);
});


test('Phase4 stale reviewed quote cannot consume changed supplier balances', async () => {
  const f = await fixture(); const p = await payable(f); const body = payment(f,p);
  const quoted = await post('/finance/supplier/quote',body); assert.equal(quoted.status,200);
  await command(payment(f,p,{ amount: '10.00' }));
  const result = await post('/finance/supplier/commands',{ ...body, quote_hash: quoted.body.data.quote_hash });
  assert.equal(result.status,409); assert.equal(result.body.code,'SETTLEMENT_QUOTE_CHANGED');
  assert.equal((await account(f)).payables[0].due,'90.00');
});

test('Phase4 supplier application and refund reversals restore claim without rewriting original notes', async () => {
  const f = await fixture(); const p = await payable(f); const d = await debit(f);
  const applied = await command({ kind:'supplier_debit_application',supplier_id:f.supplier.id,source_type:'debit',source_id:d.id,amount:'10.00',date:'2026-01-04',reason:'Apply claim',targets:[{payable_id:p.id,amount:'10.00'}] });
  await command({ kind:'reversal',supplier_id:f.supplier.id,source_type:'event',source_id:applied.id,amount:'10.00',date:'2026-01-05',reason:'Correct application' });
  const refunded = await command({ kind:'supplier_refund',supplier_id:f.supplier.id,source_type:'debit',source_id:d.id,amount:'15.00',date:'2026-01-06',reason:'Received refund',operator_confirmed:true,mode:'bank' });
  await command({ kind:'reversal',supplier_id:f.supplier.id,source_type:'event',source_id:refunded.id,amount:'15.00',date:'2026-01-07',reason:'Confirmed opposite transfer',operator_confirmed:true,mode:'bank' });
  assert.equal((await account(f)).debits[0].available,'25.00'); assert.equal((await account(f)).payables[0].due,'100.00');
  assert.equal((await account(f,'?as_of=2026-01-06')).debits[0].available,'10.00');
  const cancelled = await command({kind:'payable_reversal',supplier_id:f.supplier.id,source_type:'payable',source_id:p.id,amount:'100.00',date:'2026-01-08',reason:'Cancel supported unused recognition'});
  assert.equal(cancelled.kind,'payable_reversal'); assert.equal((await account(f)).payables[0].due,'0.00');
  assert.equal((await account(f,'?as_of=2026-01-07')).payables[0].due,'100.00');
});

test('Phase4 source reversal dates and target settlement dates both constrain new supplier applications', async () => {
  const f=await fixture();const p=await payable(f);const d=await debit(f);
  const paid=await command(payment(f,p,{date:'2026-01-07'}));
  await command({kind:'reversal',supplier_id:f.supplier.id,source_type:'event',source_id:paid.id,amount:'20.00',date:'2026-01-09',reason:'Confirmed opposite cash',operator_confirmed:true,mode:'cash'});
  const body={kind:'supplier_debit_application',supplier_id:f.supplier.id,source_type:'debit',source_id:d.id,amount:'5.00',date:'2026-01-08',reason:'Target has later reversal',targets:[{payable_id:p.id,amount:'5.00'}]};
  assert.equal((await post('/finance/supplier/commands',body)).body.code,'BACKDATED_SETTLEMENT_UNSUPPORTED');
  const refunded=await command({kind:'supplier_refund',supplier_id:f.supplier.id,source_type:'debit',source_id:d.id,amount:'5.00',date:'2026-01-10',reason:'Later debit refund',operator_confirmed:true,mode:'cash'});
  assert.ok(refunded.id);
  assert.equal((await post('/finance/supplier/commands',{...body,date:'2026-01-09'})).body.code,'BACKDATED_SETTLEMENT_UNSUPPORTED');
});

test('Phase4 source locking column privilege does not permit immutable UPDATE(id)', async () => {
  const f=await fixture();const p=await payable(f);const e=await command(payment(f,p));
  for(const [table,id] of [['supplier_payables',p.id],['settlement_events',e.id]]) {
    await assert.rejects(appPool.query(`UPDATE ${table} SET id=id WHERE id=$1`,[id]),/append.only|immutable/i);
  }
  assert.equal((await pool.query('SELECT reason FROM supplier_payables WHERE id=$1',[p.id])).rows[0].reason,recognition(f).reason);
});


test('Phase4 supplier reversal requires a later business date and explicit full opposite cash', async () => {
  const f=await fixture();const p=await payable(f);const paid=await command(payment(f,p));
  const body={kind:'reversal',supplier_id:f.supplier.id,source_type:'event',source_id:paid.id,amount:'20.00',date:'2026-01-05',reason:'Correct confirmed payment',operator_confirmed:true,mode:'cash'};
  for(const override of [{date:'2026-01-04'},{amount:'10.00'},{operator_confirmed:false},{mode:'bank'}]) {
    const result=await post('/finance/supplier/commands',{...body,...override});assert.equal(result.status,422,JSON.stringify(result.body));
  }
  assert.equal((await account(f)).payables[0].due,'80.00');
});


test('Phase4 supplier UI reversals derive the immutable full amount and tender split', async () => {
  const f=await fixture();const p=await payable(f);
  const paid=await command(payment(f,p,{mode:'mixed',modes_detail:[{mode:'cash',amount:'7.00'},{mode:'bank',amount:'13.00',reference_no:'Original transfer'}]}));
  const before=await pool.query('SELECT mode,amount,reference_no FROM settlement_tenders WHERE event_id=$1 ORDER BY id',[paid.id]);
  const body={kind:'reversal',supplier_id:f.supplier.id,source_type:'event',source_id:paid.id,date:'2026-01-05',reason:'UI confirmed opposite original split',operator_confirmed:true};
  const quote=await post('/finance/supplier/quote',body);assert.equal(quote.status,200,JSON.stringify(quote.body));
  assert.equal(quote.body.data.amount,'20.00');assert.equal(quote.body.data.cash_direction,'in');assert.deepEqual(quote.body.data.tenders,before.rows);
  const key=randomUUID();const payload={...body,quote_hash:quote.body.data.quote_hash};
  const first=await post('/finance/supplier/commands',payload,{key});const replay=await post('/finance/supplier/commands',payload,{key});
  assert.equal(first.status,201,JSON.stringify(first.body));assert.deepEqual(replay.body,first.body);
  assert.equal((await post('/finance/supplier/commands',payload)).body.code,'ALREADY_REVERSED');
  assert.equal((await account(f)).payables[0].due,'100.00');
  assert.deepEqual((await pool.query('SELECT mode,amount,reference_no FROM settlement_tenders WHERE event_id=$1 ORDER BY id',[paid.id])).rows,before.rows);
  assert.deepEqual((await pool.query('SELECT mode,amount,reference_no FROM settlement_tenders WHERE event_id=$1 ORDER BY id',[first.body.data.record.id])).rows,before.rows);
  const cancelled=await command({kind:'payable_reversal',supplier_id:f.supplier.id,source_type:'payable',source_id:p.id,date:'2026-01-06',reason:'UI cancels unused recognition'});
  assert.equal(cancelled.amount,'100.00');assert.equal((await account(f)).payables[0].due,'0.00');
});

test('Phase4 source-derived supplier reversals still require cash confirmation and reject contradictory tender splits', async () => {
  const f=await fixture();const p=await payable(f);const paid=await command(payment(f,p));
  const body={kind:'reversal',supplier_id:f.supplier.id,source_type:'event',source_id:paid.id,date:'2026-01-05',reason:'Confirm full original payment'};
  assert.equal((await post('/finance/supplier/commands',body)).body.code,'OPERATOR_CONFIRMATION_REQUIRED');
  assert.equal((await post('/finance/supplier/commands',{...body,operator_confirmed:true,mode:'bank'})).body.code,'REVERSAL_TENDER_MISMATCH');
  const reversed=await command({...body,operator_confirmed:true,mode:'cash'});assert.equal(reversed.amount,'20.00');
  assert.equal((await effects(f)).events,2);
});
