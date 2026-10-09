const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { setImmediate } = require('node:timers/promises');
const { pool, appPool, post, fixtureProduct, fixtureCustomer, setupActor, close } = require('../helpers/financial');
const { lockWaiters } = require('../helpers/lockWaiters');

after(close);

async function fixture(productOptions = {}) {
  const { rows: [supplier] } = await pool.query('INSERT INTO suppliers(name) VALUES($1) RETURNING *', [`Synthetic supplier ${randomUUID()}`]);
  return { supplier, product: await fixtureProduct(productOptions) };
}

function receiptIntent(f, overrides = {}) {
  return { supplier_id: f.supplier.id, date: '2026-01-15',
    items: [{ product_id: f.product.id, qty: 2, unit: 'piece', cost_price: 30, line_total: 60 }], ...overrides };
}

async function received(f, body = receiptIntent(f), options) {
  const response = await post('/purchases', body, options);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const id = response.body.data.purchase.id;
  const { rows: lines } = await pool.query('SELECT * FROM purchase_items WHERE purchase_id=$1 ORDER BY id', [id]);
  return { ...f, id, lines };
}

function returnIntent(f, quantity = 1, overrides = {}) {
  return { return_date: '2026-01-16', reason: 'Synthetic supplier return',
    items: [{ purchase_item_id: f.lines[0].id, product_id: f.product.id, qty_returned: quantity, cost_price: f.lines[0].cost_price }], ...overrides };
}

async function returned(f, body = returnIntent(f), options) {
  const response = await post(`/purchases/${f.id}/returns`, body, options);
  assert.equal(response.status, 201, JSON.stringify(response.body));
  const id = response.body.data.id;
  const { rows: [document] } = await pool.query('SELECT * FROM purchase_returns WHERE id=$1', [id]);
  assert.ok(document, 'A successful supplier return must persist its source-linked document');
  return document;
}

async function effects(f) {
  const { rows: [row] } = await pool.query(`SELECT
    (SELECT COUNT(*)::integer FROM purchases WHERE supplier_id=$1) AS purchases,
    (SELECT COUNT(*)::integer FROM purchase_items pi JOIN purchases p ON p.id=pi.purchase_id WHERE p.supplier_id=$1) AS items,
    (SELECT COUNT(*)::integer FROM purchase_returns WHERE supplier_id=$1) AS returns,
    (SELECT COUNT(*)::integer FROM purchase_return_items ri JOIN purchase_returns r ON r.id=ri.purchase_return_id WHERE r.supplier_id=$1) AS return_items,
    (SELECT COUNT(*)::integer FROM supplier_debit_notes WHERE supplier_id=$1) AS debit_notes,
    (SELECT COUNT(*)::integer FROM stock_ledger WHERE product_id=$2) AS movements,
    (SELECT COUNT(*)::integer FROM product_price_history WHERE product_id=$2) AS price_history,
    (SELECT COUNT(*)::integer FROM product_suppliers WHERE supplier_id=$1) AS supplier_links,
    (SELECT current_stock FROM products WHERE id=$2) AS stock,
    (SELECT purchase_price FROM products WHERE id=$2) AS cost`, [f.supplier.id, f.product.id]);
  return row;
}

async function concurrentAt(table, id, calls) {
  assert.ok(['purchases', 'products'].includes(table));
  const blocker = await pool.connect();
  let pending;
  let barrierError;
  try {
    await blocker.query('BEGIN');
    const { rows: [{ pid }] } = await blocker.query('SELECT pg_backend_pid() AS pid');
    await blocker.query(`SELECT id FROM ${table} WHERE id=$1 FOR UPDATE`, [id]);
    pending = Promise.all(calls.map(call => call()));
    const deadline = Date.now() + 5000;
    let count = 0;
    while (count < calls.length && Date.now() < deadline) {
      count = await lockWaiters(pool, pid);
      await setImmediate();
    }
    assert.equal(count, calls.length, 'Every request must reach this fixture\'s blocking lock chain');
  } catch (error) { barrierError = error; }
  finally { await blocker.query('ROLLBACK'); blocker.release(); }
  const responses = await pending;
  if (barrierError) throw barrierError;
  return responses;
}

test('Phase3 purchase control: valid original-line supplier return reverses one piece and 30 rupees', async () => {
  const f = await received(await fixture());
  assert.equal((await effects(f)).stock, '102.000');
  const document = await returned(f);
  assert.equal(document.total_amount, '30.00');
  const actual = await effects(f);
  assert.equal(actual.stock, '101.000');
  assert.equal(actual.purchases, 1);
  assert.equal(actual.returns, 1);
  assert.equal(actual.debit_notes, 1);
  assert.equal(actual.movements, 3);
});

