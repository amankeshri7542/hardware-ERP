const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { app, request, pool, setupActor, post, fixtureCustomer, fixtureProduct, close } = require('../helpers/financial');
after(close);
async function fixture() {
  const product = await fixtureProduct();
  const customer = await fixtureCustomer();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit) VALUES($1,'box',10,true)", [product.id]);
  return { product, intent: { customer_id: customer.id, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: product.id, qty: 2, unit: 'box', rate: 100 }],
    payment: { amount_paid: 0, modes: [], due_date: '2026-02-15' } } };
}
test('authoritative quote labels stock quantity with the current base unit', async () => {
  const f = await fixture();
  const response = await post('/invoices/quote', f.intent);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.items[0].base_qty, '20.000');
  assert.equal(response.body.data.items[0].base_unit, 'piece');
});
test('issued invoice retains the base-unit snapshot after the catalog unit changes', async () => {
  const f = await fixture();
  f.intent.notes = 'Synthetic invoice note retained at issue';
  const issued = await post('/invoices', f.intent);
  assert.equal(issued.status, 201, JSON.stringify(issued.body));
  const invoiceId = issued.body.data.invoice_id;
  await pool.query("UPDATE products SET unit='kg',base_unit='kg' WHERE id=$1", [f.product.id]);
  const actor = await setupActor();
  const response = await request(app).get(`/api/invoices/${invoiceId}`).set('Cookie', actor.cookie).set('X-Forwarded-For', actor.ip);
  assert.equal(response.status, 200, JSON.stringify(response.body));
  assert.equal(response.body.data.items[0].base_qty, '20.000');
  assert.equal(response.body.data.items[0].base_unit_snapshot, 'piece');
  assert.equal(response.body.data.notes, f.intent.notes);
  const { rows: [item] } = await pool.query('SELECT base_unit_snapshot FROM invoice_items WHERE invoice_id=$1', [invoiceId]);
  assert.equal(item.base_unit_snapshot, 'piece');
});
