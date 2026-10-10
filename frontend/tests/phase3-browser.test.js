import { test, observe } from './helpers/browserEvidence.js';
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true, 'Preload the local-only network guard before importing application code');
assert.equal(process.env.NODE_ENV, 'test');
assert.match(process.env.DB_NAME || '', /_test$/);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
assert.notEqual(process.env.DB_USER, process.env.FIXTURE_DB_USER);
assert.ok(process.env.FIXTURE_DB_USER);
const origin = 'http://localhost:5173';
assert.equal(process.env.CORS_ORIGIN, origin);
const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
const express = requireBackend('express');
const bcrypt = requireBackend('bcrypt');
const { Pool } = requireBackend('pg');
const app = requireBackend('./src/app');
const { pool } = requireBackend('./src/config/db');
const fixtures = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.FIXTURE_DB_USER, password: process.env.FIXTURE_DB_PASSWORD });
const run = randomUUID();
const password = `Synthetic-phase3-${run}`;
const email = `phase3-${run}@example.invalid`;
const otherEmail = `phase3-other-${run}@example.invalid`;
let userId, otherUserId, browser, server, sessionNumber = 40;

before(async () => {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  await access(`${dist}/index.html`);
  userId = (await fixtures.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",
    ['Synthetic Phase3 browser', email, await bcrypt.hash(password, 4)])).rows[0].id;
  otherUserId = (await fixtures.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",
    ['Synthetic Phase3 switched account', otherEmail, await bcrypt.hash(password, 4)])).rows[0].id;
  const web = express();
  web.use(app);
  web.use(express.static(dist));
  web.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${dist}/index.html`));
  server = await new Promise((resolve, reject) => {
    const candidate = web.listen(5173, '127.0.0.1', () => resolve(candidate));
    candidate.once('error', reject);
  });
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await fixtures.end();
});

async function seed() {
  const name = `Synthetic Phase3 item ${randomUUID()}`;
  const supplierName = `Synthetic Phase3 supplier ${randomUUID()}`;
  const customerName = `Synthetic Phase3 customer ${randomUUID()}`;
  const product = (await fixtures.query(`INSERT INTO products(name,category,unit,base_unit,mrp,wholesale_price,purchase_price,current_stock,gst_rate)
    VALUES($1,'Synthetic','piece','piece',100,100,10,100,0) RETURNING id`, [name])).rows[0].id;
  await fixtures.query("INSERT INTO stock_ledger(product_id,date,movement_type,reference_type,qty_in,qty_out,stock_after,notes,created_by) VALUES($1,'2026-01-01','in','opening',100,0,100,'Synthetic opening',$2)", [product, userId]);
  await fixtures.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit,is_purchase_unit) VALUES($1,'box',10,true,true)", [product]);
  const supplier = (await fixtures.query('INSERT INTO suppliers(name) VALUES($1) RETURNING id', [supplierName])).rows[0].id;
  const customer = (await fixtures.query("INSERT INTO customers(name,phone,type) VALUES($1,$2,'retail') RETURNING id", [customerName, String(randomInt(1000000000, 9999999999))])).rows[0].id;
  return { name, supplierName, customerName, product, supplier, customer };
}

async function login(page, identity = email) {
  await page.goto(`${origin}/login`);
  await page.getByLabel('Username / Email').fill(identity);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(`${origin}/dashboard`);
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
}

const financialMutation = path => path === '/api/purchases' || path === '/api/products' ||
  /^\/api\/(?:purchases\/\d+\/returns|invoices\/\d+\/return|products\/\d+\/stock-adjustments)$/.test(path);

async function session(t) {
  const attempted = new Set();
  const context = await browser.newContext({ serviceWorkers: 'block', extraHTTPHeaders: { 'X-Forwarded-For': `127.0.0.${++sessionNumber}` } });
  const control = { drop: null, requests: [], catalogRequests: [] };
 const evidence = await observe(t, context, { fixtures, control, secrets: [password] });
  await context.routeWebSocket('**/*', socket => { attempted.add('websocket'); socket.close(); });
  const guardedRequests = new Set();
  await context.route('**/*', route => {
    const pending = (async () => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'data:' || (url.protocol === 'blob:' && url.origin === origin)) return route.continue();
    if (url.origin !== origin) { attempted.add(url.origin); return route.abort('blockedbyclient'); }
    if (request.method() === 'POST' && financialMutation(url.pathname)) {
      control.requests.push({ path: url.pathname, key: request.headers()['idempotency-key'], actor: request.headers()['idempotency-actor'], payload: request.postDataJSON() });
    }
    if (request.method() === 'PUT' && /^\/api\/products\/\d+$/.test(url.pathname)) control.catalogRequests.push(request.postDataJSON());
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    const location = response.headers().location;
    if (location && new URL(location, url).origin !== origin) { attempted.add(new URL(location, url).origin); return route.abort('blockedbyclient'); }
    if (request.method() === 'POST' && url.pathname === control.drop) {
      control.drop = null;
      assert.equal(response.status(), 201, 'Simulate a lost response only after the actual server commit');
      return route.abort('failed');
    }
    return route.fulfill({ response });
    })();
    guardedRequests.add(pending);
    return pending.finally(() => guardedRequests.delete(pending));
  });
  const runtimeErrors = [];
  t.after(async () => { await evidence.finish(async () => { while (guardedRequests.size) await Promise.all([...guardedRequests]); assert.equal(attempted.size, 0, 'No external browser request or WebSocket may be attempted'); assert.deepEqual(runtimeErrors, []); }); });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => runtimeErrors.push(error.message));
  await login(page);
  return { page, context, control };
}

async function api(context, path, payload, actor = userId) {
  const response = await context.request.post(`${origin}/api${path}`, { data: payload,
    headers: { Origin: origin, 'Idempotency-Key': randomUUID(), 'Idempotency-Actor': String(actor) } });
  assert.equal(response.status(), 201, await response.text());
  return (await response.json()).data;
}

async function sourcePurchase(context, f) {
  return api(context, '/purchases', { supplier_id: f.supplier, date: '2026-01-15',
    items: [{ product_id: f.product, qty: '2.000', unit: 'box', cost_price: '100.00' }] });
}

async function sourceSale(context, f) {
  return api(context, '/invoices', { customer_id: f.customer, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: f.product, qty: '2.000', unit: 'box', rate: '100.00' }],
    payment: { amount_paid: '0.00', modes: [], due_date: '2026-02-15' } });
}

async function savedIntent(page, operation, actor = userId) {
  return page.evaluate(({ operation, actor }) => JSON.parse(localStorage.getItem(`hardware-erp-intent-v1:${actor}:${operation}`)), { operation, actor });
}

async function prepareSupplierReturn(page, context, f) {
  const source = await sourcePurchase(context, f);
  await page.goto(`${origin}/purchases/${source.purchase.id}`);
  await page.getByRole('button', { name: 'Create Return', exact: true }).click();
  await page.getByLabel(`Return quantity for line ${source.items[0].id}`, { exact: true }).fill('1');
  await page.getByLabel('Supplier return reason', { exact: true }).fill('Synthetic supplier recovery');
  await page.getByRole('button', { name: 'Review Supplier Return', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Post Return & Create Debit Note', exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Reviewed supplier credit/ })).toContainText('100.00');
  return { operation: 'purchase-return', path: `/api/purchases/${source.purchase.id}/returns`, source, f,
    commit: 'Post Return & Create Debit Note', retry: 'Retry Original Supplier Return', open: 'Recover Saved Supplier Return',
    targetField: 'purchase_id', target: source.purchase.id,
    verify: async () => {
      assert.equal((await fixtures.query('SELECT COUNT(*)::integer AS count FROM purchase_returns WHERE purchase_id=$1', [source.purchase.id])).rows[0].count, 1);
      assert.equal((await fixtures.query('SELECT COUNT(*)::integer AS count FROM supplier_debit_notes WHERE supplier_id=$1', [f.supplier])).rows[0].count, 1);
      assert.equal((await fixtures.query('SELECT current_stock FROM products WHERE id=$1', [f.product])).rows[0].current_stock, '110.000');
    } };
}

async function preparePurchase(page, _context, f) {
  await page.goto(`${origin}/purchases/new`);
  await page.getByRole('combobox', { name: 'Purchase supplier', exact: true }).fill(f.supplierName);
  await page.getByText(f.supplierName, { exact: true }).last().click();
  await page.getByPlaceholder('Search products to add...').fill(f.name);
  await expect(page.locator('.product-search-item').filter({ hasText: f.name })).toBeVisible();
  await page.getByPlaceholder('Search products to add...').press('ArrowDown');
  await page.getByPlaceholder('Search products to add...').press('Enter');
  await page.getByLabel(`Purchase quantity ${f.name}`, { exact: true }).fill('2');
  await page.getByRole('combobox', { name: `Purchase unit ${f.name}`, exact: true }).press('ArrowDown');
  await page.getByText('box', { exact: true }).last().click();
  await page.getByLabel(`Agreed purchase price ${f.name}`, { exact: true }).fill('100');
  await page.getByLabel('Purchase notes', { exact: true }).fill('Synthetic purchase recovery');
  await page.getByRole('button', { name: 'Review Purchase', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm Stock Receipt', exact: true })).toBeVisible();
  await expect(page.getByText(/2.000 box = 20.000 piece/)).toBeVisible();
  return { operation: 'purchase', path: '/api/purchases', f, commit: 'Confirm Stock Receipt', retry: 'Retry Original Purchase',
    targetField: 'supplier_id', target: f.supplier,
    verify: async () => {
      const { rows } = await fixtures.query('SELECT id,total_amount FROM purchases WHERE supplier_id=$1', [f.supplier]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].total_amount, '200.00');
      assert.equal((await fixtures.query('SELECT current_stock,purchase_price FROM products WHERE id=$1', [f.product])).rows[0].current_stock, '120.000');
    } };
}

async function prepareSalesReturn(page, context, f) {
  const source = await sourceSale(context, f);
  await page.goto(`${origin}/invoices/${source.invoice_id}`);
  await page.getByRole('button', { name: /Process Return$/ }).click();
  await page.getByLabel(`Return quantity ${f.name}`, { exact: true }).fill('1');
  await page.getByLabel('Return reason', { exact: true }).fill('Synthetic sales return recovery');
  await page.getByRole('button', { name: 'Review return', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Confirm return', exact: true })).toBeVisible();
  await expect(page.getByText(/1.000 box → 10.000 piece restored/)).toBeVisible();
  return { operation: 'sales-return', path: `/api/invoices/${source.invoice_id}/return`, source, f,
    commit: 'Confirm return', retry: 'Retry saved operation', open: 'Recover sales return', targetField: 'original_invoice_id', target: source.invoice_id,
    verify: async () => {
      const { rows } = await fixtures.query('SELECT id,grand_total FROM invoices WHERE original_invoice_id=$1', [source.invoice_id]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].grand_total, '-100.00');
      assert.equal((await fixtures.query('SELECT current_stock FROM products WHERE id=$1', [f.product])).rows[0].current_stock, '90.000');
      assert.equal((await fixtures.query('SELECT outstanding_balance FROM customers WHERE id=$1', [f.customer])).rows[0].outstanding_balance, '100.00');
    } };
}

async function prepareProductCreate(page, _context, f) {
  const createdName = `${f.name} opening`;
  const sku = `P3-${randomUUID()}`;
  await page.goto(`${origin}/products`);
  await page.getByRole('button', { name: /Add Product$/ }).click();
  await page.getByLabel('Product Name', { exact: true }).fill(createdName);
  await page.getByLabel('Category', { exact: true }).fill('Hardware');
  await page.getByLabel('MRP ₹', { exact: true }).fill('100');
  await page.getByLabel('Wholesale Price ₹', { exact: true }).fill('90');
  await page.getByRole('spinbutton', { name: /^Cost Price ₹/ }).fill('10');
  await page.getByLabel(/^SKU Code/).fill(sku);
  await page.getByRole('spinbutton', { name: /^Opening stock/ }).fill('5');
  return { operation: 'product-create', path: '/api/products', createdName, sku, f,
    commit: 'Create product', retry: 'Retry saved operation', open: 'Recover product creation',
    verify: async () => {
      const { rows } = await fixtures.query('SELECT id,current_stock FROM products WHERE name=$1', [createdName]);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].current_stock, '5.000');
      const { rows: movements } = await fixtures.query('SELECT reference_type,qty_in,qty_out,stock_after,created_by FROM stock_ledger WHERE product_id=$1', [rows[0].id]);
      assert.deepEqual(movements, [{ reference_type: 'opening', qty_in: '5.000', qty_out: '0.000', stock_after: '5.000', created_by: userId }]);
    } };
}

async function prepareStockCount(page, _context, f) {
  await page.goto(`${origin}/products/${f.product}`);
  await page.getByRole('button', { name: 'Count stock', exact: true }).click();
  await page.getByLabel('Counted stock', { exact: true }).fill('90');
  await page.getByLabel('Count reason', { exact: true }).fill('Synthetic physical count');
  return { operation: 'stock-adjustment', path: `/api/products/${f.product}/stock-adjustments`, f,
    commit: 'Confirm stock count', retry: 'Retry saved operation', open: 'Recover stock count', targetField: 'product_id', target: f.product,
    verify: async () => {
      assert.equal((await fixtures.query('SELECT current_stock FROM products WHERE id=$1', [f.product])).rows[0].current_stock, '90.000');
      const { rows } = await fixtures.query("SELECT qty_in,qty_out,stock_after,created_by FROM stock_ledger WHERE product_id=$1 AND reference_type='stock_count'", [f.product]);
      assert.deepEqual(rows, [{ qty_in: '0.000', qty_out: '10.000', stock_after: '90.000', created_by: userId }]);
    } };
}

async function loseAndRecover(page, control, command) {
  control.drop = command.path;
  await page.getByRole('button', { name: command.commit, exact: true }).click();
  await expect(page.getByRole('button', { name: command.retry, exact: true })).toBeVisible();
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('uncertain');
  const original = control.requests[0];
  assert.equal(control.requests.length, 1);
  assert.equal(original.path, command.path);
  const pending = await savedIntent(page, command.operation);
  assert.equal(pending.actorId, userId);
  if (command.targetField) assert.equal(pending.payload[command.targetField], command.target);
  await command.verify();
  await page.reload();
  if (command.open) await page.getByRole('button', { name: command.open, exact: true }).click();
  await expect(page.getByRole('button', { name: command.retry, exact: true })).toBeVisible();
  assert.equal(control.requests.length, 1, 'Reload must not automatically resend a stock mutation');
  await page.getByRole('button', { name: command.retry, exact: true }).click();
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('completed');
  assert.equal(control.requests.length, 2);
  assert.deepEqual(control.requests[1], original);
  await command.verify();
}

async function switchAccount(page, identity) {
  await page.goto(`${origin}/dashboard`);
  await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  await page.getByRole('button', { name: /Logout$/ }).click();
  await page.waitForURL(`${origin}/login`);
  await login(page, identity);
}

async function loseSwitchAndRecover(page, context, control, command) {
  control.drop = command.path;
  await page.getByRole('button', { name: command.commit, exact: true }).click();
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('uncertain');
  const original = control.requests[0];
  const other = await context.newPage();
  other.setDefaultTimeout(12000);
  await switchAccount(other, otherEmail);
  const rejectedResponse = page.waitForResponse(response => new URL(response.url()).pathname === command.path && response.request().method() === 'POST');
  await page.getByRole('button', { name: command.retry, exact: true }).click();
  const rejected = await rejectedResponse;
  assert.equal(rejected.status(), 409);
  assert.equal((await rejected.json()).code, 'OPERATION_ACTOR_MISMATCH');
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('uncertain');
  assert.deepEqual(control.requests[1], original);
  assert.equal((await savedIntent(page, command.operation)).actorId, userId);
  assert.equal(await savedIntent(page, command.operation, otherUserId), null);
  await command.verify();
  await switchAccount(other, email);
  assert.equal(control.requests.length, 2, 'Signing in must not retry a mutation');
  await page.getByRole('button', { name: command.retry, exact: true }).click();
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('completed');
  assert.deepEqual(control.requests[2], original);
  await command.verify();
}

test('Phase3 browser supplier return survives lost committed response, reload and original-key recovery', async t => {
  const f = await seed();
  const { page, context, control } = await session(t);
  const command = await prepareSupplierReturn(page, context, f);
  await loseAndRecover(page, control, command);
});

test('Phase3 browser supplier-return recovery cannot switch to a different authenticated actor', async t => {
  const f = await seed();
  const { page, context, control } = await session(t);
  const command = await prepareSupplierReturn(page, context, f);
  await loseSwitchAndRecover(page, context, control, command);
});

test('Phase3 browser rejected stale supplier return keeps its reason, quantity and source for review', async t => {
  const f = await seed();
  const { page, context, control } = await session(t);
  const command = await prepareSupplierReturn(page, context, f);
  await api(context, `/purchases/${command.source.purchase.id}/returns`, { return_date: '2026-01-16', reason: 'Concurrent synthetic return',
    items: [{ purchase_item_id: command.source.items[0].id, qty_returned: '1.000' }] });
  await page.getByRole('button', { name: command.commit, exact: true }).click();
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('rejected');
  const submitted = await savedIntent(page, command.operation);
  assert.equal(submitted.code, 'PURCHASE_RETURN_QUOTE_CHANGED');
  assert.equal(submitted.payload.purchase_id, command.source.purchase.id);
  assert.equal(submitted.payload.reason, 'Synthetic supplier recovery');
  await page.getByRole('button', { name: 'Edit Rejected Supplier Return', exact: true }).click();
  await expect(page.getByLabel('Supplier return reason', { exact: true })).toHaveValue('Synthetic supplier recovery');
  await expect(page.getByLabel(`Return quantity for line ${command.source.items[0].id}`, { exact: true })).toHaveValue(/^1(?:\.0+)?$/);
  assert.equal(control.requests.length, 1, 'Editing a rejected request must not dispatch it');
  assert.equal((await fixtures.query('SELECT COUNT(*)::integer AS count FROM purchase_returns WHERE purchase_id=$1', [command.target])).rows[0].count, 1);
});

for (const [name, prepare] of [['purchase', preparePurchase], ['sales return', prepareSalesReturn], ['product creation', prepareProductCreate], ['stock count', prepareStockCount]]) {
  test(`Phase3 browser ${name} recovers the same committed operation after lost response and reload`, async t => {
    const f = await seed();
    const { page, context, control } = await session(t);
    const command = await prepare(page, context, f);
    await loseAndRecover(page, control, command);
  });

  test(`Phase3 browser ${name} preserves the original actor across an account-switch recovery`, async t => {
    const f = await seed();
    const { page, context, control } = await session(t);
    const command = await prepare(page, context, f);
    await loseSwitchAndRecover(page, context, control, command);
  });
}

test('Phase3 browser stale purchase quote retains supplier, quantity, agreed price and notes for review', async t => {
  const f = await seed();
  const { page, context, control } = await session(t);
  const command = await preparePurchase(page, context, f);
  await fixtures.query("UPDATE product_unit_conversions SET conversion_value=20 WHERE product_id=$1 AND unit_name='box'", [f.product]);
  await page.getByRole('button', { name: command.commit, exact: true }).click();
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('rejected');
  assert.equal((await savedIntent(page, command.operation)).code, 'PURCHASE_QUOTE_CHANGED');
  await page.getByRole('button', { name: 'Edit Rejected Purchase', exact: true }).click();
  await expect(page.getByLabel(`Purchase quantity ${f.name}`, { exact: true })).toHaveValue(/^2(?:\.0+)?$/);
  await expect(page.getByLabel(`Agreed purchase price ${f.name}`, { exact: true })).toHaveValue(/^100(?:\.0+)?$/);
  await expect(page.getByLabel('Purchase notes', { exact: true })).toHaveValue('Synthetic purchase recovery');
  assert.equal(control.requests.length, 1);
  assert.equal((await fixtures.query('SELECT COUNT(*)::integer AS count FROM purchases WHERE supplier_id=$1', [f.supplier])).rows[0].count, 0);
});

test('Phase3 browser stale sales return retains original line and reason after rejection', async t => {
  const f = await seed();
  const { page, context, control } = await session(t);
  const command = await prepareSalesReturn(page, context, f);
  const { rows: [line] } = await fixtures.query('SELECT id FROM invoice_items WHERE invoice_id=$1', [command.target]);
  await api(context, `/invoices/${command.target}/return`, { return_date: '2026-01-16', reason: 'Concurrent synthetic sale return', disposition: 'sellable',
    items: [{ invoice_item_id: line.id, qty_returned: '1.000' }] });
  await page.getByRole('button', { name: command.commit, exact: true }).click();
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('rejected');
  assert.equal((await savedIntent(page, command.operation)).code, 'RETURN_QUOTE_CHANGED');
  await page.getByRole('button', { name: 'Edit and review', exact: true }).click();
  await expect(page.getByLabel(`Return quantity ${f.name}`, { exact: true })).toHaveValue(/^1(?:\.0+)?$/);
  await expect(page.getByLabel('Return reason', { exact: true })).toHaveValue('Synthetic sales return recovery');
  assert.equal(control.requests.length, 1);
  assert.equal((await fixtures.query('SELECT COUNT(*)::integer AS count FROM invoices WHERE original_invoice_id=$1', [command.target])).rows[0].count, 1);
});

test('Phase3 browser rejected product creation retains its opening count and entered metadata', async t => {
  const f = await seed();
  const { page, context, control } = await session(t);
  const command = await prepareProductCreate(page, context, f);
  await fixtures.query("INSERT INTO products(name,category,unit,sku,current_stock) VALUES($1,'Synthetic','piece',$2,0)", [`Synthetic conflicting SKU ${randomUUID()}`, command.sku]);
  await page.getByRole('button', { name: command.commit, exact: true }).click();
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('rejected');
  assert.equal((await savedIntent(page, command.operation)).code, 'DUPLICATE_SKU');
  await page.getByRole('button', { name: 'Edit and review', exact: true }).click();
  await expect(page.getByLabel('Product Name', { exact: true })).toHaveValue(command.createdName);
  await expect(page.getByLabel(/^SKU Code/)).toHaveValue(command.sku);
  await expect(page.getByRole('spinbutton', { name: /^Opening stock/ })).toHaveValue(/^5(?:\.0+)?$/);
  assert.equal(control.requests.length, 1);
  assert.equal((await fixtures.query('SELECT COUNT(*)::integer AS count FROM products WHERE name=$1', [command.createdName])).rows[0].count, 0);
});

test('Phase3 browser stale stock count preserves its draft and requires a fresh baseline', async t => {
  const f = await seed();
  const { page, context, control } = await session(t);
  const command = await prepareStockCount(page, context, f);
  await api(context, '/purchases', { supplier_id: f.supplier, date: '2026-01-15', items: [{ product_id: f.product, qty: 1, unit: 'piece', cost_price: 10 }] });
  await page.getByRole('button', { name: command.commit, exact: true }).click();
  await expect.poll(async () => (await savedIntent(page, command.operation))?.status).toBe('rejected');
  assert.equal((await savedIntent(page, command.operation)).code, 'STOCK_CHANGED');
  await page.getByRole('button', { name: 'Edit and review', exact: true }).click();
  await expect(page.getByLabel('Counted stock', { exact: true })).toHaveValue(/^90(?:\.0+)?$/);
  await expect(page.getByLabel('Count reason', { exact: true })).toHaveValue('Synthetic physical count');
  await expect(page.getByRole('button', { name: 'Confirm stock count', exact: true })).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Reload product for a new count', exact: true })).toBeVisible();
  assert.equal(control.requests.length, 1);
  assert.equal((await fixtures.query('SELECT current_stock FROM products WHERE id=$1', [f.product])).rows[0].current_stock, '101.000');
  assert.equal((await fixtures.query("SELECT COUNT(*)::integer AS count FROM stock_ledger WHERE product_id=$1 AND reference_type='stock_count'", [f.product])).rows[0].count, 0);
});

test('Phase3 browser product metadata and conversion edits preserve intervening receipt stock and prices', async t => {
  const f = await seed();
  const { page, context, control } = await session(t);
  const { rows: [originalConversion] } = await fixtures.query("SELECT id FROM product_unit_conversions WHERE product_id=$1 AND unit_name='box'", [f.product]);
  await page.goto(`${origin}/products/${f.product}`);
  await page.getByRole('button', { name: /Edit$/ }).click();
  await expect(page.getByLabel('Product Name', { exact: true })).toHaveValue(f.name);
  await expect(page.getByRole('spinbutton', { name: /^Stock \(use Count stock to change\)/ })).toBeDisabled();
  await expect(page.getByText(/Count stock/).last()).toBeVisible();
  await api(context, '/purchases', { supplier_id: f.supplier, date: '2026-01-15', items: [{ product_id: f.product, qty: 1, unit: 'piece', cost_price: 50 }] });
  await page.getByLabel('Product Name', { exact: true }).fill(`${f.name} edited`);
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Reload product and review', exact: true })).toBeVisible();
  assert.equal((await fixtures.query('SELECT current_stock,purchase_price FROM products WHERE id=$1', [f.product])).rows[0].current_stock, '101.000');
  await page.getByRole('button', { name: 'Reload product and review', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: /^Cost Price ₹/ })).toHaveValue(/^50(?:\.0+)?$/);
  await page.getByLabel('Product Name', { exact: true }).fill(`${f.name} edited`);
  await expect(page.getByRole('button', { name: 'Save product', exact: true })).toHaveAttribute('aria-label', 'Save product');
  try { await page.getByRole('button', { name: 'Save product', exact: true }).click(); } catch (error) {
    t.diagnostic(JSON.stringify({ catalogRequests: control.catalogRequests, body: await page.locator('body').innerText(),
      buttons: await page.locator('button').evaluateAll(nodes => nodes.map(node => ({text:node.textContent,html:node.outerHTML,parents:[...function*(item){while(item){yield `${item.tagName}:${item.getAttribute('aria-hidden')}`;item=item.parentElement;}}(node)]}))) }));
    throw error;
  }
  await expect(page.getByRole('dialog', { name: 'Edit Product', exact: true })).toBeHidden();
  const { rows: [product] } = await fixtures.query('SELECT name,current_stock,purchase_price FROM products WHERE id=$1', [f.product]);
  assert.deepEqual(product, { name: `${f.name} edited`, current_stock: '101.000', purchase_price: '50.00' });
  assert.equal(control.catalogRequests.length, 2);
  for (const payload of control.catalogRequests) {
    assert.equal(Object.hasOwn(payload, 'current_stock'), false);
    assert.equal(Object.hasOwn(payload, 'purchase_price'), false);
    assert.equal(Object.hasOwn(payload, 'mrp'), false);
    assert.equal(Object.hasOwn(payload, 'wholesale_price'), false);
    assert.equal(Object.hasOwn(payload, 'conversions'), false, 'Metadata-only edits must not replace a separately loaded conversion set');
  }
  await page.getByRole('button', { name: /Edit$/ }).click();
  await expect(page.getByLabel('Product Name', { exact: true })).toHaveValue(`${f.name} edited`);
  await page.getByRole('switch', { name: /^Purchase unit/ }).click();
  await page.getByRole('button', { name: 'Save product', exact: true }).click();
  await expect(page.getByRole('dialog', { name: 'Edit Product', exact: true })).toBeHidden();
  const { rows: conversions } = await fixtures.query('SELECT id,is_sales_unit,is_purchase_unit FROM product_unit_conversions WHERE product_id=$1', [f.product]);
  assert.deepEqual(conversions, [{ id: originalConversion.id, is_sales_unit: true, is_purchase_unit: false }]);
  assert.equal(control.catalogRequests.length, 3);
  assert.equal(control.catalogRequests[2].conversions[0].is_purchase_unit, false);
});

for (const kind of ['sales-return', 'purchase-return']) {
  test(`Phase3 browser rejected ${kind} recovered on another document keeps its original target until review there`, async t => {
    const f = await seed();
    const otherFixture = await seed();
    const { page, context, control } = await session(t);
    const sales = kind === 'sales-return';
    const command = await (sales ? prepareSalesReturn : prepareSupplierReturn)(page, context, f);
    if (sales) {
      const { rows: [line] } = await fixtures.query('SELECT id FROM invoice_items WHERE invoice_id=$1', [command.target]);
      await api(context, `/invoices/${command.target}/return`, { return_date: '2026-01-16', reason: 'Concurrent return makes quote stale', disposition: 'sellable',
        items: [{ invoice_item_id: line.id, qty_returned: '1.000' }] });
    } else {
      await api(context, `/purchases/${command.target}/returns`, { return_date: '2026-01-16', reason: 'Concurrent return makes quote stale',
        items: [{ purchase_item_id: command.source.items[0].id, qty_returned: '1.000' }] });
    }
    await page.getByRole('button', { name: command.commit, exact: true }).click();
    await expect.poll(async () => (await savedIntent(page, kind))?.status).toBe('rejected');
    const original = await savedIntent(page, kind);
    const other = await (sales ? sourceSale : sourcePurchase)(context, otherFixture);
    const otherId = sales ? other.invoice_id : other.purchase.id;
    const prefix = sales ? '/invoices' : '/purchases';
    await page.goto(`${origin}${prefix}/${otherId}`);
    await page.getByRole('button', { name: command.open, exact: true }).click();
    const originalLink = page.locator(`a[href="${prefix}/${command.target}"]`).last();
    await expect(originalLink).toBeVisible();
    const editName = sales ? 'Edit and review' : 'Edit Rejected Supplier Return';
    const edit = page.getByRole('button', { name: editName, exact: true });
    assert.ok(await edit.count() === 0 || !(await edit.isVisible()) || !(await edit.isEnabled()), 'Editing on a different document must be unavailable');
    assert.equal((await savedIntent(page, kind)).key, original.key);
    assert.equal((await savedIntent(page, kind)).payload[command.targetField], command.target);
    assert.equal(control.requests.length, 1);
    await originalLink.click();
    await page.waitForURL(`${origin}${prefix}/${command.target}`);
    await page.reload();
    await page.getByRole('button', { name: command.open, exact: true }).click();
    await page.getByRole('button', { name: editName, exact: true }).click();
    await expect(page.getByLabel(sales ? 'Return reason' : 'Supplier return reason', { exact: true })).toHaveValue(original.payload.reason);
    const quantityLabel = sales ? `Return quantity ${f.name}` : `Return quantity for line ${command.source.items[0].id}`;
    await expect(page.getByLabel(quantityLabel, { exact: true })).toHaveValue(/^1(?:\.0+)?$/);
    assert.equal(control.requests.length, 1, 'Navigation and draft review cannot post to the other document');
  });
}

test('Phase3 browser invoice return form reads cumulative remaining quantity and previews selected/base units', async t => {
  const f = await seed();
  const { page, context } = await session(t);
  const source = await sourceSale(context, f);
  const { rows: [line] } = await fixtures.query('SELECT id FROM invoice_items WHERE invoice_id=$1', [source.invoice_id]);
  await api(context, `/invoices/${source.invoice_id}/return`, { return_date: '2026-01-16', reason: 'First partial return', disposition: 'sellable',
    items: [{ invoice_item_id: line.id, qty_returned: '1.000' }] });
  await page.goto(`${origin}/invoices/${source.invoice_id}`);
  await page.getByRole('button', { name: /Process Return$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Process Return', exact: true })).toContainText('1.000 box');
  await page.getByLabel(`Return quantity ${f.name}`, { exact: true }).fill('1');
  await page.getByLabel('Return reason', { exact: true }).fill('Final partial return');
  await page.getByRole('button', { name: 'Review return', exact: true }).click();
  await expect(page.getByText(/1.000 box → 10.000 piece restored/)).toBeVisible();
  await expect(page.getByText(/Return credit:/)).toContainText('100.00');
});

test('Phase3 browser supplier return form reads cumulative remaining quantity and original unit cost', async t => {
  const f = await seed();
  const { page, context } = await session(t);
  const source = await sourcePurchase(context, f);
  await api(context, `/purchases/${source.purchase.id}/returns`, { return_date: '2026-01-16', reason: 'First partial supplier return',
    items: [{ purchase_item_id: source.items[0].id, qty_returned: '1.000' }] });
  await page.goto(`${origin}/purchases/${source.purchase.id}`);
  await page.getByRole('button', { name: 'Create Return', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('1.000 box');
  await page.getByLabel(`Return quantity for line ${source.items[0].id}`, { exact: true }).fill('1');
  await page.getByLabel('Supplier return reason', { exact: true }).fill('Final supplier return');
  await page.getByRole('button', { name: 'Review Supplier Return', exact: true }).click();
  await expect(page.getByText(/1.000 box = 10.000 piece removed/)).toBeVisible();
  await expect(page.getByRole('heading', { name: /Reviewed supplier credit/ })).toContainText('100.00');
});