test('Phase3 purchase derives receipt value despite forged client totals and base quantity', async () => {
  const f = await fixture();
  const body = receiptIntent(f);
  body.items[0].line_total = 999;
  body.items[0].base_qty = 999;
  body.total_amount = 999;
  const original = await received(f, body);
  const { rows: [header] } = await pool.query('SELECT total_amount FROM purchases WHERE id=$1', [original.id]);
  assert.equal(header.total_amount, '60.00');
  assert.equal(original.lines[0].line_total, '60.00');
  assert.equal((await effects(f)).stock, '102.000');
});

test('Phase3 purchase boxes derive base stock and per-piece current cost from agreed box price', async () => {
  const f = await fixture();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_purchase_unit,is_sales_unit) VALUES($1,'box',10,true,true)", [f.product.id]);
  const original = await received(f, receiptIntent(f, { items: [{ product_id: f.product.id, qty: 2, unit: 'box', cost_price: 100, line_total: 200 }] }));
  const actual = await effects(f);
  assert.equal(actual.stock, '120.000', 'Two boxes of ten must receive twenty base pieces');
  assert.equal(actual.cost, '10.00', 'A box price cannot become per-piece purchase cost');
  assert.equal(original.lines[0].line_total, '200.00');
});

test('Phase3 FIN-08 purchase return rejects wrong product even with valid original purchase line', async () => {
  const f = await received(await fixture());
  const unrelated = await fixtureProduct();
  const before = await effects(f);
  const body = returnIntent(f);
  body.items[0].product_id = unrelated.id;
  const response = await post(`/purchases/${f.id}/returns`, body);
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'PURCHASE_RETURN_PRODUCT_MISMATCH');
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT current_stock FROM products WHERE id=$1', [unrelated.id])).rows[0].current_stock, '100.000');
});

test('Phase3 FIN-08 purchase return rejects forged original cost even with correct line and product', async () => {
  const f = await received(await fixture());
  const before = await effects(f);
  const body = returnIntent(f);
  body.items[0].cost_price = 999;
  const response = await post(`/purchases/${f.id}/returns`, body);
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'PURCHASE_RETURN_VALUE_MISMATCH');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 duplicate purchase-return source lines cannot jointly exceed received quantity', async () => {
  const f = await received(await fixture());
  const before = await effects(f);
  const body = returnIntent(f, 2);
  body.items.push({ ...body.items[0] });
  const response = await post(`/purchases/${f.id}/returns`, body);
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'DUPLICATE_PURCHASE_RETURN_ITEM');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 cumulative supplier returns cannot exceed the original receipt despite other stock', async () => {
  const f = await received(await fixture());
  await returned(f, returnIntent(f, 2));
  const before = await effects(f);
  const response = await post(`/purchases/${f.id}/returns`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'PURCHASE_RETURN_QTY_EXCEEDS_ORIGINAL');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 same-key purchase retry creates one receipt, stock movement and supplier link', async () => {
  const f = await fixture();
  const body = receiptIntent(f);
  const key = randomUUID();
  const first = await received(f, body, { key });
  const before = await effects(f);
  const second = await received(f, body, { key });
  assert.equal(second.id, first.id);
  assert.deepEqual(await effects(f), before);
});

test('Phase3 same-key supplier return retry creates one debit note and stock deduction', async () => {
  const f = await received(await fixture());
  const body = returnIntent(f);
  const key = randomUUID();
  const first = await returned(f, body, { key });
  const before = await effects(f);
  const second = await returned(f, body, { key });
  assert.equal(second.id, first.id);
  assert.deepEqual(await effects(f), before);
});

test('Phase3 supplier return rejects insufficient available stock without a debit note', async () => {
  const f = await received(await fixture({ current_stock: 0 }));
  const customer = await fixtureCustomer();
  const sale = await post('/invoices', { customer_id: customer.id, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: f.product.id, qty: 2, unit: 'piece', rate: 100 }],
    payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' } });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const before = await effects(f);
  const response = await post(`/purchases/${f.id}/returns`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 purchase needs no client-computed amounts and persists immutable selected and base facts', async () => {
  const f = await fixture();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_purchase_unit,is_sales_unit) VALUES($1,'box',10,true,true)", [f.product.id]);
  const original = await received(f, receiptIntent(f, { items: [{ product_id: f.product.id, qty: 2, unit: 'box', cost_price: 100 }] }));
  const line = original.lines[0];
  assert.equal(line.qty, '2.000');
  assert.equal(line.unit, 'box');
  assert.equal(line.cost_price, '100.00');
  assert.equal(line.line_total, '200.00');
  assert.equal(line.base_qty, '20.000');
  assert.equal(line.base_unit_snapshot, 'piece');
  assert.equal(line.conversion_value_snapshot, '10.0000');
  assert.equal(line.product_name_snapshot, f.product.name);
  assert.equal(line.qty_returned, '0.000');
});

