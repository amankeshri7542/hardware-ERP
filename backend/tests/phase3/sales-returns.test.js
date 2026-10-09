const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setImmediate } = require('node:timers/promises');
const { app, request, origin, pool, appPool, post, fixtureCustomer, fixtureProduct, setupActor, close } = require('../helpers/financial');
const { lockWaiters } = require('../helpers/lockWaiters');

after(close);

async function sale({ product = {}, invoice = {}, items } = {}) {
  const customer = await fixtureCustomer();
  const originalProduct = await fixtureProduct(product);
  const response = await post('/invoices', {
    customer_id: customer.id, bill_type: 'retail', date: '2026-01-15',
    items: items ? items(originalProduct) : [{ product_id: originalProduct.id, qty: 2, unit: 'piece', rate: 100 }],
    payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' }, ...invoice,
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const id = response.body.data.invoice_id;
  const { rows: lines } = await pool.query('SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id', [id]);
  return { customer, product: originalProduct, id, lines };
}

function returnIntent(f, qty = 1, overrides = {}) {
  return { return_date: '2026-01-16', reason: 'Synthetic sellable return', disposition: 'sellable',
    items: [{ invoice_item_id: f.lines[0].id, product_id: f.product.id, qty_returned: qty }], ...overrides };
}

async function returned(f, body = returnIntent(f), options) {
  const response = await post(`/invoices/${f.id}/return`, body, options);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const { rows: [credit] } = await pool.query('SELECT * FROM invoices WHERE id=$1', [response.body.data.credit_note_id]);
  assert.ok(credit, 'A successful return must persist its credit document');
  return credit;
}

async function effects(f) {
  const { rows: [row] } = await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM invoices WHERE customer_id=$1) AS invoices,
    (SELECT COUNT(*)::integer FROM customer_ledger WHERE customer_id=$1) AS ledger,
    (SELECT outstanding_balance FROM customers WHERE id=$1) AS outstanding,
    (SELECT COUNT(*)::integer FROM payments WHERE customer_id=$1) AS payments,
    (SELECT COUNT(*)::integer FROM stock_ledger WHERE product_id=$2) AS movements,
    (SELECT current_stock FROM products WHERE id=$2) AS stock,
    (SELECT balance_due FROM invoices WHERE id=$3) AS due,
    (SELECT amount_paid FROM invoices WHERE id=$3) AS paid,
    (SELECT SUM(qty_returned) FROM invoice_items WHERE invoice_id=$3) AS returned`,
  [f.customer.id, f.product.id, f.id]);
  return row;
}

async function concurrentAtInvoice(f, calls) {
  const blocker = await pool.connect();
  let pending;
  let barrierError;
  try {
    await blocker.query('BEGIN');
    const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query('SELECT id FROM invoices WHERE id=$1 FOR UPDATE', [f.id]);
    pending = Promise.all(calls.map(call => call()));
    const deadline = Date.now() + 5000;
    let count = 0;
    while (count < calls.length && Date.now() < deadline) {
      count = await lockWaiters(pool, pid);
      await setImmediate();
    }
    assert.equal(count, calls.length, 'Every request must reach this fixture\'s invoice lock or its blocked reservation');
  } catch (error) {
    barrierError = error;
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
  }
  const responses = await pending;
  if (barrierError) throw barrierError;
  return responses;
}

test('Phase3 return control: valid registered sale restores one piece and credits its original value', async () => {
  const f = await sale();
  const credit = await returned(f);
  assert.equal(credit.grand_total, '-100.00');
  assert.deepEqual(await effects(f), { invoices: 2, ledger: 2, outstanding: '100.00', payments: 0,
    movements: 3, stock: '99.000', due: '100.00', paid: '0.00', returned: '1.000' });
});

test('Phase3 converted sale: one of two 100-rupee boxes refunds 100, even after catalog changes', async () => {
  const customer = await fixtureCustomer();
  const product = await fixtureProduct();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit) VALUES($1,'box',10,true)", [product.id]);
  const response = await post('/invoices', { customer_id: customer.id, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: product.id, qty: 2, unit: 'box', rate: 100 }],
    payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const id = response.body.data.invoice_id;
  const { rows: lines } = await pool.query('SELECT * FROM invoice_items WHERE invoice_id=$1', [id]);
  const f = { customer, product, id, lines };
  await pool.query('UPDATE products SET mrp=900,gst_rate=28,purchase_price=90 WHERE id=$1', [product.id]);
  await pool.query("UPDATE product_unit_conversions SET conversion_value=20 WHERE product_id=$1 AND unit_name='box'", [product.id]);
  const credit = await returned(f);
  assert.equal(credit.grand_total, '-100.00', 'Selected-unit selling rate must not multiply base-stock quantity');
  assert.equal((await effects(f)).stock, '90.000', 'Return restores the issued conversion, not today\'s conversion');
  const final = await returned(f);
  assert.equal(final.grand_total, '-100.00');
  assert.equal((await effects(f)).stock, '100.000');
});

test('Phase3 FIN-06: duplicate source lines cannot jointly exceed sold quantity or cause side effects', async () => {
  const f = await sale();
  const before = await effects(f);
  const body = returnIntent(f, 2);
  body.items.push({ ...body.items[0] });
  const response = await post(`/invoices/${f.id}/return`, body);
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'DUPLICATE_RETURN_ITEM');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 FIN-07: valid original line cannot authorize returning a different product', async () => {
  const f = await sale();
  const unrelated = await fixtureProduct();
  const before = await effects(f);
  const body = returnIntent(f);
  body.items[0].product_id = unrelated.id;
  const response = await post(`/invoices/${f.id}/return`, body);
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_PRODUCT_MISMATCH');
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT current_stock FROM products WHERE id=$1', [unrelated.id])).rows[0].current_stock, '100.000');
  assert.equal((await pool.query('SELECT COUNT(*)::integer AS count FROM stock_ledger WHERE product_id=$1', [unrelated.id])).rows[0].count, 1);
});

test('Phase3 Quick Bill return posts the registered customer credit exactly once', async () => {
  const f = await sale({ invoice: { bill_type: 'quickbill' } });
  await returned(f);
  const actual = await effects(f);
  assert.equal(actual.outstanding, '100.00', 'Quick Bill returns must credit the same receivable as ordinary invoices');
  assert.equal(actual.ledger, 2);
});

test('Phase3 applied return credit allows 1000 invoice, 400 received, 200 returned, then 400 received', async () => {
  const f = await sale({ items: product => [{ product_id: product.id, qty: 10, unit: 'piece', rate: 100 }],
    invoice: { payment: { amount_paid: 400, modes: [{ mode: 'cash', amount: 400 }], due_date: '2026-02-15' } } });
  await returned(f, returnIntent(f, 2));
  assert.equal((await effects(f)).due, '400.00');
  const response = await post('/payments', { customer_id: f.customer.id, invoice_id: f.id, amount: 400, mode: 'cash', payment_date: '2026-01-17' });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const actual = await effects(f);
  assert.equal(actual.due, '0.00');
  assert.equal(actual.paid, '800.00', 'Return credit is not a cash receipt');
  assert.equal(actual.outstanding, '0.00');
  assert.equal((await pool.query('SELECT grand_total FROM invoices WHERE id=$1', [f.id])).rows[0].grand_total, '1000.00');
});

test('Phase3 repeated partial returns conserve all original tax and discount cents', async () => {
  const f = await sale({ product: { gst_rate: 5, purchase_price: 0.01 },
    items: product => [{ product_id: product.id, qty: 3, unit: 'piece', rate: 0.05, discount_pct: 10 }] });
  const credits = [await returned(f), await returned(f), await returned(f)];
  const { rows: [totals] } = await pool.query(`SELECT SUM(subtotal)::text AS subtotal, SUM(discount_total)::text AS discount_total,
    SUM(taxable_total)::text AS taxable_total, SUM(gst_total)::text AS gst_total, SUM(grand_total)::text AS grand_total,
    SUM(total_cost)::text AS total_cost, SUM(profit_amount)::text AS profit_amount FROM invoices WHERE id=ANY($1::integer[])`,
  [[f.id, ...credits.map(credit => credit.id)]]);
  assert.deepEqual(totals, { subtotal: '0.00', discount_total: '0.00', taxable_total: '0.00', gst_total: '0.00', grand_total: '0.00', total_cost: '0.00', profit_amount: '0.00' });
  assert.equal((await effects(f)).stock, '100.000');
});

test('Phase3 return same-key retry persists one credit and one stock restoration', async () => {
  const f = await sale();
  const body = returnIntent(f);
  const key = randomUUID();
  const first = await post(`/invoices/${f.id}/return`, body, { key });
  assert.equal(first.status, 201, JSON.stringify(first.body));
  const before = await effects(f);
  const replay = await post(`/invoices/${f.id}/return`, body, { key });
  assert.equal(replay.status, 201, JSON.stringify(replay.body));
  assert.equal(replay.body.data.credit_note_id, first.body.data.credit_note_id);
  assert.deepEqual(await effects(f), before);
});

test('Phase3 incomplete issued unit evidence requires reconciliation before any return writes', async () => {
  const f = await sale();
  await pool.query('UPDATE invoice_items SET base_unit_snapshot=NULL WHERE id=$1', [f.lines[0].id]);
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 unexplained historical returned counter cannot authorize additional returns', async () => {
  const f = await sale();
  await pool.query('UPDATE invoice_items SET qty_returned=1 WHERE id=$1', [f.lines[0].id]);
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 old unlinked return movement requires reconciliation even when its counter is zero', async () => {
  const f = await sale();
  await pool.query("INSERT INTO stock_ledger(product_id,date,movement_type,reference_id,reference_type,qty_in,qty_out,stock_after,notes) VALUES($1,'2026-01-16','return_in',$2,'return',1,0,99,'Synthetic historical unlinked return')", [f.product.id, f.id]);
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 zero-value sale remains returnable while its zero-value credit cannot be returned', async () => {
  const f = await sale({ items: product => [{ product_id: product.id, qty: 1, unit: 'piece', rate: 0 }] });
  const credit = await returned(f);
  assert.equal(credit.grand_total, '0.00');
  assert.equal(credit.document_kind, 'sales_return');
  assert.equal(credit.original_invoice_id, f.id);
  assert.equal((await effects(f)).stock, '100.000');
  const { rows: lines } = await pool.query('SELECT * FROM invoice_items WHERE invoice_id=$1', [credit.id]);
  const before = await effects(f);
  const response = await post(`/invoices/${credit.id}/return`, returnIntent({ ...f, lines }));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 inactive product is rejected without restoring sellable stock', async () => {
  const f = await sale();
  await pool.query('UPDATE products SET is_active=false WHERE id=$1', [f.product.id]);
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 inactive customer is rejected without stock or credit writes', async () => {
  const f = await sale();
  await pool.query('UPDATE customers SET is_active=false WHERE id=$1', [f.customer.id]);
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 unsupported damaged disposition is rejected explicitly before sellable-stock writes', async () => {
  const f = await sale();
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f, 1, { disposition: 'damaged' }));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_DISPOSITION_UNSUPPORTED');
  assert.deepEqual(await effects(f), before);
});

test('Phase4 anonymous paid return records a separate liability without refunding money', async () => {
  const f = await sale({ invoice: { customer_id: null, customer_name_walkin: 'Synthetic walk-in', bill_type: 'quickbill',
    payment: { amount_paid: 200, modes: [{ mode: 'cash', amount: 200 }] } } });
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(response.status, 201, JSON.stringify(response.body));
  assert.equal(response.body.data.customer_id, null);
  assert.equal(response.body.data.refundable_amount, '100.00');
  assert.equal((await pool.query('SELECT amount FROM anonymous_return_liabilities WHERE original_invoice_id=$1', [f.id])).rows[0].amount, '100.00');
  assert.equal((await pool.query("SELECT COUNT(*)::int AS count FROM customer_ledger WHERE reference_type='invoice' AND reference_id=$1", [response.body.data.credit_note_id])).rows[0].count, 0);
  assert.equal((await pool.query('SELECT COUNT(*)::integer AS count FROM payments WHERE invoice_id=$1', [f.id])).rows[0].count, 1);
});

test('Phase3 fully returned line cannot be returned again with a fresh key', async () => {
  const f = await sale();
  await returned(f, returnIntent(f, 2));
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_QTY_EXCEEDS_ORIGINAL');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 concurrent full returns serialize eligibility and only one succeeds', async () => {
  const f = await sale();
  const body = returnIntent(f, 2);
  const responses = await concurrentAtInvoice(f, [() => post(`/invoices/${f.id}/return`, body), () => post(`/invoices/${f.id}/return`, body)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 422], JSON.stringify(responses.map(response => response.body)));
  const actual = await effects(f);
  assert.equal(actual.invoices, 2);
  assert.equal(actual.ledger, 2);
  assert.equal(actual.stock, '100.000');
  assert.equal(actual.returned, '2.000');
});

test('Phase3 concurrent same-key returns replay one successful credit', async () => {
  const f = await sale();
  const body = returnIntent(f);
  const key = randomUUID();
  const responses = await concurrentAtInvoice(f, [() => post(`/invoices/${f.id}/return`, body, { key }), () => post(`/invoices/${f.id}/return`, body, { key })]);
  assert.deepEqual(responses.map(response => response.status), [201, 201], JSON.stringify(responses.map(response => response.body)));
  assert.equal(responses[0].body.data.credit_note_id, responses[1].body.data.credit_note_id);
  assert.equal((await effects(f)).stock, '99.000');
  assert.equal((await effects(f)).invoices, 2);
});

test('Phase3 same-key changed quantity conflicts without further stock or credit writes', async () => {
  const f = await sale();
  const key = randomUUID();
  await returned(f, returnIntent(f), { key });
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f, 0.5), { key });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 persisted original actor is checked before replay across a switched account', async () => {
  const f = await sale();
  const actor = await setupActor();
  const otherActor = await setupActor('admin', 'return-account-switch');
  const key = randomUUID();
  const body = returnIntent(f);
  await returned(f, body, { actor, key });
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, body, { actor: otherActor, operationActor: actor.id, key });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'OPERATION_ACTOR_MISMATCH');
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT COUNT(*)::integer AS count FROM idempotency_keys WHERE actor_id=$1 AND key=$2', [otherActor.id, key])).rows[0].count, 0);
});

test('Phase3 separate lines for the same product retain their own issued values', async () => {
  const f = await sale({ items: product => [{ product_id: product.id, qty: 1, unit: 'piece', rate: 80 },
    { product_id: product.id, qty: 1, unit: 'piece', rate: 120 }] });
  const body = returnIntent(f);
  body.items = f.lines.map(line => ({ invoice_item_id: line.id, product_id: line.product_id, qty_returned: 1 }));
  const credit = await returned(f, body);
  assert.equal(credit.grand_total, '-200.00');
  assert.equal((await effects(f)).stock, '100.000');
  const { rows } = await pool.query('SELECT line_total FROM invoice_items WHERE invoice_id=$1 ORDER BY rate', [credit.id]);
  assert.deepEqual(rows, [{ line_total: '-80.00' }, { line_total: '-120.00' }]);
});

test('Phase3 simultaneous return and payment preserve issued total, actual receipts and zero due', async () => {
  const f = await sale({ items: product => [{ product_id: product.id, qty: 10, unit: 'piece', rate: 100 }],
    invoice: { payment: { amount_paid: 400, modes: [{ mode: 'cash', amount: 400 }], due_date: '2026-02-15' } } });
  // Phase 4 disallows insertion before later settlement evidence; both concurrent events share a business day.
  const responses = await concurrentAtInvoice(f, [() => post(`/invoices/${f.id}/return`, { ...returnIntent(f, 2), return_date: '2026-01-17' }),
    () => post('/payments', { customer_id: f.customer.id, invoice_id: f.id, amount: 400, mode: 'cash', payment_date: '2026-01-17' })]);
  assert.deepEqual(responses.map(response => response.status), [201, 201], JSON.stringify(responses.map(response => response.body)));
  const actual = await effects(f);
  assert.equal(actual.paid, '800.00');
  assert.equal(actual.due, '0.00');
  assert.equal(actual.outstanding, '0.00');
});

test('Phase4 rejects a return backdated before a later receipt with no financial effects', async () => {
  const f = await sale();
  const payment = await post('/payments', { customer_id: f.customer.id, invoice_id: f.id, amount: 1, mode: 'cash', payment_date: '2026-01-17' });
  assert.equal(payment.status, 201, JSON.stringify(payment.body));
  const before = await effects(f);
  const result = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(result.status, 422); assert.equal(result.body.code, 'BACKDATED_SETTLEMENT_UNSUPPORTED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 late customer credit failure rolls back stock, counter, credit, balance and retry reservation', async () => {
  const f = await sale();
  const suffix = f.customer.id;
  const before = await effects(f);
  const body = returnIntent(f);
  const key = randomUUID();
  await pool.query(`CREATE FUNCTION phase3_credit_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.customer_id=${suffix} AND NEW.credit>0 THEN RAISE EXCEPTION 'synthetic return credit failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER phase3_credit_failure_${suffix} BEFORE INSERT ON customer_ledger FOR EACH ROW EXECUTE FUNCTION phase3_credit_failure_${suffix}()`);
  try {
    const response = await post(`/invoices/${f.id}/return`, body, { key });
    assert.equal(response.status, 500, JSON.stringify(response.body));
    assert.deepEqual(await effects(f), before);
    assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  } finally {
    await pool.query(`DROP TRIGGER phase3_credit_failure_${suffix} ON customer_ledger`);
    await pool.query(`DROP FUNCTION phase3_credit_failure_${suffix}()`);
  }
  await returned(f, body, { key });
  assert.equal((await effects(f)).stock, '99.000');
});

