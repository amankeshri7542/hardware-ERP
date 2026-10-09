const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setImmediate } = require('node:timers');
const { pool, appPool, post, fixtureCustomer, fixtureProduct, setupActor, close } = require('../helpers/financial');
after(close);
async function fixture(productOptions) {
  return { customer: await fixtureCustomer(), product: await fixtureProduct(productOptions) };
}
function intent(f, overrides = {}) {
  return { customer_id: f.customer.id, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: f.product.id, qty: 2, unit: 'piece', rate: 100 }],
    payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' }, ...overrides };
}
async function counts(f) {
  const { rows: [row] } = await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM invoices WHERE customer_id=$1) AS invoices,
    (SELECT COUNT(*)::integer FROM payments WHERE customer_id=$1) AS payments,
    (SELECT COUNT(*)::integer FROM customer_ledger WHERE customer_id=$1) AS ledger,
    (SELECT outstanding_balance FROM customers WHERE id=$1) AS balance,
    (SELECT COUNT(*)::integer FROM stock_ledger WHERE product_id=$2 AND reference_type='invoice') AS movements,
    (SELECT current_stock FROM products WHERE id=$2) AS stock`, [f.customer.id, f.product.id]);
  return row;
}
async function issued(body, options) {
  const response = await post('/invoices', body, options);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.data;
}
test('financial endpoint connections use the restricted application role', async () => {
  const { rows: [row] } = await appPool.query('SELECT current_user AS role');
  assert.equal(row.role, process.env.TEST_APP_DB_USER);
  await assert.rejects(appPool.query("UPDATE users SET name='forbidden' WHERE false"), /permission denied/);
});
test('invoice derives product snapshots and stock, without changing catalog prices or history', async () => {
  const f = await fixture({ gst_rate: 18 });
  const body = intent(f);
  Object.assign(body.items[0], { rate: 123, product_name_snapshot: 'Forged', hsn_snapshot: '9999', base_qty: 1, cost_price_snapshot: 999, gst_pct: 0, line_total: 1 });
  body.grand_total = 1;
  const invoice = await issued(body);
  assert.equal(invoice.grand_total, '290.28');
  const { rows: [item] } = await pool.query('SELECT product_name_snapshot,hsn_snapshot,base_qty,cost_price_snapshot,gst_pct,line_total FROM invoice_items WHERE invoice_id=$1', [invoice.invoice_id]);
  assert.deepEqual(item, { product_name_snapshot: f.product.name, hsn_snapshot: '1234', base_qty: '2.000', cost_price_snapshot: '30.00', gst_pct: '18.00', line_total: '290.28' });
  const { rows: [product] } = await pool.query('SELECT mrp,wholesale_price,purchase_price,current_stock FROM products WHERE id=$1', [f.product.id]);
  assert.deepEqual(product, { mrp: '100.00', wholesale_price: '100.00', purchase_price: '30.00', current_stock: '98.000' });
  assert.equal((await pool.query('SELECT * FROM product_price_history WHERE product_id=$1', [f.product.id])).rowCount, 0);
});
test('alternate unit quantity uses selected-unit price and authoritative base-unit cost', async () => {
  const f = await fixture();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit) VALUES($1,'box',10,true)", [f.product.id]);
  const body = intent(f, { items: [{ product_id: String(f.product.id), qty: '2.000', unit: 'box', rate: '100.00' }] });
  const invoice = await issued(body);
  assert.equal(invoice.grand_total, '200.00');
  assert.equal(invoice.totals.total_cost, '600.00');
  assert.equal(invoice.totals.profit_amount, '-400.00');
  assert.equal(invoice.items[0].base_qty, '20.000');
  assert.equal((await counts(f)).stock, '80.000');
});
test('registered Quick Bill posts receivable and every tender exactly once', async () => {
  const f = await fixture();
  const invoice = await issued(intent(f, { bill_type: 'quickbill', payment: { amount_paid: '50.00', modes: [{ mode: 'cash', amount: '20.00' }, { mode: 'upi', amount: '30.00' }], due_date: '2026-02-15' } }));
  assert.equal(invoice.balance_due, '150.00');
  assert.deepEqual(await counts(f), { invoices: 1, payments: 1, ledger: 2, balance: '150.00', movements: 1, stock: '98.000' });
  const { rows } = await pool.query('SELECT d.mode,d.amount FROM payment_modes_detail d JOIN payments p ON p.id=d.payment_id WHERE p.invoice_id=$1 ORDER BY d.id', [invoice.invoice_id]);
  assert.deepEqual(rows, [{ mode: 'cash', amount: '20.00' }, { mode: 'upi', amount: '30.00' }]);
});
test('anonymous Quick Bill is allowed only when fully paid and has no customer ledger', async () => {
  const f = await fixture();
  const body = intent(f, { customer_id: null, customer_name_walkin: 'Synthetic walk-in', bill_type: 'quickbill' });
  const rejected = await post('/invoices', body);
  assert.equal(rejected.status, 422);
  body.payment = { amount_paid: 200, modes: [{ mode: 'cash', amount: 200 }] };
  const invoice = await issued(body);
  const { rows: [payment] } = await pool.query('SELECT customer_id,amount FROM payments WHERE invoice_id=$1', [invoice.invoice_id]);
  assert.deepEqual(payment, { customer_id: null, amount: '200.00' });
  assert.equal((await pool.query("SELECT * FROM customer_ledger WHERE reference_type='invoice' AND reference_id=$1", [invoice.invoice_id])).rowCount, 0);
});
test('invalid money, dates, customer, discount and tender intent leave no financial writes', async () => {
  const f = await fixture();
  const variants = [
    b => { b.items[0].rate = '1e2'; }, b => { b.items[0].rate = '1.001'; },
    b => { b.items[0].qty = '0.0001'; }, b => { b.items[0].rate = true; },
    b => { b.items[0].discount_amount = 101; }, b => { b.items[0].discount_pct = 101; },
    b => { b.items[0].discount_amount = 1; b.items[0].discount_pct = 1; },
    b => { b.items[0].alt_qty = 1; }, b => { b.items[0].unknown = 1; },
    b => { b.date = '2026-02-30'; }, b => { b.payment.due_date = '2026-01-14'; },
    b => { delete b.payment.due_date; }, b => { b.customer_id = null; },
    b => { b.payment = { amount_paid: 50, modes: [{ mode: 'cash', amount: 49 }], due_date: '2026-02-15' }; },
    b => { b.payment = { amount_paid: 201, modes: [{ mode: 'cash', amount: 201 }] }; },
    b => { b.payment = { amount_paid: 0, modes: [{ mode: 'cash', amount: 0 }], due_date: '2026-02-15' }; },
  ];
  for (const [index, change] of variants.entries()) {
    const body = intent(f); change(body);
    const response = await post('/invoices', body);
    assert.equal(response.status, 422, `Invalid variant ${index}: ${JSON.stringify(response.body)}`);
  }
  assert.deepEqual(await counts(f), { invoices: 0, payments: 0, ledger: 0, balance: '0.00', movements: 0, stock: '100.000' });
});
test('inactive products and customers, unavailable units and unrepresentable conversion fractions are rejected', async () => {
  const f = await fixture();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit) VALUES($1,'disabled',10,false),($1,'tiny',0.0001,true)", [f.product.id]);
  for (const unit of ['disabled', 'missing', 'tiny']) {
    const body = intent(f); body.items[0].unit = unit;
    assert.equal((await post('/invoices', body)).status, 422, unit);
  }
  await pool.query('UPDATE products SET is_active=false WHERE id=$1', [f.product.id]);
  assert.equal((await post('/invoices', intent(f))).status, 422);
  await pool.query('UPDATE products SET is_active=true WHERE id=$1', [f.product.id]);
  await pool.query('UPDATE customers SET is_active=false WHERE id=$1', [f.customer.id]);
  assert.equal((await post('/invoices', intent(f))).status, 422);
  assert.deepEqual(await counts(f), { invoices: 0, payments: 0, ledger: 0, balance: '0.00', movements: 0, stock: '100.000' });
});
test('stock validation aggregates repeated products while preserving separate prices', async () => {
  const f = await fixture();
  const body = intent(f, { items: [{ product_id: f.product.id, qty: 60, unit: 'piece', rate: 100 }, { product_id: f.product.id, qty: 60, unit: 'piece', rate: 90 }] });
  assert.equal((await post('/invoices', body)).status, 422);
  assert.equal((await counts(f)).stock, '100.000');
  body.items[0].qty = 40; body.items[1].qty = 30;
  const invoice = await issued(body);
  assert.equal(invoice.grand_total, '6700.00');
  const { rows } = await pool.query("SELECT qty_out,stock_after FROM stock_ledger WHERE product_id=$1 AND reference_type='invoice' ORDER BY id", [f.product.id]);
  assert.deepEqual(rows, [{ qty_out: '40.000', stock_after: '60.000' }, { qty_out: '30.000', stock_after: '30.000' }]);
});
test('authoritative quote writes nothing and a catalog change requires a new review', async () => {
  const f = await fixture();
  const body = intent(f);
  const quote = await post('/invoices/quote', body);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.deepEqual(await counts(f), { invoices: 0, payments: 0, ledger: 0, balance: '0.00', movements: 0, stock: '100.000' });
  await pool.query('UPDATE products SET gst_rate=18,purchase_price=35 WHERE id=$1', [f.product.id]);
  body.quote_hash = quote.body.data.quote_hash;
  const key = randomUUID();
  const stale = await post('/invoices', body, { key });
  assert.equal(stale.status, 409, JSON.stringify(stale.body));
  assert.equal(stale.body.code, 'QUOTE_CHANGED');
  const fresh = await post('/invoices/quote', intent(f));
  body.quote_hash = fresh.body.data.quote_hash;
  assert.equal((await issued(body, { key })).grand_total, '236.00');
});
test('concurrent invoices cannot oversell the same product', async () => {
  const f = await fixture({ current_stock: 2 });
  const responses = await Promise.all([post('/invoices', intent(f)), post('/invoices', intent(f))]);
  assert.deepEqual(responses.map(r => r.status).sort(), [201, 422]);
  assert.deepEqual(await counts(f), { invoices: 1, payments: 0, ledger: 1, balance: '200.00', movements: 1, stock: '0.000' });
});
test('concurrent invoice retries have one committed effect and replay survives later catalog changes', async () => {
  const f = await fixture();
  const body = intent(f);
  const key = randomUUID();
  const responses = await Promise.all([post('/invoices', body, { key }), post('/invoices', body, { key })]);
  responses.forEach(response => assert.equal(response.status, 201, JSON.stringify(response.body)));
  assert.deepEqual(responses[0].body, responses[1].body);
  await pool.query('UPDATE products SET purchase_price=90,is_active=false WHERE id=$1', [f.product.id]);
  const replay = await post('/invoices', body, { key });
  assert.deepEqual(replay.body, responses[0].body);
  const changed = intent(f); changed.items[0].qty = 3;
  assert.equal((await post('/invoices', changed, { key })).status, 409);
  assert.deepEqual(await counts(f), { invoices: 1, payments: 0, ledger: 1, balance: '200.00', movements: 1, stock: '98.000' });
});
test('late tender insertion failure rolls back invoice, stock, receivable, receipt and retry reservation', async () => {
  const f = await fixture();
  const suffix = f.customer.id;
  await pool.query(`CREATE FUNCTION phase2_tender_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM payments WHERE id=NEW.payment_id AND customer_id=${suffix}) THEN RAISE EXCEPTION 'synthetic tender insertion failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER phase2_tender_failure_${suffix} BEFORE INSERT ON payment_modes_detail FOR EACH ROW EXECUTE FUNCTION phase2_tender_failure_${suffix}()`);
  const key = randomUUID();
  const body = intent(f, { payment: { amount_paid: 50, modes: [{ mode: 'cash', amount: 50 }], due_date: '2026-02-15' } });
  try {
    const response = await post('/invoices', body, { key });
    assert.equal(response.status, 500, JSON.stringify(response.body));
    assert.deepEqual(await counts(f), { invoices: 0, payments: 0, ledger: 0, balance: '0.00', movements: 0, stock: '100.000' });
    assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  } finally {
    await pool.query(`DROP TRIGGER phase2_tender_failure_${suffix} ON payment_modes_detail`);
    await pool.query(`DROP FUNCTION phase2_tender_failure_${suffix}()`);
  }
  await issued(body, { key });
  assert.deepEqual(await counts(f), { invoices: 1, payments: 1, ledger: 2, balance: '150.00', movements: 1, stock: '98.000' });
});