test('Phase3 purchase retry ignores discarded computed fields while preserving original intent', async () => {
  const f = await fixture();
  const body = receiptIntent(f);
  const key = randomUUID();
  const first = await received(f, body, { key });
  const before = await effects(f);
  const replay = structuredClone(body);
  replay.total_amount = 1000;
  replay.items[0].line_total = 1000;
  replay.items[0].base_qty = 1000;
  const second = await received(f, replay, { key });
  assert.equal(second.id, first.id);
  assert.deepEqual(await effects(f), before);
});

test('Phase3 boxes to piece sale to customer return to supplier return conserve stock and original cost', async () => {
  const f = await fixture({ current_stock: 0 });
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_purchase_unit,is_sales_unit) VALUES($1,'box',10,true,true)", [f.product.id]);
  const receipt = await received(f, receiptIntent(f, { items: [{ product_id: f.product.id, qty: 2, unit: 'box', cost_price: 100, line_total: 200 }] }));
  const customer = await fixtureCustomer();
  const sale = await post('/invoices', { customer_id: customer.id, bill_type: 'retail', date: '2026-01-16',
    items: [{ product_id: f.product.id, qty: 6, unit: 'piece', rate: 30 }],
    payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' } });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const { rows: [line] } = await pool.query('SELECT id,cost_price_snapshot FROM invoice_items WHERE invoice_id=$1', [sale.body.data.invoice_id]);
  assert.equal(line.cost_price_snapshot, '10.00');
  const salesReturn = await post(`/invoices/${sale.body.data.invoice_id}/return`, { return_date: '2026-01-17', reason: 'Synthetic sellable return', disposition: 'sellable',
    items: [{ invoice_item_id: line.id, qty_returned: 2 }] });
  assert.equal(salesReturn.status, 201, JSON.stringify(salesReturn.body));
  assert.equal(salesReturn.body.data.grand_total, '-60.00');
  await pool.query('UPDATE products SET purchase_price=90 WHERE id=$1', [f.product.id]);
  await pool.query("UPDATE product_unit_conversions SET conversion_value=20 WHERE product_id=$1 AND unit_name='box'", [f.product.id]);
  const supplierReturn = await returned(receipt);
  assert.equal(supplierReturn.total_amount, '100.00');
  assert.equal(supplierReturn.status, 'posted');
  assert.equal((await effects(f)).stock, '6.000');
  assert.equal((await effects(f)).cost, '90.00', 'A supplier return must not reprice current stock');
  const { rows: [stock] } = await pool.query('SELECT SUM(qty_in-qty_out)::text AS quantity FROM stock_ledger WHERE product_id=$1', [f.product.id]);
  assert.equal(stock.quantity, '6.000');
  const { rows: [debit] } = await pool.query('SELECT amount,status FROM supplier_debit_notes WHERE purchase_return_id=$1', [supplierReturn.id]);
  assert.deepEqual(debit, { amount: '100.00', status: 'outstanding' });
});

test('Phase3 fractional supplier returns allocate final cents exactly to original receipt value', async () => {
  const f = await fixture();
  const original = await received(f, receiptIntent(f, { items: [{ product_id: f.product.id, qty: '1.500', unit: 'piece', cost_price: '0.11' }] }));
  await returned(original, returnIntent(original, '0.333'));
  await returned(original, returnIntent(original, '0.334'));
  await returned(original, returnIntent(original, '0.833'));
  const { rows: [total] } = await pool.query('SELECT SUM(total_amount)::text AS amount FROM purchase_returns WHERE purchase_id=$1', [original.id]);
  assert.equal(total.amount, '0.17');
  assert.equal((await effects(f)).stock, '100.000');
  assert.equal((await pool.query('SELECT qty_returned FROM purchase_items WHERE id=$1', [original.lines[0].id])).rows[0].qty_returned, '1.500');
  const { rows: [debits] } = await pool.query('SELECT COUNT(*)::integer AS count,SUM(amount)::text AS amount FROM supplier_debit_notes WHERE supplier_id=$1', [f.supplier.id]);
  assert.deepEqual(debits, { count: 3, amount: '0.17' });
});

test('Phase3 backdated receipt follows explicit last-posted current-cost policy', async () => {
  const f = await fixture();
  await received(f, receiptIntent(f, { date: '2026-01-20', items: [{ product_id: f.product.id, qty: 1, unit: 'piece', cost_price: 50 }] }));
  await received(f, receiptIntent(f, { date: '2026-01-10', items: [{ product_id: f.product.id, qty: 1, unit: 'piece', cost_price: 20 }] }));
  assert.equal((await effects(f)).cost, '20.00');
  assert.equal((await effects(f)).stock, '102.000');
  const { rows: [link] } = await pool.query('SELECT last_price FROM product_suppliers WHERE product_id=$1 AND supplier_id=$2', [f.product.id, f.supplier.id]);
  assert.equal(link.last_price, '20.00');
});

test('Phase3 separate receipt lines keep original costs and last submitted line sets current cost', async () => {
  const f = await fixture();
  const original = await received(f, receiptIntent(f, { items: [{ product_id: f.product.id, qty: 1, unit: 'piece', cost_price: 20 },
    { product_id: f.product.id, qty: 1, unit: 'piece', cost_price: 40 }] }));
  assert.equal((await effects(f)).cost, '40.00');
  const body = returnIntent(original);
  body.items = original.lines.map(line => ({ purchase_item_id: line.id, qty_returned: 1 }));
  const document = await returned(original, body);
  assert.equal(document.total_amount, '60.00');
  assert.equal((await effects(f)).stock, '100.000');
  const { rows: lines } = await pool.query('SELECT purchase_item_id,amount FROM purchase_return_items WHERE purchase_return_id=$1 ORDER BY purchase_item_id', [document.id]);
  assert.deepEqual(lines, [{ purchase_item_id: original.lines[0].id, amount: '20.00' }, { purchase_item_id: original.lines[1].id, amount: '40.00' }]);
});

test('Phase3 aggregate supplier return demand cannot exceed fungible product stock', async () => {
  const f = await fixture({ current_stock: 0 });
  const original = await received(f, receiptIntent(f, { items: [{ product_id: f.product.id, qty: 1, unit: 'piece', cost_price: 20 },
    { product_id: f.product.id, qty: 1, unit: 'piece', cost_price: 40 }] }));
  const customer = await fixtureCustomer();
  const sale = await post('/invoices', { customer_id: customer.id, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: f.product.id, qty: 1, unit: 'piece', rate: 100 }], payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' } });
  assert.equal(sale.status, 201, JSON.stringify(sale.body));
  const before = await effects(f);
  const body = returnIntent(original);
  body.items = original.lines.map(line => ({ purchase_item_id: line.id, qty_returned: 1 }));
  const response = await post(`/purchases/${original.id}/returns`, body);
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
  assert.deepEqual((await pool.query('SELECT qty_returned FROM purchase_items WHERE purchase_id=$1 ORDER BY id', [original.id])).rows,
    [{ qty_returned: '0.000' }, { qty_returned: '0.000' }]);
});

test('Phase3 purchase changed intent conflicts under the same key without another receipt', async () => {
  const f = await fixture();
  const key = randomUUID();
  await received(f, receiptIntent(f), { key });
  const before = await effects(f);
  const body = receiptIntent(f);
  body.items[0].cost_price = 40;
  const response = await post('/purchases', body, { key });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 supplier return changed intent conflicts under the same key without another debit note', async () => {
  const f = await received(await fixture());
  const key = randomUUID();
  await returned(f, returnIntent(f), { key });
  const before = await effects(f);
  const response = await post(`/purchases/${f.id}/returns`, returnIntent(f, '0.500'), { key });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'IDEMPOTENCY_CONFLICT');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 purchase and supplier-return retries remain bound to the original actor', async () => {
  const f = await fixture();
  const actor = await setupActor();
  const other = await setupActor('admin', 'purchase-account-switch');
  const purchaseKey = randomUUID();
  const body = receiptIntent(f);
  const original = await received(f, body, { actor, key: purchaseKey });
  const returnKey = randomUUID();
  const returnedBody = returnIntent(original);
  await returned(original, returnedBody, { actor, key: returnKey });
  const before = await effects(f);
  const purchaseReplay = await post('/purchases', body, { actor: other, operationActor: actor.id, key: purchaseKey });
  assert.equal(purchaseReplay.status, 409, JSON.stringify(purchaseReplay.body));
  assert.equal(purchaseReplay.body.code, 'OPERATION_ACTOR_MISMATCH');
  const returnReplay = await post(`/purchases/${original.id}/returns`, returnedBody, { actor: other, operationActor: actor.id, key: returnKey });
  assert.equal(returnReplay.status, 409, JSON.stringify(returnReplay.body));
  assert.equal(returnReplay.body.code, 'OPERATION_ACTOR_MISMATCH');
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE actor_id=$1 AND key=ANY($2::text[])', [other.id, [purchaseKey, returnKey]])).rowCount, 0);
});