test('Phase3 original line alone derives the product and credit links', async () => {
  const f = await sale();
  const body = returnIntent(f);
  delete body.items[0].product_id;
  const credit = await returned(f, body);
  assert.equal(credit.document_kind, 'sales_return');
  assert.equal(credit.original_invoice_id, f.id);
  const { rows: [line] } = await pool.query('SELECT product_id,original_invoice_item_id,qty,base_qty,base_unit_snapshot FROM invoice_items WHERE invoice_id=$1', [credit.id]);
  assert.deepEqual(line, { product_id: f.product.id, original_invoice_item_id: f.lines[0].id, qty: '-1.000', base_qty: '-1.000', base_unit_snapshot: 'piece' });
  const { rows: [application] } = await pool.query('SELECT original_invoice_id,customer_id,total_credit,applied_amount,unapplied_amount FROM sales_return_applications WHERE credit_invoice_id=$1', [credit.id]);
  assert.deepEqual(application, { original_invoice_id: f.id, customer_id: f.customer.id, total_credit: '100.00', applied_amount: '100.00', unapplied_amount: '0.00' });
});

test('Phase3 paid sale return retains a traceable unapplied customer credit without inventing cash', async () => {
  const f = await sale({ invoice: { payment: { amount_paid: 200, modes: [{ mode: 'cash', amount: 200 }] } } });
  const credit = await returned(f);
  const actual = await effects(f);
  assert.equal(actual.paid, '200.00');
  assert.equal(actual.due, '0.00');
  assert.equal(actual.payments, 1);
  assert.equal(actual.outstanding, '-100.00');
  const { rows: [application] } = await pool.query('SELECT total_credit,applied_amount,unapplied_amount FROM sales_return_applications WHERE credit_invoice_id=$1', [credit.id]);
  assert.deepEqual(application, { total_credit: '100.00', applied_amount: '0.00', unapplied_amount: '100.00' });
});