test('cashier cannot request cost-bearing quotes or post invoices', async () => {
  const f = await fixture();
  const actor = await setupActor('cashier');
  assert.equal((await post('/invoices/quote', intent(f), { actor })).status, 403);
  assert.equal((await post('/invoices', intent(f), { actor })).status, 403);
  assert.deepEqual(await counts(f), { invoices: 0, payments: 0, ledger: 0, balance: '0.00', movements: 0, stock: '100.000' });
});
for (const example of require('../../../shared/billing-fixtures.json')) {
  test('persisted wholesale rounding: ' + example.name, async () => {
    const item = example.items[0];
    const f = await fixture({ gst_rate: item.gst_pct, purchase_price: item.cost_price_snapshot });
    const line = { product_id: f.product.id, qty: item.qty, unit: 'piece', rate: item.rate };
    if (item.discount_pct !== undefined) line.discount_pct = item.discount_pct;
    else line.discount_amount = item.discount_amount;
    if (item.base_qty !== item.qty) {
      await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit) VALUES($1,'box',10,true)", [f.product.id]);
      line.unit = 'box';
    }
    const invoice = await issued(intent(f, { bill_type: 'wholesale', items: [line] }));
    const { rows: [saved] } = await pool.query('SELECT subtotal,discount_total,taxable_total,gst_total,grand_total,total_cost,profit_amount FROM invoices WHERE id=$1', [invoice.invoice_id]);
    assert.deepEqual(saved, example.expected);
    const { rows: [savedItem] } = await pool.query('SELECT taxable_amount,gst_amount,line_total,line_profit,base_qty FROM invoice_items WHERE invoice_id=$1', [invoice.invoice_id]);
    assert.deepEqual(savedItem, { taxable_amount: example.expected.taxable_total, gst_amount: example.expected.gst_total, line_total: example.expected.grand_total, line_profit: example.expected.profit_amount, base_qty: item.base_qty });
  });
}
test('anonymous quote accepts provisional zero payment, and a zero-value sale creates no receipt', async () => {
  const f = await fixture();
  const body = intent(f, { customer_id: null, customer_name_walkin: 'Walk-in', bill_type: 'quickbill', payment: { amount_paid: 0, modes: [] } });
  const quote = await post('/invoices/quote', body);
  assert.equal(quote.status, 200, JSON.stringify(quote.body));
  assert.equal(quote.body.data.totals.grand_total, '200.00');
  body.items[0].rate = 0;
  const invoice = await issued(body);
  assert.equal(invoice.status, 'paid');
  assert.equal(invoice.grand_total, '0.00');
  assert.equal((await pool.query('SELECT * FROM payments WHERE invoice_id=$1', [invoice.invoice_id])).rowCount, 0);
});
test('concurrent sales on different products and a customer advance serialize the customer ledger', async () => {
  const f = await fixture();
  const other = { customer: f.customer, product: await fixtureProduct() };
  const blocker = await pool.connect();
  let pending;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [f.customer.id]);
    pending = Promise.all([
      post('/invoices', intent(f)), post('/invoices', intent(other)),
      post('/payments', { customer_id: f.customer.id, amount: 50, mode: 'cash', payment_date: '2026-01-15' }),
    ]);
    const deadline = Date.now() + 5000;
    let waiting = 0;
    while (Date.now() < deadline) {
      const { rows: [state] } = await pool.query("SELECT COUNT(*)::integer AS waiting FROM pg_stat_activity WHERE datname=current_database() AND usename=$1 AND wait_event_type='Lock'", [process.env.TEST_APP_DB_USER]);
      waiting = state.waiting;
      if (waiting >= 3) break;
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok(waiting >= 3, 'All three requests must overlap while the customer row is locked');
    await blocker.query('COMMIT');
    const responses = await pending;
    responses.forEach(response => assert.equal(response.status, 201, JSON.stringify(response.body)));
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    if (pending) await pending;
  }
  const { rows } = await pool.query('SELECT debit,credit,balance FROM customer_ledger WHERE customer_id=$1 ORDER BY id', [f.customer.id]);
  assert.equal(rows.length, 3);
  let balance = 0;
  for (const row of rows) {
    balance += Number(row.debit) - Number(row.credit);
    assert.equal(Number(row.balance), balance, 'Every ledger row records its serialized running balance');
  }
  assert.equal(balance, 350);
  const state = await counts(f);
  assert.equal(state.balance, '350.00');
  assert.equal(state.invoices, 2);
  assert.equal(state.payments, 1);
});

test('invoice posting requires the persisted operation actor and cannot replay across a switched account', async () => {
  const f = await fixture();
  const actor = await setupActor();
  const switched = await setupActor('admin', 'switched-account');
  const body = intent(f);
  const key = randomUUID();
  for (const operationActor of [null, 'invalid']) {
    const response = await post('/invoices', body, { actor, key, operationActor });
    assert.equal(response.status, 400, JSON.stringify(response.body));
    assert.equal(response.body.code, 'INVALID_OPERATION_ACTOR');
  }
  const first = await issued(body, { actor, key });
  const response = await post('/invoices', body, { actor: switched, key, operationActor: actor.id });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'OPERATION_ACTOR_MISMATCH');
  assert.equal((await post('/invoices', body, { actor, key })).body.data.invoice_id, first.invoice_id);
  assert.deepEqual(await counts(f), { invoices: 1, payments: 0, ledger: 1, balance: '200.00', movements: 1, stock: '98.000' });
});