test('Phase3 supplier return rejects a line belonging to a different source purchase', async () => {
  const f = await received(await fixture());
  const other = await received(await fixture());
  const before = await effects(f);
  const beforeOther = await effects(other);
  const response = await post(`/purchases/${f.id}/returns`, returnIntent(other));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
  assert.deepEqual(await effects(other), beforeOther);
});

test('Phase3 unproven legacy receipt cannot authorize supplier returns from today\'s catalog', async () => {
  const f = await fixture();
  const actor = await setupActor();
  const { rows: [purchase] } = await pool.query("INSERT INTO purchases(supplier_id,date,total_amount,created_by) VALUES($1,'2026-01-15',60,$2) RETURNING id", [f.supplier.id, actor.id]);
  const { rows: lines } = await pool.query("INSERT INTO purchase_items(purchase_id,product_id,qty,unit,cost_price,line_total) VALUES($1,$2,2,'piece',30,60) RETURNING *", [purchase.id, f.product.id]);
  const before = await effects(f);
  const response = await post(`/purchases/${purchase.id}/returns`, returnIntent({ ...f, id: purchase.id, lines }));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'PURCHASE_RETURN_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 unlinked historical supplier return requires reconciliation before further writes', async () => {
  const f = await received(await fixture());
  const actor = await setupActor();
  await pool.query(`INSERT INTO purchase_returns(return_no,purchase_id,supplier_id,return_date,total_amount,reason,status,created_by)
    VALUES($1,$2,$3,'2026-01-16',30,'Synthetic historical unlinked return','pending',$4)`, [`LEGACY-${randomUUID().slice(0, 20)}`, f.id, f.supplier.id, actor.id]);
  const before = await effects(f);
  const response = await post(`/purchases/${f.id}/returns`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'PURCHASE_RETURN_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 concurrent same-key purchase requests create exactly one receipt', async () => {
  const f = await fixture();
  const body = receiptIntent(f);
  const key = randomUUID();
  const responses = await concurrentAt('products', f.product.id, [() => post('/purchases', body, { key }), () => post('/purchases', body, { key })]);
  assert.deepEqual(responses.map(response => response.status), [201, 201], JSON.stringify(responses.map(response => response.body)));
  assert.equal(responses[0].body.data.purchase.id, responses[1].body.data.purchase.id);
  const actual = await effects(f);
  assert.equal(actual.purchases, 1);
  assert.equal(actual.stock, '102.000');
  assert.equal(actual.movements, 2);
});

test('Phase3 concurrent full supplier returns serialize source quantity eligibility', async () => {
  const f = await received(await fixture());
  const body = returnIntent(f, 2);
  const responses = await concurrentAt('purchases', f.id, [() => post(`/purchases/${f.id}/returns`, body), () => post(`/purchases/${f.id}/returns`, body)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 422], JSON.stringify(responses.map(response => response.body)));
  const actual = await effects(f);
  assert.equal(actual.returns, 1);
  assert.equal(actual.debit_notes, 1);
  assert.equal(actual.stock, '100.000');
  assert.equal((await pool.query('SELECT qty_returned FROM purchase_items WHERE id=$1', [f.lines[0].id])).rows[0].qty_returned, '2.000');
});

test('Phase3 concurrent same-key supplier returns replay one debit note', async () => {
  const f = await received(await fixture());
  const body = returnIntent(f);
  const key = randomUUID();
  const responses = await concurrentAt('purchases', f.id, [() => post(`/purchases/${f.id}/returns`, body, { key }), () => post(`/purchases/${f.id}/returns`, body, { key })]);
  assert.deepEqual(responses.map(response => response.status), [201, 201], JSON.stringify(responses.map(response => response.body)));
  assert.equal(responses[0].body.data.id, responses[1].body.data.id);
  assert.equal((await effects(f)).debit_notes, 1);
  assert.equal((await effects(f)).stock, '101.000');
});

test('Phase3 supplier return and sale contend on the same stock without allowing negative quantity', async () => {
  const f = await received(await fixture({ current_stock: 0 }));
  const customer = await fixtureCustomer();
  const sale = { customer_id: customer.id, bill_type: 'retail', date: '2026-01-16',
    items: [{ product_id: f.product.id, qty: 2, unit: 'piece', rate: 100 }], payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' } };
  const responses = await concurrentAt('products', f.product.id, [() => post(`/purchases/${f.id}/returns`, returnIntent(f)), () => post('/invoices', sale)]);
  assert.deepEqual(responses.map(response => response.status).sort(), [201, 422], JSON.stringify(responses.map(response => response.body)));
  const { rows: [stock] } = await pool.query(`SELECT p.current_stock,
    (SELECT SUM(qty_in-qty_out) FROM stock_ledger WHERE product_id=p.id)::text AS movements FROM products p WHERE p.id=$1`, [f.product.id]);
  assert.ok(['0.000', '1.000'].includes(stock.current_stock));
  assert.equal(stock.current_stock, stock.movements);
});

test('Phase3 supplier-link insertion failure rolls back receipt, prices, stock and retry reservation', async () => {
  const f = await fixture();
  const suffix = f.supplier.id;
  const before = await effects(f);
  const body = receiptIntent(f, { items: [{ product_id: f.product.id, qty: 2, unit: 'piece', cost_price: 40 }] });
  const key = randomUUID();
  await pool.query(`CREATE FUNCTION phase3_supplier_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.supplier_id=${suffix} THEN RAISE EXCEPTION 'synthetic supplier-link failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER phase3_supplier_failure_${suffix} BEFORE INSERT ON product_suppliers FOR EACH ROW EXECUTE FUNCTION phase3_supplier_failure_${suffix}()`);
  try {
    const response = await post('/purchases', body, { key });
    assert.equal(response.status, 500, JSON.stringify(response.body));
    assert.deepEqual(await effects(f), before);
    assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  } finally {
    await pool.query(`DROP TRIGGER phase3_supplier_failure_${suffix} ON product_suppliers`);
    await pool.query(`DROP FUNCTION phase3_supplier_failure_${suffix}()`);
  }
  await received(f, body, { key });
  assert.equal((await effects(f)).stock, '102.000');
  assert.equal((await effects(f)).cost, '40.00');
});

test('Phase3 debit-note insertion failure rolls back supplier return, counter and stock', async () => {
  const f = await received(await fixture());
  const suffix = f.supplier.id;
  const before = await effects(f);
  const body = returnIntent(f);
  const key = randomUUID();
  await pool.query(`CREATE FUNCTION phase3_debit_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.supplier_id=${suffix} THEN RAISE EXCEPTION 'synthetic debit-note failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER phase3_debit_failure_${suffix} BEFORE INSERT ON supplier_debit_notes FOR EACH ROW EXECUTE FUNCTION phase3_debit_failure_${suffix}()`);
  try {
    const response = await post(`/purchases/${f.id}/returns`, body, { key });
    assert.equal(response.status, 500, JSON.stringify(response.body));
    assert.deepEqual(await effects(f), before);
    assert.equal((await pool.query('SELECT qty_returned FROM purchase_items WHERE id=$1', [f.lines[0].id])).rows[0].qty_returned, '0.000');
    assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  } finally {
    await pool.query(`DROP TRIGGER phase3_debit_failure_${suffix} ON supplier_debit_notes`);
    await pool.query(`DROP FUNCTION phase3_debit_failure_${suffix}()`);
  }
  await returned(f, body, { key });
  assert.equal((await effects(f)).stock, '101.000');
});

test('Phase3 posted receipt and supplier debit evidence cannot be rewritten by application role', async () => {
  const f = await received(await fixture());
  const document = await returned(f);
  const before = await effects(f);
  await assert.rejects(appPool.query('UPDATE purchases SET total_amount=0 WHERE id=$1', [f.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('DELETE FROM purchases WHERE id=$1', [f.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('UPDATE purchase_items SET cost_price=999 WHERE id=$1', [f.lines[0].id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('UPDATE purchase_returns SET total_amount=0 WHERE id=$1', [document.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('UPDATE purchase_return_items SET amount=0 WHERE purchase_return_id=$1', [document.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('UPDATE supplier_debit_notes SET amount=0 WHERE purchase_return_id=$1', [document.id]), /immutable|append.only|permission denied/i);
  await assert.rejects(appPool.query('DELETE FROM supplier_debit_notes WHERE purchase_return_id=$1', [document.id]), /immutable|append.only|permission denied/i);
  assert.deepEqual(await effects(f), before);
});

test('Phase3 supplier return rejects an unrepresentable fractional stock quantity', async () => {
  const f = await fixture();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_purchase_unit,is_sales_unit) VALUES($1,'box',0.5,true,true)", [f.product.id]);
  const original = await received(f, receiptIntent(f, { items: [{ product_id: f.product.id, qty: 2, unit: 'box', cost_price: 100 }] }));
  const before = await effects(f);
  const response = await post(`/purchases/${original.id}/returns`, returnIntent(original, '0.001'));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 receipt rejects inactive supplier and product before stock or price writes', async () => {
  const f = await fixture();
  const before = await effects(f);
  await pool.query('UPDATE suppliers SET is_active=false WHERE id=$1', [f.supplier.id]);
  const supplier = await post('/purchases', receiptIntent(f));
  assert.equal(supplier.status, 422, JSON.stringify(supplier.body));
  await pool.query('UPDATE suppliers SET is_active=true WHERE id=$1', [f.supplier.id]);
  await pool.query('UPDATE products SET is_active=false WHERE id=$1', [f.product.id]);
  const product = await post('/purchases', receiptIntent(f));
  assert.equal(product.status, 422, JSON.stringify(product.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 supplier return rejects inactive source supplier and product', async () => {
  const f = await received(await fixture());
  const before = await effects(f);
  await pool.query('UPDATE suppliers SET is_active=false WHERE id=$1', [f.supplier.id]);
  const supplier = await post(`/purchases/${f.id}/returns`, returnIntent(f));
  assert.equal(supplier.status, 422, JSON.stringify(supplier.body));
  await pool.query('UPDATE suppliers SET is_active=true WHERE id=$1', [f.supplier.id]);
  await pool.query('UPDATE products SET is_active=false WHERE id=$1', [f.product.id]);
  const product = await post(`/purchases/${f.id}/returns`, returnIntent(f));
  assert.equal(product.status, 422, JSON.stringify(product.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 supplier return refuses to reinterpret a changed current base-unit meaning', async () => {
  const f = await received(await fixture());
  await pool.query("UPDATE products SET unit='kg',base_unit='kg' WHERE id=$1", [f.product.id]);
  const before = await effects(f);
  const response = await post(`/purchases/${f.id}/returns`, returnIntent(f));
  assert.equal(response.status, 422, JSON.stringify(response.body));
  assert.equal(response.body.code, 'PURCHASE_RETURN_RECONCILIATION_REQUIRED');
  assert.deepEqual(await effects(f), before);
});

test('Phase3 malformed receipt money and quantities fail without implicit rounding', async () => {
  const f = await fixture();
  const before = await effects(f);
  const invalidMoney = receiptIntent(f);
  invalidMoney.items[0].cost_price = '0.001';
  const money = await post('/purchases', invalidMoney);
  assert.equal(money.status, 422, JSON.stringify(money.body));
  const invalidQuantity = receiptIntent(f);
  invalidQuantity.items[0].qty = '0.0001';
  const quantity = await post('/purchases', invalidQuantity);
  assert.equal(quantity.status, 422, JSON.stringify(quantity.body));
  const date = await post('/purchases', receiptIntent(f, { date: '2026-02-30' }));
  assert.equal(date.status, 422, JSON.stringify(date.body));
  assert.deepEqual(await effects(f), before);
});

test('Phase3 purchase and supplier return require original actor and idempotency key', async () => {
  const f = await fixture();
  const before = await effects(f);
  const missingKey = await post('/purchases', receiptIntent(f), { key: null });
  assert.equal(missingKey.status, 400, JSON.stringify(missingKey.body));
  assert.equal(missingKey.body.code, 'INVALID_IDEMPOTENCY_KEY');
  const missingActor = await post('/purchases', receiptIntent(f), { operationActor: null });
  assert.equal(missingActor.status, 400, JSON.stringify(missingActor.body));
  assert.equal(missingActor.body.code, 'INVALID_OPERATION_ACTOR');
  assert.deepEqual(await effects(f), before);
  const original = await received(f);
  const afterReceipt = await effects(f);
  const missingReturnActor = await post(`/purchases/${original.id}/returns`, returnIntent(original), { operationActor: null });
  assert.equal(missingReturnActor.status, 400, JSON.stringify(missingReturnActor.body));
  assert.equal(missingReturnActor.body.code, 'INVALID_OPERATION_ACTOR');
  assert.deepEqual(await effects(f), afterReceipt);
});

test('Phase3 cashier cannot post a receipt or supplier return with valid financial input', async () => {
  const f = await fixture();
  const actor = await setupActor('cashier');
  const purchase = await post('/purchases', receiptIntent(f), { actor });
  assert.equal(purchase.status, 403, JSON.stringify(purchase.body));
  const original = await received(f);
  const before = await effects(f);
  const key = randomUUID();
  const response = await post(`/purchases/${original.id}/returns`, returnIntent(original), { actor, key });
  assert.equal(response.status, 403, JSON.stringify(response.body));
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
});

test('Phase3 rounded current base cost does not erase the original receipt or supplier refund value', async () => {
  const f = await fixture();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_purchase_unit,is_sales_unit) VALUES($1,'box',10,true,true)", [f.product.id]);
  const original = await received(f, receiptIntent(f, { items: [{ product_id: f.product.id, qty: 1, unit: 'box', cost_price: '0.01' }] }));
  assert.equal((await effects(f)).cost, '0.00');
  assert.equal(original.lines[0].line_total, '0.01');
  const document = await returned(original);
  assert.equal(document.total_amount, '0.01');
  assert.equal((await effects(f)).stock, '100.000');
});

test('Phase3 purchase quote derives selected/base facts without writes and posts the reviewed result', async () => {
  const f = await fixture();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_purchase_unit,is_sales_unit) VALUES($1,'box',10,true,true)", [f.product.id]);
  const body = receiptIntent(f, { items: [{ product_id: f.product.id, qty: 2, unit: 'box', cost_price: 100 }] });
  const before = await effects(f);
  const key = randomUUID();
  const response = await post('/purchases/quote', body, { key });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const quote = response.body.data;
  assert.equal(quote.total_amount, '200.00');
  assert.equal(quote.items[0].base_qty, '20.000');
  assert.equal(quote.items[0].base_cost_price, '10.00');
  assert.match(quote.quote_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  await received(f, { ...body, quote_hash: quote.quote_hash }, { key });
  assert.equal((await effects(f)).stock, '120.000');
});

test('Phase3 stale receipt conversion quote requires review before a changed stock receipt', async () => {
  const f = await fixture();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_purchase_unit,is_sales_unit) VALUES($1,'box',10,true,true)", [f.product.id]);
  const body = receiptIntent(f, { items: [{ product_id: f.product.id, qty: 2, unit: 'box', cost_price: 100 }] });
  const quoted = await post('/purchases/quote', body);
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  await pool.query("UPDATE product_unit_conversions SET conversion_value=20 WHERE product_id=$1 AND unit_name='box'", [f.product.id]);
  const before = await effects(f);
  const key = randomUUID();
  const response = await post('/purchases', { ...body, quote_hash: quoted.body.data.quote_hash }, { key });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'PURCHASE_QUOTE_CHANGED');
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  const reviewed = await post('/purchases/quote', body);
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  await received(f, { ...body, quote_hash: reviewed.body.data.quote_hash }, { key });
  assert.equal((await effects(f)).stock, '140.000');
});

test('Phase3 supplier return quote exposes source eligibility without side effects', async () => {
  const f = await received(await fixture());
  const before = await effects(f);
  const body = returnIntent(f);
  const key = randomUUID();
  const response = await post(`/purchases/${f.id}/returns/quote`, body, { key });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const quote = response.body.data;
  assert.equal(quote.total_amount, '30.00');
  assert.equal(quote.items[0].remaining_qty, '2.000');
  assert.equal(quote.items[0].remaining_qty_after, '1.000');
  assert.equal(quote.items[0].base_qty, '1.000');
  assert.match(quote.quote_hash, /^[a-f0-9]{64}$/);
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  await returned(f, { ...body, quote_hash: quote.quote_hash }, { key });
  assert.equal((await effects(f)).stock, '101.000');
});

test('Phase3 stale supplier-return quote requires review after another return', async () => {
  const f = await received(await fixture());
  const body = returnIntent(f);
  const quoted = await post(`/purchases/${f.id}/returns/quote`, body);
  assert.equal(quoted.status, 200, JSON.stringify(quoted.body));
  await returned(f);
  const before = await effects(f);
  const key = randomUUID();
  const response = await post(`/purchases/${f.id}/returns`, { ...body, quote_hash: quoted.body.data.quote_hash }, { key });
  assert.equal(response.status, 409, JSON.stringify(response.body));
  assert.equal(response.body.code, 'PURCHASE_RETURN_QUOTE_CHANGED');
  assert.deepEqual(await effects(f), before);
  assert.equal((await pool.query('SELECT * FROM idempotency_keys WHERE key=$1', [key])).rowCount, 0);
  const reviewed = await post(`/purchases/${f.id}/returns/quote`, body);
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  await returned(f, { ...body, quote_hash: reviewed.body.data.quote_hash }, { key });
  assert.equal((await effects(f)).stock, '100.000');
});