test('Phase3 return splits applied and unapplied credit when its value exceeds remaining due', async () => {
  const f = await sale({ invoice: { payment: { amount_paid: 150, modes: [{ mode: 'cash', amount: 150 }], due_date: '2026-02-15' } } });
  const credit = await returned(f);
  const { rows: [application] } = await pool.query('SELECT total_credit,applied_amount,unapplied_amount FROM sales_return_applications WHERE credit_invoice_id=$1', [credit.id]);
  assert.deepEqual(application, { total_credit: '100.00', applied_amount: '50.00', unapplied_amount: '50.00' });
  const actual = await effects(f);
  assert.equal(actual.paid, '150.00');
  assert.equal(actual.due, '0.00');
  assert.equal(actual.outstanding, '-50.00');
});

test('Phase3 fractional partial returns with a fixed discount conserve the original posted components', async () => {
  const f = await sale({ product: { gst_rate: 18, purchase_price: 0.02 },
    items: product => [{ product_id: product.id, qty: '1.500', unit: 'piece', rate: '0.11', discount_amount: '0.03' }] });
  const credits = [await returned(f, returnIntent(f, '0.333')), await returned(f, returnIntent(f, '0.334')), await returned(f, returnIntent(f, '0.833'))];
  const { rows: [totals] } = await pool.query(`SELECT SUM(subtotal)::text AS subtotal, SUM(discount_total)::text AS discount_total,
    SUM(taxable_total)::text AS taxable_total, SUM(gst_total)::text AS gst_total, SUM(grand_total)::text AS grand_total,
    SUM(total_cost)::text AS total_cost, SUM(profit_amount)::text AS profit_amount FROM invoices WHERE id=ANY($1::integer[])`,
  [[f.id, ...credits.map(credit => credit.id)]]);
  assert.deepEqual(totals, { subtotal: '0.00', discount_total: '0.00', taxable_total: '0.00', gst_total: '0.00', grand_total: '0.00', total_cost: '0.00', profit_amount: '0.00' });
  assert.equal((await effects(f)).stock, '100.000');
});

