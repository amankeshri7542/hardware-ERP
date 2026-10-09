const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('../../backend/node_modules/pg');
const { databaseOptions } = require('../../backend/src/config/database');

async function readMigrations(directory = __dirname, through) {
  const names = (await fs.readdir(directory)).filter((name) => /^\d{3}_[a-z0-9_]+\.sql$/.test(name)).sort();
  const migrations = await Promise.all(names.map(async (name) => {
    const sql = await fs.readFile(path.join(directory, name), 'utf8');
    return { id: name.slice(0, 3), name, sql, checksum: crypto.createHash('sha256').update(sql).digest('hex') };
  }));
  if (new Set(migrations.map(({ id }) => id)).size !== migrations.length) throw new Error('Duplicate migration ID');
  if (through && !migrations.some(({ id }) => id === through)) throw new Error('Unknown migration boundary');
  return migrations.filter(({ id }) => !through || id <= through);
}
async function runMigrations(client, { directory = __dirname, through } = {}) {
  const migrations = await readMigrations(directory, through);
  const lock = await client.query('SELECT pg_try_advisory_lock(724381, 1) AS locked');
  if (!lock.rows[0].locked) throw new Error('Migration runner already running');
  try {
    const journal = await client.query("SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = current_schema() AND c.relname = 'schema_migrations'");
    if (!journal.rowCount) {
      const existing = await client.query(`SELECT 1 FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = current_schema() AND c.relkind IN ('r','p','v','m','S','f') LIMIT 1`);
      if (existing.rowCount) throw new Error('Refusing untracked schema; complete read-only baseline verification first');
      await client.query(`CREATE TABLE schema_migrations (
        id text PRIMARY KEY, name text NOT NULL, checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )`);
    }
    const applied = (await client.query('SELECT id, name, checksum FROM schema_migrations ORDER BY id')).rows;
    for (const [index, entry] of applied.entries()) {
      const source = migrations[index];
      if (!source || entry.id !== source.id || entry.name !== source.name || entry.checksum !== source.checksum)
        throw new Error(`Migration history/checksum mismatch at ${entry.id}`);
    }
    const completed = [];
    for (const migration of migrations.slice(applied.length)) {
      // Transaction-control statements would escape the atomic journal write.
      const executable = migration.sql.replace(/--[^\n]*/g, '').replace(/\/\*[\s\S]*?\*\//g, '');
      if (/^\s*(BEGIN|COMMIT|ROLLBACK|START\s+TRANSACTION)\s*;/im.test(executable))
        throw new Error(`Migration ${migration.id} contains transaction control`);
      await client.query('BEGIN');
      try {
        await client.query(migration.sql);
        await client.query('INSERT INTO schema_migrations(id, name, checksum) VALUES ($1,$2,$3)',
          [migration.id, migration.name, migration.checksum]);
        await client.query('COMMIT');
        completed.push(migration.id);
      } catch (error) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${migration.id} failed (${error.code || 'database error'})`);
      }
    }
    return completed;
  } finally { await client.query('SELECT pg_advisory_unlock(724381, 1)'); }
}
async function main() {
  const arg = process.argv[2];
  if (arg && !/^--through=\d{3}$/.test(arg)) throw new Error('Usage: node db/migrations/index.js [--through=NNN]');
  const client = new Client(databaseOptions(process.env, { migration: true }));
  try {
    await client.connect();
    const applied = await runMigrations(client, { through: arg?.slice(10) });
    console.log(`Migrations applied: ${applied.join(', ') || 'none'}`);
  } finally { await client.end(); }
}
if (require.main === module) main().catch((error) => {
  console.error(/^(Migration|Refusing|Invalid|Production|Usage|Unknown|Duplicate)/.test(error.message)
    ? error.message : 'Migration connection failed');
  process.exitCode = 1;
});
module.exports = { readMigrations, runMigrations };
