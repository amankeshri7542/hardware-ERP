const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { Pool } = require('pg');

async function disposableDatabase(label) {
  assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true);
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST));
  assert.match(process.env.DB_NAME, /_test$/);
  assert.match(label, /^[a-z_]+$/);
  const role = process.env.TEST_APP_DB_USER;
  assert.match(role, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
  const name = `hardware_phase4_${label}_${randomBytes(5).toString('hex')}_test`;
  const options = { host:process.env.DB_HOST, port:Number(process.env.DB_PORT), user:process.env.DB_USER,
    password:process.env.DB_PASSWORD, database:process.env.DB_NAME, ssl:false };
  const owner = new Pool(options);
  try { await owner.query(`CREATE DATABASE "${name}"`); } finally { await owner.end(); }
  const root = path.resolve(__dirname,'../../..');
  const run = spawnSync(process.execPath,[path.join(root,'db/migrations/index.js')], {
    cwd:root,env:{...process.env,DB_NAME:name},encoding:'utf8',timeout:60000,
  });
  assert.equal(run.status,0,run.stdout+run.stderr);
  const fresh = new Pool({...options,database:name});
  try {
    const sql = readFileSync(path.join(root,'db/grants.sql'),'utf8')
      .replace(/^\\set[^\n]*\n/gm,'').replaceAll(':"app_role"',`"${role}"`);
    await fresh.query(sql);
    if (process.env.TEST_DOCUMENT_WORKER_USER) {
      assert.match(process.env.TEST_DOCUMENT_WORKER_USER, /^[a-zA-Z_][a-zA-Z0-9_]*$/);
      const workerGrants = readFileSync(path.join(root,'db/document-worker-grants.sql'),'utf8')
        .replace(/^\\set[^\n]*\n/gm,'').replaceAll(':"document_role"',`"${process.env.TEST_DOCUMENT_WORKER_USER}"`);
      await fresh.query(workerGrants);
    }
  } finally { await fresh.end(); }
  process.env.DB_NAME=name;
  return name;
}
module.exports={disposableDatabase};
