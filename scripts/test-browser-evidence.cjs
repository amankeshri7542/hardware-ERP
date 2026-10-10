const { test } = require('node:test');
const assert = require('node:assert/strict');
const { mkdtempSync, readdirSync, readFileSync, rmSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true);
test('body, teardown and failed password action publish sanitized evidence through the real runner', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'hardware-evidence-proof-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = { ...process.env, BROWSER_ARTIFACT_ROOT: root };
  delete env.NODE_TEST_CONTEXT;
  const run = spawnSync(process.execPath, ['../scripts/run-browser-tests.cjs', 'tests/fixtures/evidence-failure.mjs'], {
    cwd: path.join(__dirname, '../frontend'), env, encoding: 'utf8',
  });
  assert.equal(run.status, 1, 'Every original deliberate failure must propagate');
  const runs = readdirSync(root);
  assert.equal(runs.length, 1, run.stdout + run.stderr);
  const published = path.join(root, runs[0]);
  const directories = readdirSync(published).filter(name => name.startsWith('failure-'));
  assert.equal(directories.length, 3, run.stdout + run.stderr);
  const messages = [];
  for (const name of directories) {
    const directory = path.join(published, name);
    const names = readdirSync(directory);
    for (const file of ['failure.json', 'page-0.json', 'page-0.aria.txt', 'page-0.png', 'trace-timeline.json', 'capture-status.json']) assert.ok(names.includes(file), file);
    assert.deepEqual(JSON.parse(readFileSync(path.join(directory, 'capture-status.json'))).errors, []);
    messages.push(JSON.parse(readFileSync(path.join(directory, 'failure.json'))).error.message);
    assert.ok(JSON.parse(readFileSync(path.join(directory, 'trace-timeline.json'))).some(event => event.class === 'Frame' && event.method === 'fill'));
    assert.ok(readFileSync(path.join(directory, 'page-0.json'), 'utf8').includes('synthetic-operation-key'));
  }
  assert.ok(messages.includes('synthetic deliberate first failure'));
  assert.ok(messages.includes('synthetic deliberate teardown failure'));
  assert.ok(messages.some(message => message.includes('not editable')));
  const secret = Buffer.from('Synthetic-Credential-Canary-Do-Not-Publish');
  function scan(directory) {
    for (const item of readdirSync(directory, { withFileTypes: true })) {
      const file = path.join(directory, item.name);
      if (item.isDirectory()) scan(file);
      else {
        assert.ok(!item.name.endsWith('.zip'), 'Unrestricted traces must never enter the publishable artifact root');
        assert.ok(!readFileSync(file).includes(secret), file);
      }
    }
  }
  scan(published);
  assert.ok(!Buffer.from(run.stdout + run.stderr).includes(secret), 'Runner output must redact input-action values');
  assert.equal(JSON.parse(readFileSync(path.join(published, 'result.json'))).code, 1);
});
