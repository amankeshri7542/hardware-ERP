const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { Client } = require('pg');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { runMigrations } = require('../../../db/migrations');

let client;
let dir;
before(async () => {
  assert.equal(process.env.NODE_ENV, 'test');
  assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST), 'Only loopback test hosts are allowed');
  assert.match(process.env.DB_NAME || '', /_test$/, 'Only disposable test databases are allowed');
  client = new Client({ host: process.env.DB_HOST, port: process.env.DB_PORT, user: process.env.DB_USER,
    password: process.env.DB_PASSWORD, database: process.env.DB_NAME });
  await client.connect();
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'erp-migration-test-'));
});
after(async () => { await client?.end(); if (dir) await fs.rm(dir, { recursive: true, force: true }); });

test('fresh application, repeat, checksum, failure rollback, lock, populated upgrade and baseline refusal', async () => {
  const schema = `migration_test_${process.pid}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}`);
  try {
    await fs.writeFile(path.join(dir, '001_initial.sql'), 'CREATE TABLE example (id integer PRIMARY KEY, value text);');
    assert.equal(typeof runMigrations, 'function', 'migration runner must apply and record scripts');
    assert.deepEqual(await runMigrations(client, { directory: dir }), ['001']);
    assert.deepEqual(await runMigrations(client, { directory: dir }), []);
    await client.query("INSERT INTO example VALUES (1, 'preserve me')");
    await fs.writeFile(path.join(dir, '002_upgrade.sql'), 'ALTER TABLE example ADD COLUMN active boolean DEFAULT true;');
    assert.deepEqual(await runMigrations(client, { directory: dir }), ['002']);
    assert.deepEqual((await client.query('SELECT * FROM example')).rows, [{ id: 1, value: 'preserve me', active: true }]);
    await fs.writeFile(path.join(dir, '003_failure.sql'), 'CREATE TABLE must_rollback(id integer); SELECT missing_column FROM example;');
    await assert.rejects(runMigrations(client, { directory: dir }), /Migration 003 failed/);
    assert.equal((await client.query("SELECT to_regclass('must_rollback') AS name")).rows[0].name, null);
    assert.equal((await client.query('SELECT count(*)::int AS n FROM schema_migrations')).rows[0].n, 2);
    await fs.unlink(path.join(dir, '003_failure.sql'));
    const contender = new Client(client.connectionParameters);
    await contender.connect();
    try {
      await contender.query(`SET search_path TO ${schema}`);
      await fs.writeFile(path.join(dir, '003_interrupted.sql'), 'CREATE TABLE interrupted(id integer); SELECT pg_sleep(10);');
      const interrupted = assert.rejects(runMigrations(client, { directory: dir }), /Migration 003 failed/);
      let active = false;
      for (let attempt=0; attempt<200; attempt++) {
        const activity = await contender.query('SELECT query,state FROM pg_stat_activity WHERE pid=$1',[client.processID]);
        if (activity.rows[0]?.state === 'active' && activity.rows[0].query.includes('pg_sleep')) { active=true; break; }
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.ok(active, 'first runner reached the interruptible migration');
      await assert.rejects(runMigrations(contender, { directory: dir }), /already running/);
      await contender.query('SELECT pg_cancel_backend($1)',[client.processID]);
      await interrupted;
      assert.equal((await client.query("SELECT to_regclass('interrupted') AS name")).rows[0].name, null);
      await fs.unlink(path.join(dir, '003_interrupted.sql'));
    } finally { await contender.end(); }
    await fs.appendFile(path.join(dir, '001_initial.sql'), '\n-- changed');
    await assert.rejects(runMigrations(client, { directory: dir }), /checksum/);
    const failedCLI = spawnSync(process.execPath, [path.resolve(__dirname, '../../../db/migrations/index.js')],
      { env: { ...process.env, PGOPTIONS: `--search_path=${schema}` }, encoding: 'utf8' });
    assert.equal(failedCLI.status, 1, 'CLI must exit nonzero for checksum/history mismatch');
    await fs.writeFile(path.join(dir, '001_initial.sql'), 'CREATE TABLE example (id integer PRIMARY KEY, value text);');
    const other = new Client(client.connectionParameters);
    await other.connect();
    try {
      await other.query('SELECT pg_advisory_lock(724381, 1)');
      await assert.rejects(runMigrations(client, { directory: dir }), /already running/);
    } finally { await other.end(); }
    assert.deepEqual(await runMigrations(client, { directory: dir }), []);
  } finally { await client.query(`DROP SCHEMA ${schema} CASCADE`); }
  const legacy = `migration_legacy_${process.pid}`;
  await client.query(`CREATE SCHEMA ${legacy}`);
  await client.query(`SET search_path TO ${legacy}`);
  try {
    await client.query('CREATE TABLE existing_business_data(id integer)');
    await assert.rejects(runMigrations(client, { directory: dir }), /untracked schema/);
    assert.equal((await client.query("SELECT to_regclass('schema_migrations') AS name")).rows[0].name, null);
  } finally { await client.query(`DROP SCHEMA ${legacy} CASCADE`); }
});


