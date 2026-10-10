import { test, observe } from './helpers/browserEvidence.js';
import { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true);
assert.equal(process.env.NODE_ENV, 'test');
assert.match(process.env.DB_NAME || '', /_test$/);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
assert.equal(process.env.CORS_ORIGIN, 'http://localhost:5173');
const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
const express = requireBackend('express');
const bcrypt = requireBackend('bcrypt');
const app = requireBackend('./src/app');
const { pool } = requireBackend('./src/config/db');
const { Pool } = requireBackend('pg');
const fixtures = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.FIXTURE_DB_USER || process.env.DB_USER, password: process.env.FIXTURE_DB_PASSWORD || process.env.DB_PASSWORD });
const origin = 'http://localhost:5173';
const run = randomUUID();
const password = `Synthetic-browser-${run}`;
const accounts = {};
let browser;
let server;
let productId;

before(async () => {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  await access(`${dist}/index.html`);
  const hash = await bcrypt.hash(password, 4);
  for (const role of ['admin', 'cashier']) {
    const email = `browser-${role}-${run}@example.invalid`;
    const { rows } = await fixtures.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id', [`Browser ${role}`, email, hash, role]);
    accounts[role] = { id: rows[0].id, email };
  }
  const { rows } = await fixtures.query("INSERT INTO products(name,category,unit,mrp,wholesale_price,purchase_price,current_stock) VALUES($1,'Test','piece',100,80,37,10) RETURNING id", [`Browser catalog ${run}`]);
  productId = rows[0].id;
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
  const ids = Object.values(accounts).map(account => account.id);
  if (ids.length) {
    await fixtures.query('DELETE FROM auth_sessions WHERE user_id=ANY($1::int[])', [ids]);
    await fixtures.query('DELETE FROM users WHERE id=ANY($1::int[])', [ids]);
  }
  if (productId) await fixtures.query('DELETE FROM products WHERE id=$1', [productId]);
  await pool.end();
  await fixtures.end();
});

async function login(t, role = 'admin') {
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const evidence = await observe(t, context, { fixtures, secrets: [password] });
  const blockedOrigins = new Set();
  await context.routeWebSocket('**/*', socket => {
    blockedOrigins.add('websocket');
    socket.close();
  });
  const guardedRequests = new Set();
  await context.route('**/*', route => {
    const pending = (async () => {
    const destination = new URL(route.request().url());
    if (destination.protocol === 'data:' || (destination.protocol === 'blob:' && destination.origin === origin)) return route.continue();
    if (destination.origin !== origin) {
      blockedOrigins.add(destination.origin);
      return route.abort('blockedbyclient');
    }
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    const location = response.headers().location;
    if (location && new URL(location, destination).origin !== origin) {
      blockedOrigins.add(new URL(location, destination).origin);
      return route.abort('blockedbyclient');
    }
    return route.fulfill({ response });
    })();
    guardedRequests.add(pending);
    return pending.finally(() => guardedRequests.delete(pending));
  });
  t.after(async () => { await evidence.finish(async () => { while (guardedRequests.size) await Promise.all([...guardedRequests]); assert.equal(blockedOrigins.size, 0, 'The built frontend must never request a nonlocal origin'); }); });
  const page = await context.newPage();
  page.setDefaultTimeout(10000);
  page.on('pageerror', error => console.error('Browser runtime error:', error.message));
  await page.goto(`${origin}/login`);
  await page.getByLabel('Username / Email').fill(accounts[role].email);
  await page.getByLabel('Password', { exact: true }).fill(password);
  const loginResponse = page.waitForResponse(response => new URL(response.url()).pathname === '/api/auth/login');
  await page.getByRole('button', { name: /sign in/i }).click();
  const response = await loginResponse;
  assert.equal(response.status(), 200, `Browser login failed: ${(await response.json()).code || 'HTTP error'}`);
  await page.waitForURL(`${origin}${role === 'admin' ? '/dashboard' : '/products'}`);
  if(role === 'admin') await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
  return { context, page };
}

