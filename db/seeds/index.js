const { Client } = require('../../backend/node_modules/pg');
const bcrypt = require('../../backend/node_modules/bcrypt');
const { databaseOptions } = require('../../backend/src/config/database');
async function seed() {
  if (process.env.NODE_ENV !== 'test' || !process.env.DB_NAME?.endsWith('_test') ||
      !['localhost', '127.0.0.1', 'postgres'].includes(process.env.DB_HOST))
    throw new Error('Synthetic seeds require NODE_ENV=test and an explicit local *_test database');
  const password = process.env.TEST_ADMIN_PASSWORD;
  if (!password || password.length < 12) throw new Error('Provide TEST_ADMIN_PASSWORD with at least 12 characters');
  const client = new Client(databaseOptions(process.env, { migration: true }));
  try {
    await client.connect();
    await client.query('BEGIN');
    await client.query(`INSERT INTO users(name,email,password_hash,role)
      VALUES ('Synthetic test owner','owner@example.invalid',$1,'admin') ON CONFLICT(email) DO NOTHING`,
      [await bcrypt.hash(password, 12)]);
    await client.query(`WITH created AS (INSERT INTO products(name,sku,mrp,wholesale_price,purchase_price,current_stock,unit,base_unit)
      VALUES ('Synthetic bolts','TEST-BOLTS',20,18,10,100,'piece','piece') ON CONFLICT(sku) DO NOTHING RETURNING id)
      INSERT INTO stock_ledger(product_id,movement_type,qty_in,qty_out,stock_after,reference_type)
      SELECT id,'in',100,0,100,'synthetic-opening' FROM created`);
    await client.query('COMMIT');
    console.log('Synthetic test fixtures ready; existing passwords were not changed');
  } catch (error) { await client.query('ROLLBACK').catch(() => {}); throw error; }
  finally { await client.end(); }
}
seed().catch(() => { console.error('Synthetic seeding failed; check test-only configuration'); process.exitCode=1; });
