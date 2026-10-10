import { test, observe, downloadFile } from '../helpers/browserEvidence.js';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { chromium } from '@playwright/test';

assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true);
for (const failure of ['body', 'teardown', 'password action']) test(`synthetic ${failure} failure captures evidence before teardown`, async t => {
  const secret = 'Synthetic-Credential-Canary-Do-Not-Publish';
  const server = createServer((req, res) => {
    if (req.url === '/statement') {
      res.writeHead(200, { 'Content-Type': 'text/csv', 'Content-Disposition': 'attachment; filename=statement.csv' });
      return res.end('balance\n177.00\n');
    }
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.setHeader('Set-Cookie', `canary=${secret}; HttpOnly`);
    res.end('<label>Password<input type="password"></label><button aria-label="Retry saved operation">Retry saved operation</button><a href="/statement" download>Export CSV</a>');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const origin = `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ serviceWorkers: 'block' });
  const evidence = await observe(t, context, { secrets: [secret], control: { requests: [{ path: '/api/payments', key: 'synthetic-operation-key', actor: '7', payload: { customer_id: 9, amount: '177.00' } }] } });
  await context.routeWebSocket('**/*', socket => socket.close());
  await context.route('**/*', async route => {
    assert.equal(new URL(route.request().url()).origin, origin);
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    assert.ok(!response.headers().location);
    await route.fulfill({ response });
  });
  t.after(async () => { try { await evidence.finish(async () => { if (failure === 'teardown') assert.fail('synthetic deliberate teardown failure'); }); } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); } });
  const page = await context.newPage();
  await page.goto(origin);
  await page.getByLabel('Password').fill(secret);
  await page.evaluate(value => {
    console.log(`password: ${value}`);
    localStorage.setItem('hardware-erp-intent-v1:7:payment', JSON.stringify({ key: 'synthetic-operation-key', actorId: 7, status: 'uncertain', payload: { customer_id: 9, amount: '177.00' } }));
  }, secret);
  const [download] = await Promise.all([page.waitForEvent('download'), page.getByText('Export CSV').click()]);
  const file = await downloadFile(t, download, 'statement.csv');
  assert.equal(await readFile(file, 'utf8'), 'balance\n177.00\n');
  if (failure === 'password action') {
    await page.getByLabel('Password').evaluate(input => { input.readOnly = true; });
    await page.getByLabel('Password').fill(secret, { timeout: 500 });
  }
  if (failure === 'body') throw new Error('synthetic deliberate first failure');
});