test('actual historical schema upgrade preserves invoices and append-only ledgers', async () => {
  const schema = `historical_upgrade_${process.pid}`;
  await client.query(`CREATE SCHEMA ${schema}`);
  await client.query(`SET search_path TO ${schema}, public`);
  try {
    assert.equal((await runMigrations(client, { through: '011' })).length, 11);
    const user = (await client.query("INSERT INTO users(name,email,password_hash) VALUES ('Synthetic','migration@example.invalid','test-only-no-login') RETURNING id")).rows[0];
    const product = (await client.query("INSERT INTO products(name, current_stock) VALUES ('Synthetic stock',10) RETURNING id")).rows[0];
    const customer = (await client.query("INSERT INTO customers(name,phone) VALUES ('Synthetic customer','9990000000') RETURNING id")).rows[0];
    const invoice = (await client.query("INSERT INTO invoices(customer_id,bill_type,grand_total,created_by) VALUES ($1,'retail',100,$2) RETURNING id,invoice_no",[customer.id,user.id])).rows[0];
    await client.query("INSERT INTO invoice_items(invoice_id,product_id,product_name_snapshot,qty,unit,rate,base_qty,cost_price_snapshot,taxable_amount,line_total,line_profit) VALUES($1,$2,'Historical product',2,'piece',50,2,30,100,100,40)", [invoice.id, product.id]);
    await client.query("INSERT INTO customer_ledger(customer_id,entry_type,reference_id,reference_type,debit,credit,balance) VALUES ($1,'invoice',$2,'invoice',100,0,100)",[customer.id,invoice.id]);
    await client.query("INSERT INTO stock_ledger(product_id,movement_type,qty_in,qty_out,stock_after,created_by) VALUES ($1,'in',10,0,10,$2)",[product.id,user.id]);
    const snapshots = {};
    for (const table of ['users','products','customers','invoices','invoice_items','customer_ledger','stock_ledger']) snapshots[table] = (await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows;
    assert.deepEqual(await runMigrations(client, { through: '013' }), ['013']);
    for (const [table, rows] of Object.entries(snapshots)) assert.deepEqual((await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows, rows);
    assert.deepEqual(await runMigrations(client, { through: '014' }), ['014']);
    for (const [table, rows] of Object.entries(snapshots)) {
      const expected = table === 'invoices' ? rows.map(row => ({ ...row, notes: null })) : rows;
      assert.deepEqual((await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows, expected);
    }
    assert.deepEqual(await runMigrations(client), ['015']);
    for (const [table, rows] of Object.entries(snapshots)) {
      const expected = table === 'invoices' ? rows.map(row => ({ ...row, notes: null }))
        : table === 'invoice_items' ? rows.map(row => ({ ...row, base_unit_snapshot: null })) : rows;
      assert.deepEqual((await client.query(`SELECT * FROM ${table} ORDER BY id`)).rows, expected);
    }
    await assert.rejects(client.query('UPDATE customer_ledger SET debit=0'), /append.only/i);
    await assert.rejects(client.query('DELETE FROM stock_ledger'), /append.only/i);
    await assert.rejects(client.query('UPDATE products SET current_stock=-1'), /negative|insufficient/i);
    assert.deepEqual(await runMigrations(client), []);
  } finally { await client.query(`DROP SCHEMA ${schema} CASCADE`); }
});
