// Clean browser books must not inherit deliberately corrupt backend fixtures.
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { mkdtempSync, mkdirSync, lstatSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const path = require('node:path');
const { disposableDatabase } = require('../backend/tests/helpers/disposableDatabase');

async function main() {
  assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true);
  const owner = process.env.FIXTURE_DB_USER || process.env.DB_USER;
  const ownerPassword = process.env.FIXTURE_DB_PASSWORD || process.env.DB_PASSWORD;
  const app = process.env.TEST_APP_DB_USER || process.env.DB_USER;
  const appPassword = process.env.TEST_APP_DB_PASSWORD || process.env.DB_PASSWORD;
  assert.ok(owner && app && ownerPassword && appPassword);
  assert.notEqual(owner, app, 'Browser API and fixture roles must differ');
  const root = process.env.BROWSER_ARTIFACT_ROOT || path.join(tmpdir(), 'hardware-erp-browser-evidence');
  assert.ok(path.isAbsolute(root) && root !== path.parse(root).root);
  mkdirSync(root, { recursive: true, mode: 0o700 });
  assert.ok(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink());
  const artifacts = mkdtempSync(path.join(root, 'run-'));
  const parentDatabase = process.env.DB_NAME;
  Object.assign(process.env, { DB_USER: owner, DB_PASSWORD: ownerPassword, TEST_APP_DB_USER: app });
  const database = await disposableDatabase('browser');
  const env = { ...process.env, DB_NAME: database, DB_USER: app, DB_PASSWORD: appPassword,
    FIXTURE_DB_USER: owner, FIXTURE_DB_PASSWORD: ownerPassword, BROWSER_ARTIFACT_DIR: artifacts };
  writeFileSync(path.join(artifacts, 'run.json'), JSON.stringify({ database, parentDatabase, appRole: app,
    ownerRole: owner, platform: process.platform, node: process.version, argv: process.argv.slice(2) }, null, 2));
  console.log(JSON.stringify({ browserDatabase: database, artifacts, parentDatabaseUntouched: true }));
  delete env.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, ['--test', '--test-concurrency=1', ...process.argv.slice(2)], {
    cwd: path.join(__dirname, '../frontend'), env, stdio: ['ignore', 'pipe', 'pipe'],
  });
  const secrets = [ownerPassword, appPassword, process.env.SESSION_SECRET].filter(Boolean);
  let output = '';
  const print = line => {
    let safe = /cookie|authorization|password|session_secret|(?:fill|type|pressSequentially)\s*\(/i.test(line) ? '[credential-bearing log line omitted]' : line;
    for (const secret of secrets) safe = safe.replaceAll(secret, '[REDACTED]');
    output += safe + '\n'; process.stdout.write(safe + '\n');
  };
  for (const stream of [child.stdout, child.stderr]) {
    let pending = ''; stream.setEncoding('utf8');
    stream.on('data', chunk => { pending += chunk; const lines = pending.split('\n'); pending = lines.pop(); lines.forEach(print); });
    stream.on('end', () => { if (pending) print(pending); });
  }
  child.on('error', error => { print(error.message); process.exitCode = 1; });
  child.on('close', (code, signal) => {
    writeFileSync(path.join(artifacts, 'tests.log'), output);
    writeFileSync(path.join(artifacts, 'result.json'), JSON.stringify({ code, signal }));
    process.exitCode = code === 0 && !signal ? 0 : 1;
  });
  for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, () => child.kill(signal));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
