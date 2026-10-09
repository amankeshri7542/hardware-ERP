const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');

const { pool, setupActor, post: guardedPost, fixtureProduct, fixtureCustomer, close } = require('../helpers/financial');
let actor;
let sequence = 0;
const run = randomUUID();
before(async () => { actor = await setupActor(); });
after(close);
async function fixture() {
  sequence++;
  return { product: await fixtureProduct(), unrelated: await fixtureProduct(), customerId: (await fixtureCustomer()).id };
}
function payload(f, overrides = {}) {
  return {
    customer_id: f.customerId, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: f.product.id, product_name_snapshot: f.product.name, qty: 2, unit: 'piece', rate: 100, gst_pct: 0, cost_price_snapshot: 30 }],
    payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' }, ...overrides,
  };
}
function post(path, body, key = randomUUID()) {
  return guardedPost(path, body, { actor, key });
}
async function issue(f, body = payload(f)) {
  const result = await post('/invoices', body);
  assert.equal(result.status, 201, `Invoice setup failed with HTTP ${result.status}`);
  return result.body.data.invoice_id;
}
async function stock(id) {
  const { rows } = await pool.query('SELECT current_stock FROM products WHERE id=$1', [id]);
  return Number(rows[0].current_stock);
}
async function originalItem(invoiceId) {
  const { rows } = await pool.query('SELECT id,product_id FROM invoice_items WHERE invoice_id=$1 ORDER BY id', [invoiceId]);
  return { invoice_item_id: rows[0].id, product_id: rows[0].product_id, qty_returned: 2 };
}

test('FIN-01: base quantity must be derived from the sale, never trusted from the client', async () => {
  const f = await fixture();
  const body = payload(f);
  body.items[0].base_qty = 1;
  await issue(f, body);
  assert.equal(await stock(f.product.id), 98, 'Selling two pieces must deduct two pieces despite client base_qty=1');
});

test('FIN-02: cost snapshots must come from the authoritative product cost', async () => {
  const f = await fixture();
  const body = payload(f);
  body.items[0].cost_price_snapshot = 999;
  const id = await issue(f, body);
  const { rows } = await pool.query('SELECT cost_price_snapshot FROM invoice_items WHERE invoice_id=$1', [id]);
  assert.equal(Number(rows[0].cost_price_snapshot), 30, 'Client cost 999 must not replace product cost 30');
});

test('FIN-03: a discount exceeding the item rate is rejected without writes', async () => {
  const f = await fixture();
  const body = payload(f);
  body.items[0].discount_amount = 200;
  const response = await post('/invoices', body);
  assert.equal(response.status, 422, 'Excessive per-unit discount must be a validation error');
  assert.equal(await stock(f.product.id), 100);
});

test('FIN-04: Quick Bill customer receivables must match the customer ledger', async () => {
  const f = await fixture();
  await issue(f, payload(f, { bill_type: 'quickbill' }));
  const { rows } = await pool.query('SELECT outstanding_balance FROM customers WHERE id=$1', [f.customerId]);
  assert.equal(Number(rows[0].outstanding_balance), 200, 'An unpaid customer Quick Bill must debit the customer ledger');
});

test('FIN-05: payment split must equal amount paid before any invoice writes', async () => {
  const f = await fixture();
  const response = await post('/invoices', payload(f, { payment: { amount_paid: 50, modes: [{ mode: 'cash', amount: 5 }, { mode: 'upi', amount: 5 }] } }));
  assert.equal(response.status, 422, 'A split totaling 10 cannot settle an amount_paid of 50');
  assert.equal(await stock(f.product.id), 100);
});

test('FIN-06: duplicate sales-return lines cannot exceed the original quantity', async () => {
  const f = await fixture();
  const id = await issue(f);
  const item = await originalItem(id);
  // New contract fields preserve the original duplicate-line financial assertion.
  const response = await post(`/invoices/${id}/return`, { return_date: '2026-01-16', reason: 'Synthetic return', disposition: 'sellable', items: [item, item] });
  assert.equal(response.status, 422, 'Two duplicate full returns must be rejected atomically');
  assert.equal(response.body.code, 'DUPLICATE_RETURN_ITEM');
  assert.equal(await stock(f.product.id), 98);
});

