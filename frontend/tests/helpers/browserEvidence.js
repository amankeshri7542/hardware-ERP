import { test as nodeTest } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, lstat, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const records = new WeakMap();
const sanitizer = fileURLToPath(new URL('../../../scripts/sanitize-browser-trace.py', import.meta.url));
const root = process.env.BROWSER_ARTIFACT_DIR || await mkdtemp(path.join(tmpdir(), 'hardware-browser-evidence-'));
assert.ok(path.isAbsolute(root) && root !== path.parse(root).root);
await mkdir(root, { recursive: true, mode: 0o700 });
assert.ok((await lstat(root)).isDirectory() && !(await lstat(root)).isSymbolicLink());

export function test(name, action) {
  return nodeTest(name, async t => {
    records.set(t, []);
    try { await action(t); }
    catch (error) {
      const captures = await Promise.allSettled(records.get(t).map(record => record.capture(error)));
      const failed = captures.filter(result => result.status === 'rejected').map(result => result.reason);
      if (failed.length) throw new AggregateError([error, ...failed], 'Original test failure and diagnostic failure');
      throw error;
    }
  });
}

// Every download directory belongs to this test; never remove a supplied/shared root.
export async function downloadFile(t, download, name) {
  assert.equal(path.basename(name), name);
  const directory = await mkdtemp(path.join(tmpdir(), 'hardware-browser-download-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const destination = path.join(directory, name);
  await download.saveAs(destination);
  return destination;
}

export async function observe(t, context, { secrets = [], fixtures, control } = {}) {
  const credentials = [...secrets, process.env.SESSION_SECRET, process.env.DB_PASSWORD,
    process.env.FIXTURE_DB_PASSWORD, process.env.TEST_APP_DB_PASSWORD].filter(Boolean);
  const redact = value => {
    let text = String(value);
    for (const secret of credentials) text = text.replaceAll(secret, '[REDACTED]');
    return text.split('\n').map(line => /(?:cookie|authorization|password|session_secret)\s*[:=]/i.test(line)
      ? '[credential-bearing line omitted]' : line).join('\n');
  };
  const timeline = [], consoleMessages = [], requests = new WeakMap();
  let captured = false, tracing = true, sequence = 0;
  await context.tracing.start({ screenshots: false, snapshots: false, sources: false });
  context.on('request', request => {
    const url = new URL(request.url());
    const row = { sequence: ++sequence, at: Date.now(), path: url.pathname, method: request.method(),
      key: request.headers()['idempotency-key'], actor: request.headers()['idempotency-actor'] };
    requests.set(request, row); timeline.push(row);
  });
  context.on('response', response => {
    const row = requests.get(response.request());
    if (row) Object.assign(row, { responseAt: Date.now(), status: response.status(), requestId: response.headers()['x-request-id'] });
  });
  context.on('requestfailed', request => {
    const row = requests.get(request);
    if (row) Object.assign(row, { failedAt: Date.now(), failure: redact(request.failure()?.errorText) });
  });
  const listen = page => {
    page.on('console', message => consoleMessages.push({ at: Date.now(), type: message.type(), text: redact(message.text()) }));
    page.on('pageerror', error => consoleMessages.push({ at: Date.now(), type: 'pageerror', text: redact(error.message) }));
  };
  context.pages().forEach(listen); context.on('page', listen);
  const capture = async error => {
    if (captured) return; // Preserve the first failure before any cleanup changes the scene.
    captured = true;
    const directory = await mkdtemp(path.join(root, 'failure-'));
    const errors = [];
    const attempt = async action => { try { await action(); } catch (failure) { errors.push(redact(failure.message)); } };
    await writeFile(path.join(directory, 'failure.json'), redact(JSON.stringify({ test: t.name,
      error: { name: error.name, message: error.message }, timeline, consoleMessages,
      operations: control?.requests || [] }, null, 2)));
    for (const [index, page] of context.pages().entries()) {
      await attempt(async () => {
        const state = await page.evaluate(() => {
          const body = document.body.cloneNode(true);
          body.querySelectorAll('script,style,input[type=password]').forEach(node => node.remove());
          body.querySelectorAll('input').forEach(node => node.removeAttribute('value'));
          return { path: location.pathname, dom: body.outerHTML,
            intents: Object.fromEntries(Object.keys(localStorage).filter(key => key.startsWith('hardware-erp-intent-v1:')).map(key => [key, JSON.parse(localStorage.getItem(key))])) };
        });
        await writeFile(path.join(directory, `page-${index}.json`), redact(JSON.stringify(state, null, 2)));
        await writeFile(path.join(directory, `page-${index}.aria.txt`), redact(await page.locator('body').ariaSnapshot()));
        await page.screenshot({ path: path.join(directory, `page-${index}.png`), fullPage: true, mask: [page.locator('input[type=password]')] });
      });
    }
    if (fixtures) await attempt(async () => {
      const keys = (control?.requests || []).map(request => request.key).filter(Boolean);
      const operations = (await fixtures.query(`SELECT actor_id,operation,key,request_hash,status_code,
        response_body->'data'->>'id' AS record_id,response_body->'data'->>'invoice_id' AS invoice_id,
        response_body->'data'->'record'->>'id' AS settlement_id FROM idempotency_keys WHERE key=ANY($1::text[])`, [keys])).rows;
      const actors = [...new Set(operations.map(row => row.actor_id))];
      const payments = (await fixtures.query('SELECT id,customer_id,invoice_id,amount,mode,payment_date FROM payments WHERE created_by=ANY($1::int[]) ORDER BY id', [actors])).rows;
      const settlements = (await fixtures.query('SELECT id,kind,source_type,source_id,customer_id,supplier_id,amount,date FROM settlement_events WHERE created_by=ANY($1::int[]) ORDER BY id', [actors])).rows;
      const locks = (await fixtures.query(`SELECT pid,state,wait_event_type,wait_event,pg_blocking_pids(pid) AS blockers
        FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid()`)).rows;
      await writeFile(path.join(directory, 'database.json'), JSON.stringify({ database: process.env.DB_NAME, operations, payments, settlements, locks }, null, 2));
    });
    if (tracing) await attempt(async () => {
      const privateDirectory = await mkdtemp(path.join(tmpdir(), 'hardware-private-trace-'));
      try {
        const raw = path.join(privateDirectory, 'trace.zip');
        await context.tracing.stop({ path: raw }); tracing = false;
        const converted = spawnSync('python3', [sanitizer, raw, path.join(directory, 'trace-timeline.json')], { encoding: 'utf8' });
        assert.equal(converted.status, 0, 'Trace sanitization must succeed before any trace is publishable');
      } finally { await rm(privateDirectory, { recursive: true, force: true }); }
    });
    await writeFile(path.join(directory, 'capture-status.json'), JSON.stringify({ errors }, null, 2));
    console.log(JSON.stringify({ failureArtifacts: directory, test: t.name, diagnosticErrors: errors.length }));
    if (errors.length) throw new Error('Failure evidence is incomplete; see capture-status.json');
  };
  const record = { capture, async finish(drain) {
    try { await drain(); }
    catch (error) {
      try { await capture(error); } catch (failure) { throw new AggregateError([error, failure], 'Original teardown failure and diagnostic failure'); }
      throw error;
    }
    finally { if (tracing) { await context.tracing.stop(); tracing = false; } await context.close(); }
  } };
  records.get(t).push(record);
  return record;
}