test('Phase3 return cannot round an unrepresentable fractional base quantity into stock', async () => {
  const customer = await fixtureCustomer();
  const product = await fixtureProduct();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit) VALUES($1,'half',0.5,true)", [product.id]);
  const response = await post('/invoices', { customer_id: customer.id, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: product.id, qty: 2, unit: 'half', rate: 100 }],
    payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const id = response.body.data.invoice_id;
  const { rows: lines } = await pool.query('SELECT * FROM invoice_items WHERE invoice_id=$1', [id]);
  const f = { customer, product, id, lines };
  const before = await effects(f);
  const rejected = await post(`/invoices/${id}/return`, returnIntent(f, '0.001'));
  assert.equal(rejected.status, 422, JSON.stringify(rejected.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 conflicting supplied return valuation is rejected rather than trusted', async () => {
  const f = await sale();
  const before = await effects(f);
  const body = returnIntent(f);
  body.items[0].rate = 999;
  body.items[0].cost_price_snapshot = 999;
  const response = await post(`/invoices/${f.id}/return`, body);
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 a source line from another invoice cannot authorize this return', async () => {
  const f = await sale();
  const other = await sale();
  const before = await effects(f);
  const beforeOther = await effects(other);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(other));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
  assert.deepEqual(await effects(other), beforeOther);
});

