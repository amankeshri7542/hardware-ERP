const { Pool } = require('pg');
const { databaseOptions } = require('./database');
const pool = new Pool({ ...databaseOptions(), max: 10 });
pool.on('error', () => console.error('[DB] Idle connection failed'));
async function testConnection() {
  try { await pool.query('SELECT 1'); }
  catch { throw new Error('Database connection failed'); }
}
module.exports = { pool, testConnection };