test('FIN-07: a sales return must bind the product to its original invoice item', async () => {
  const f = await fixture();
  const id = await issue(f);
  const item = { ...await originalItem(id), product_id: f.unrelated.id };
  const response = await post(`/invoices/${id}/return`, { return_date: '2026-01-16', reason: 'Synthetic return', disposition: 'sellable', items: [item] });
  assert.equal(response.status, 422, 'A valid item ID cannot authorize returning another product');
  assert.equal(response.body.code, 'RETURN_PRODUCT_MISMATCH');
  assert.equal(await stock(f.unrelated.id), 100);
});

test('FIN-08: purchase returns must bind quantity and product to the purchase', async () => {
  const f = await fixture();
  const { rows: suppliers } = await pool.query('INSERT INTO suppliers(name) VALUES($1) RETURNING id', [`supplier-${run}-${sequence}`]);
  // Issue a provable source receipt; missing provenance is not proof of FIN-08.
  const issued = await post('/purchases', {supplier_id:suppliers[0].id,date:'2026-01-15',
    items:[{product_id:f.product.id,qty:2,unit:'piece',cost_price:30}]});
  assert.equal(issued.status,201,JSON.stringify(issued.body));
  const purchaseId=issued.body.data.purchase.id;
  const {rows:[line]}=await pool.query('SELECT id FROM purchase_items WHERE purchase_id=$1',[purchaseId]);
  const path=`/purchases/${purchaseId}/returns`;
  const body={return_date:'2026-01-16',reason:'Synthetic supplier return',items:[{purchase_item_id:line.id,product_id:f.unrelated.id,qty_returned:1,cost_price:999}]};
  const missing=await post(path,{...body,items:[{product_id:f.unrelated.id,qty_returned:1,cost_price:999}]});
  assert.equal(missing.status,422);
  const response = await post(path,body);
  assert.equal(response.status, 422, 'An unrelated product with a client-chosen price must not create a supplier debit');
  assert.equal(response.body.code,'PURCHASE_RETURN_PRODUCT_MISMATCH');
  body.items[0].product_id=f.product.id;
  const forgedCost=await post(path,body);
  assert.equal(forgedCost.status,422);
  assert.equal(forgedCost.body.code,'PURCHASE_RETURN_VALUE_MISMATCH');
  assert.equal(await stock(f.unrelated.id), 100);
  assert.equal(await stock(f.product.id),102);
  assert.equal((await pool.query('SELECT COUNT(*)::integer AS n FROM purchase_returns WHERE purchase_id=$1',[purchaseId])).rows[0].n,0);
  body.items[0].cost_price=30;
  const valid=await post(path,body);
  assert.equal(valid.status,201,JSON.stringify(valid.body));
  assert.equal(await stock(f.product.id),101);
});

test('FIN-09: repeating an idempotency key creates exactly one invoice', async () => {
  const f = await fixture();
  const body = payload(f);
  const key = randomUUID();
  const first = await post('/invoices', body, key);
  const second = await post('/invoices', body, key);
  assert.equal(first.status, 201);
  assert.ok([200, 201].includes(second.status));
  assert.equal(second.body.data.invoice_id, first.body.data.invoice_id, 'A repeated key must return the original committed invoice');
  assert.equal(await stock(f.product.id), 98);
});

test('existing negative-stock protection rejects an oversized invoice atomically', async () => {
  const f = await fixture();
  const body = payload(f);
  body.items[0].qty = 101;
  const response = await post('/invoices', body);
  assert.equal(response.status, 422);
  assert.equal(await stock(f.product.id), 100);
});

test('existing append-only customer ledger protection remains active', async () => {
  const f = await fixture();
  const id = await issue(f);
  await assert.rejects(pool.query('UPDATE customer_ledger SET debit=0 WHERE customer_id=$1 AND reference_id=$2', [f.customerId, id]), /append.only|immutable|cannot|not allowed/i);
  const { rows } = await pool.query('SELECT outstanding_balance FROM customers WHERE id=$1', [f.customerId]);
  assert.equal(Number(rows[0].outstanding_balance), 200);
});
