// Read-only schema comparison. This command never creates or stamps a migration journal.
const { Client } = require('../backend/node_modules/pg');
const { databaseOptions } = require('../backend/src/config/database');
const snapshotQuery = `
WITH objects AS (
 SELECT 'column' kind, c.relname || '.' || a.attname name,
   concat_ws('|',format_type(a.atttypid,a.atttypmod),a.attnotnull,pg_get_expr(d.adbin,d.adrelid)) definition
 FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum
 WHERE n.nspname='public' AND c.relkind IN ('r','p') AND a.attnum>0 AND NOT a.attisdropped AND c.relname<>'schema_migrations'
 UNION ALL SELECT 'constraint', c.relname || '.' || co.conname, pg_get_constraintdef(co.oid)
 FROM pg_constraint co JOIN pg_class c ON c.oid=co.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND c.relname<>'schema_migrations'
 UNION ALL SELECT 'index', c.relname, pg_get_indexdef(i.indexrelid)
 FROM pg_index i JOIN pg_class c ON c.oid=i.indexrelid JOIN pg_class t ON t.oid=i.indrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND t.relname<>'schema_migrations'
 UNION ALL SELECT 'trigger', c.relname || '.' || t.tgname, pg_get_triggerdef(t.oid)
 FROM pg_trigger t JOIN pg_class c ON c.oid=t.tgrelid JOIN pg_namespace n ON n.oid=c.relnamespace
 WHERE n.nspname='public' AND NOT t.tgisinternal
 UNION ALL SELECT 'function', p.proname || '(' || pg_get_function_identity_arguments(p.oid) || ')', pg_get_functiondef(p.oid)
 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
 WHERE n.nspname='public' AND NOT EXISTS(SELECT 1 FROM pg_depend d WHERE d.classid='pg_proc'::regclass AND d.objid=p.oid AND d.deptype='e')
 UNION ALL SELECT 'sequence', c.relname, concat_ws('|',s.seqstart,s.seqincrement,s.seqmax,s.seqmin,s.seqcache,s.seqcycle)
 FROM pg_sequence s JOIN pg_class c ON c.oid=s.seqrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public'
 UNION ALL SELECT 'extension', extname, extversion FROM pg_extension
) SELECT * FROM objects ORDER BY kind,name`;

async function snapshot(options) {
  const client = new Client(options);
  try {
    await client.connect();
    await client.query('BEGIN TRANSACTION READ ONLY');
    const rows = (await client.query(snapshotQuery)).rows;
    await client.query('ROLLBACK');
    return rows;
  } finally { await client.end(); }
}
async function main() {
  const reference = process.env.BASELINE_REFERENCE_DB;
  if (!reference?.endsWith('_test') || reference === process.env.DB_NAME)
    throw new Error('Provide a separate freshly migrated BASELINE_REFERENCE_DB ending in _test');
  const options = databaseOptions();
  const [actual, expected] = await Promise.all([snapshot(options), snapshot({ ...options, database: reference })]);
  const key = (row) => `${row.kind}:${row.name}`;
  const actualMap = new Map(actual.map((row) => [key(row), row.definition]));
  const expectedMap = new Map(expected.map((row) => [key(row), row.definition]));
  const different = [...new Set([...actualMap.keys(), ...expectedMap.keys()])]
    .filter((name) => actualMap.get(name) !== expectedMap.get(name));
  console.log(JSON.stringify({ matched: !different.length, inspectedObjects: actual.length, differentObjects: different }, null, 2));
  if (different.length) process.exitCode = 1;
}
if (require.main === module) main().catch(() => { console.error('Read-only baseline verification failed; review database configuration'); process.exitCode = 1; });
module.exports = { snapshot };