test('Phase3 invalid persisted actor or missing key fails before any business writes', async () => {
  const f = await sale();
  const before = await effects(f);
  const missingActor = await post(`/invoices/${f.id}/return`, returnIntent(f), { operationActor: null });
  assert.equal(missingActor.status, 400, JSON.stringify(missingActor.body));
  assert.equal(missingActor.body.code, 'INVALID_OPERATION_ACTOR');
  const missingKey = await post(`/invoices/${f.id}/return`, returnIntent(f), { key: null });
  assert.equal(missingKey.status, 400, JSON.stringify(missingKey.body));
  assert.equal(missingKey.body.code, 'INVALID_IDEMPOTENCY_KEY');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 cashier cannot post a populated sales return or reserve its retry key', async () => {
  const f = await sale();
  const actor = await setupActor('cashier');
  const before = await effects(f);
  const key = randomUUID();
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f), { actor, key });
  assert.equal(response.status, 403, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
});

test('Phase3 application insertion failure rolls back every preceding return posting', async () => {
  const f = await sale();
  const suffix = f.customer.id;
  const before = await effects(f);
  const body = returnIntent(f);
  const key = randomUUID();
  await pool.query(`CREATE FUNCTION phase3_application_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.original_invoice_id=${f.id} THEN RAISE EXCEPTION 'synthetic return application failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER phase3_application_failure_${suffix} BEFORE INSERT ON sales_return_applications FOR EACH ROW EXECUTE FUNCTION phase3_application_failure_${suffix}()`);
  try {
    const response = await post(`/invoices/${f.id}/return`, body, { key });
    assert.equal(response.status, 500, JSON.stringify(response.body));
    assert.deepEqual(await effects(f), before);
    assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
    assert.equal((await pool.query('SELECT * FROM sales_return_applications WHERE original_invoice_id=$1', [f.id])).rowCount, 0);
  } finally {
    await pool.query(`DROP TRIGGER phase3_application_failure_${suffix} ON sales_return_applications`);
    await pool.query(`DROP FUNCTION phase3_application_failure_${suffix}()`);
  }
  await returned(f, body, { key });
  assert.equal((await effects(f)).stock, '99.000');
});

