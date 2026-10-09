import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('authentication never persists a browser-readable credential', async () => {
  const store = await readFile(new URL('../src/store/authStore.js', import.meta.url), 'utf8');
  assert.doesNotMatch(store, /localStorage\.setItem/, 'Authentication must use only the HttpOnly session cookie');
  const client = await readFile(new URL('../src/api/axios.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /headers\.Authorization|Bearer /, 'Legacy bearer tokens must not be sent');
});

test('authentication failure cannot hard-reload drafts or replay a request', async () => {
  const client = await readFile(new URL('../src/api/axios.js', import.meta.url), 'utf8');
  assert.doesNotMatch(client, /window\.location|refreshToken|api\(error\.config\)|_retry/);
});


test('capability navigation defaults to denial and keeps cashiers in the catalog', async () => {
  const { canAccessPath, homePath } = await import('../src/utils/access.js');
  const cashier = { capabilities: ['catalog.read'] };
  assert.equal(homePath(cashier), '/products');
  assert.equal(canAccessPath(cashier, '/products'), true);
  for (const path of ['/billing', '/billing/quick', '/products/1', '/invoices', '/reports', '/settings', '/settlements', '/settlements/customer/1', '/settlements/supplier/1', '/settlements/anonymous', '/settlements/day', '/settlements/reports']) {
    assert.equal(canAccessPath(cashier, path), false, path);
  }
  assert.equal(canAccessPath({ role: 'admin' }, '/billing'), false, 'Role text alone is not a capability');
});

test('session initialization, expiry and logout preserve unrelated drafts and never replay mutations', async () => {
  const { default: store } = await import('../src/store/authStore.js');
  const { default: api } = await import('../src/api/axios.js');
  const saved = new Map([['erp_token', 'legacy-credential'], ['erp_user', '{}'], ['hardware-erp-billing-draft', 'keep-this-draft']]);
  globalThis.localStorage = { removeItem: key => saved.delete(key) };
  const user = { id: 1, name: 'Synthetic', role: 'admin', capabilities: ['dashboard.read'] };
  let calls = 0;
  api.defaults.adapter = async config => { calls++; return { data: { data: { user } }, status: 200, config }; };
  const first = store.getState().initialize();
  const second = store.getState().initialize();
  assert.equal(first, second, 'Concurrent startup must share one session request');
  await first;
  assert.equal(calls, 1);
  assert.equal(store.getState().isAuthenticated, true);
  assert.equal(saved.has('erp_token'), false);
  assert.equal(saved.has('erp_user'), false);
  assert.equal(saved.get('hardware-erp-billing-draft'), 'keep-this-draft');

  calls = 0;
  api.defaults.adapter = async config => {
    calls++;
    throw Object.assign(new Error('Unauthorized'), { config, response: { status: 401 } });
  };
  await assert.rejects(api.post('/invoices', { synthetic: true }));
  assert.equal(calls, 1, 'The failed mutation must never be replayed');
  assert.equal(store.getState().isAuthenticated, false);
  assert.equal(saved.get('hardware-erp-billing-draft'), 'keep-this-draft');

  store.getState().login(user);
  api.defaults.adapter = async () => { throw new Error('Synthetic network failure'); };
  await assert.rejects(store.getState().logout());
  assert.equal(store.getState().isAuthenticated, true, 'A network failure must not claim server logout succeeded');
  api.defaults.adapter = async config => ({ status: 200, data: {}, config });
  await store.getState().logout();
  assert.equal(store.getState().isAuthenticated, false);
  assert.equal(saved.get('hardware-erp-billing-draft'), 'keep-this-draft');
  delete globalThis.localStorage;
});