test('real login uses an HttpOnly cookie; logout revokes the captured session', async t => {
  const { context, page } = await login(t);
  const cookies = await context.cookies();
  const session = cookies.find(cookie => cookie.name === 'erp_session');
  assert.ok(session, 'The server must issue a session cookie');
  assert.equal(session.httpOnly, true);
  assert.equal(session.sameSite, 'Strict');
  assert.equal(await page.evaluate(() => document.cookie.includes('erp_session')), false);
  assert.equal(await page.evaluate(() => ['erp_token', 'erp_user'].every(key => localStorage.getItem(key) === null)), true, 'No browser-readable authentication state may be retained');
  await page.getByRole('button', { name: /Logout$/ }).click();
  await page.waitForURL(`${origin}/login`);
  const response = await context.request.get(`${origin}/api/auth/session`, { headers: { Cookie: `erp_session=${session.value}` } });
  assert.equal(response.status(), 401, 'A captured cookie cannot bypass server-side logout');
});

test('expiry preserves drafts, avoids a document reload and sends a mutation only once', async t => {
  const { page } = await login(t);
  const requests = [];
  page.on('request', request => {
    if (request.method() === 'POST' && new URL(request.url()).pathname.startsWith('/api/')) requests.push(new URL(request.url()).pathname);
  });
  await page.getByRole('menuitem', { name: /Customers$/ }).click();
  await page.getByRole('button', { name: /add customer/i }).click();
  await page.getByLabel('Name', { exact: true }).fill('Synthetic rejected customer');
  await page.getByLabel('Phone', { exact: true }).fill('0000000001');
  await page.evaluate(() => {
    localStorage.setItem('hardware-erp-billing-draft', 'unrelated-synthetic-draft');
    window.documentLifetimeMarker = 'same-document';
  });
  await fixtures.query("UPDATE auth_sessions SET created_at=NOW()-INTERVAL '9 hours',expires_at=NOW()-INTERVAL '1 minute' WHERE user_id=$1", [accounts.admin.id]);
  await page.getByRole('button', { name: 'OK', exact: true }).click();
  await page.waitForURL(`${origin}/login`);
  await expect(page.getByRole('button', { name: /sign in/i })).toBeVisible();
  assert.deepEqual(requests, ['/api/customers'], 'There must be no automatic refresh or mutation replay');
  assert.equal(await page.evaluate(() => window.documentLifetimeMarker), 'same-document');
  assert.equal(await page.evaluate(() => localStorage.getItem('hardware-erp-billing-draft')), 'unrelated-synthetic-draft');
});

test('cashier sees a working redacted catalog and cannot navigate into billing', async t => {
  const { context, page } = await login(t, 'cashier');
  await expect(page.getByRole('heading', { name: 'Products', exact: true })).toBeVisible();
  await expect(page.getByRole('columnheader', { name: 'Cost', exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Add Product$/ })).toBeHidden();
  await expect(page.getByRole('menuitem', { name: /Billing$/ })).toHaveCount(0);
  const response = await context.request.get(`${origin}/api/products/${productId}`);
  assert.equal(response.status(), 200);
  const product = (await response.json()).data;
  assert.equal(product.name, `Browser catalog ${run}`);
  assert.equal(Object.hasOwn(product, 'purchase_price'), false);
  await page.goto(`${origin}/billing`);
  await expect(page.getByText('This page is unavailable for your account')).toBeVisible();
  const denied = await context.request.post(`${origin}/api/invoices`, { headers: { Origin: origin }, data: {} });
  assert.equal(denied.status(), 403);
});

test('disabled documents are explicit and account disablement invalidates browser navigation', async t => {
  const { page } = await login(t);
  await page.goto(`${origin}/purchases/new`);
  await expect(page.getByText('Supplier attachments remain unavailable. Save the purchase without a file.')).toBeVisible();
  await expect(page.locator('input[type="file"]')).toHaveCount(0);
  await page.goto(`${origin}/reports/sales`);
  await expect(page.getByRole('button', { name: /PDF unavailable$/ })).toBeDisabled();
  await fixtures.query('UPDATE users SET is_active=false WHERE id=$1', [accounts.admin.id]);
  t.after(() => fixtures.query('UPDATE users SET is_active=true WHERE id=$1', [accounts.admin.id]));
  await page.getByRole('menuitem', { name: /Invoices$/ }).click();
  await page.waitForURL(`${origin}/login`);
});