test('Phase3 application role cannot update or delete issued credit headers, lines or applications', async () => {
  const f = await sale();
  const credit = await returned(f);
  const before = await effects(f);
  await assert.rejects(appPool.query('UPDATE invoices SET grand_total=0 WHERE id=$1', [credit.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('DELETE FROM invoices WHERE id=$1', [credit.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('UPDATE invoice_items SET line_total=0 WHERE invoice_id=$1', [credit.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('DELETE FROM invoice_items WHERE invoice_id=$1', [credit.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('UPDATE sales_return_applications SET applied_amount=0 WHERE credit_invoice_id=$1', [credit.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('DELETE FROM sales_return_applications WHERE credit_invoice_id=$1', [credit.id]), /immutable|append.only|permission denied/i);
  assert.deepEqual(await effects(f), before);
});

test('Phase3 payment rejects an application backed by an ordinary sale despite a balanced header', async () => {
  const f = await sale();
  const other = await post('/invoices', { customer_id: f.customer.id, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: f.product.id, qty: 1, unit: 'piece', rate: 50 }],
    payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' } });
  assert.equal(other.status, 201, JSON.stringify(other.body));
  const actor = await setupActor();
  await pool.query(`INSERT INTO sales_return_applications(credit_invoice_id,original_invoice_id,customer_id,total_credit,applied_amount,unapplied_amount,date,created_by)
    VALUES($1,$2,$3,50,50,0,'2026-01-16',$4)`, [other.body.data.invoice_id, f.id, f.customer.id, actor.id]);
  await pool.query('UPDATE invoices SET balance_due=150 WHERE id=$1', [f.id]);
  const before = await effects(f);
  const key = randomUUID();
  const response = await post('/payments', { customer_id: f.customer.id, invoice_id: f.id, amount: 150, mode: 'cash', payment_date: '2026-01-17' }, { key });
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'INVOICE_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
});

test('Phase3 payment rejects an original invoice with an unproven linked credit', async () => {
  const f = await sale();
  const actor = await setupActor();
  await pool.query(`INSERT INTO invoices(customer_id,bill_type,date,grand_total,amount_paid,balance_due,status,pdf_status,created_by,document_kind,contract_version,original_invoice_id)
    VALUES($1,'retail','2026-01-16',-50,0,0,'paid','disabled',$2,'sales_return','phase3-v1',$3)`, [f.customer.id, actor.id, f.id]);
  const before = await effects(f);
  const response = await post('/payments', { customer_id: f.customer.id, invoice_id: f.id, amount: 100, mode: 'cash', payment_date: '2026-01-17' });
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'INVOICE_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 return quote exposes issued quantities and valuation without reserving or posting', async () => {
  const f = await sale();
  const before = await effects(f);
  const body = returnIntent(f);
  const key = randomUUID();
  const response = await post(`/invoices/${f.id}/return/quote`, body, { key });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const quote = response.body.data;
  assert.equal(quote.grand_total, '100.00');
  assert.equal(quote.applied_amount, '100.00');
  assert.equal(quote.unapplied_amount, '0.00');
  assert.equal(quote.items[0].remaining_qty, '2.000');
  assert.equal(quote.items[0].remaining_qty_after, '1.000');
  assert.equal(quote.items[0].base_qty, '1.000');
  assert.equal(quote.items[0].base_unit_snapshot, 'piece');
  assert.match(quote.quote_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  await returned(f, { ...body, quote_hash: quote.quote_hash }, { key });
  assert.equal((await effects(f)).stock, '99.000');
});

test('Phase3 stale return quote requires review after another return changes eligibility', async () => {
  const f = await sale({ items: product => [{ product_id: product.id, qty: 3, unit: 'piece', rate: 100 }] });
  const body = returnIntent(f);
  const quote = await post(`/invoices/${f.id}/return/quote`, body);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  await returned(f);
  const before = await effects(f);
  const key = randomUUID();
  const response = await post(`/invoices/${f.id}/return`, { ...body, quote_hash: quote.body.data.quote_hash }, { key });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_QUOTE_CHANGED');
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  const reviewed = await post(`/invoices/${f.id}/return/quote`, body);
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  await returned(f, { ...body, quote_hash: reviewed.body.data.quote_hash }, { key });
  assert.equal((await effects(f)).returned, '2.000');
});

test('Phase3 stale return quote cannot silently change applied credit to unapplied credit after payment', async () => {
  const f = await sale();
  const body = returnIntent(f);
  const quote = await post(`/invoices/${f.id}/return/quote`, body);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  const payment = await post('/payments', { customer_id: f.customer.id, invoice_id: f.id, amount: 200, mode: 'cash', payment_date: '2026-01-16' });
  assert.equal(payment.status, 201, JSON.stringify(payment.body));
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, { ...body, quote_hash: quote.body.data.quote_hash });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_QUOTE_CHANGED');
  assert.deepEqual(await effects(f), before);
  const reviewed = await post(`/invoices/${f.id}/return/quote`, body);
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.body.data.applied_amount, '0.00');
  assert.equal(reviewed.body.data.unapplied_amount, '100.00');
});

test('Phase3 invoice details expose cumulative returned quantity and linked credit application', async () => {
  const f = await sale();
  const credit = await returned(f);
  const actor = await setupActor();
  const response = await request(app).get(`/api/invoices/${f.id}`).set('Origin', origin).set('Cookie', actor.cookie).set('X-Forwarded-For', actor.ip);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const original = response.body.data;
  assert.equal(original.document_kind, 'sale');
  assert.equal(original.grand_total, '200.00');
  assert.equal(original.items[0].qty_returned, '1.000');
  assert.equal(original.items[0].base_unit_snapshot, 'piece');
  assert.equal(original.return_applications.length, 1);
  assert.equal(original.return_applications[0].credit_invoice_id, credit.id);
  assert.equal(original.return_applications[0].applied_amount, '100.00');
});

test('Phase3 provable Phase2 sale remains returnable using its saved issued facts', async () => {
  const f = await sale();
  await pool.query('UPDATE invoices SET document_kind=NULL,contract_version=NULL WHERE id=$1', [f.id]);
  const credit = await returned(f);
  assert.equal(credit.grand_total, '-100.00');
  assert.equal((await effects(f)).stock, '99.000');
  const { rows: [original] } = await pool.query('SELECT document_kind,contract_version FROM invoices WHERE id=$1', [f.id]);
  assert.deepEqual(original, { document_kind: null, contract_version: null }, 'Legacy identity must not be rewritten during an ordinary return');
});

test('Phase3 legacy sale without saved issuing evidence requires reconciliation', async () => {
  const f = await sale();
  await pool.query('UPDATE invoices SET document_kind=NULL,contract_version=NULL WHERE id=$1', [f.id]);
  await pool.query("DELETE FROM idempotency_keys WHERE operation='invoice.create' AND response_body->'data'->>'invoice_id'=$1", [String(f.id)]);
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 legacy sale with conflicting saved issuing evidence requires reconciliation', async () => {
  const f = await sale();
  await pool.query('UPDATE invoices SET document_kind=NULL,contract_version=NULL WHERE id=$1', [f.id]);
  await pool.query(`UPDATE idempotency_keys SET response_body=jsonb_set(response_body,'{data,items,0,base_qty}','"999.000"'::jsonb)
    WHERE operation='invoice.create' AND response_body->'data'->>'invoice_id'=$1`, [String(f.id)]);
  const before = await effects(f);
  const response = await post(`/invoices/${f.id}/return`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'RETURN_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 high negative-margin source preserves wide profit percentage and exact return cost', async () => {
  const f = await sale({ product: { purchase_price: '999999999.99' },
    items: product => [{ product_id: product.id, qty: 1, unit: 'piece', rate: '0.01' }] });
  const credit = await returned(f);
  assert.equal(credit.grand_total, '-0.01');
  assert.equal(credit.total_cost, '-999999999.99');
  assert.equal(credit.profit_amount, '999999999.98');
  assert.equal((await effects(f)).stock, '100.000');
});

test('Phase3 a later free-item return preserves prior applied-credit partial status', async () => {
  const f = await sale({ items: product => [{ product_id: product.id, qty: 2, unit: 'piece', rate: 100 },
    { product_id: product.id, qty: 1, unit: 'piece', rate: 0 }] });
  await returned(f);
  const free = returnIntent(f);
  free.items[0].invoice_item_id = f.lines[1].id;
  const credit = await returned(f, free);
  assert.equal(credit.grand_total, '0.00');
  const { rows: [original] } = await pool.query('SELECT status,amount_paid,balance_due FROM invoices WHERE id=$1', [f.id]);
  assert.deepEqual(original, { status: 'partial', amount_paid: '0.00', balance_due: '100.00' });
});
