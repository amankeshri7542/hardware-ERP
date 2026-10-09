const { createHash } = require('node:crypto');
const { pool } = require('../config/db');
const { fail } = require('./financial');

function canonical(value) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'number' && Number.isFinite(value)) return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object' && Object.getPrototypeOf(value) === Object.prototype) {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  }
  throw new Error('Idempotency intent must contain only normalized JSON values');
}

async function withIdempotency({ actorId, operation, key, intent }, action) {
  if (typeof key !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) fail('INVALID_IDEMPOTENCY_KEY', 400);
  const hash = createHash('sha256').update(canonical(intent)).digest('hex');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const reservation = await client.query(
      `INSERT INTO idempotency_keys(actor_id,operation,key,request_hash)
       VALUES($1,$2,$3,$4) ON CONFLICT(actor_id,operation,key) DO NOTHING RETURNING key`,
      [actorId, operation, key, hash]);
    if (!reservation.rowCount) {
      // A concurrent insert waits for the owner transaction; no incomplete result is committed by this helper.
      const { rows } = await client.query(
        'SELECT request_hash,status_code,response_body FROM idempotency_keys WHERE actor_id=$1 AND operation=$2 AND key=$3',
        [actorId, operation, key]);
      const previous = rows[0];
      if (!previous || !previous.response_body || !previous.status_code) fail('IDEMPOTENCY_INCOMPLETE', 503);
      if (previous.request_hash !== hash) fail('IDEMPOTENCY_CONFLICT', 409);
      await client.query('COMMIT');
      return { status: previous.status_code, body: previous.response_body, replayed: true };
    }
    await require('./financialPeriod').requireOpenDate(client,
      intent.date ?? intent.return_date ?? intent.payment_date,
      { exclusive: ['finance.day_close', 'finance.day_open'].includes(operation) });
    const result = await action(client);
    if (!Number.isInteger(result?.status) || result.status < 200 || result.status > 299 || !result.body) {
      throw new Error('An idempotent operation must return a successful response');
    }
    const { rows } = await client.query(
      `UPDATE idempotency_keys SET status_code=$4,response_body=$5
       WHERE actor_id=$1 AND operation=$2 AND key=$3 RETURNING status_code,response_body`,
      [actorId, operation, key, result.status, JSON.stringify(result.body)]);
    await client.query('COMMIT');
    return { status: rows[0].status_code, body: rows[0].response_body, replayed: false };
  } catch (error) {
    try { await client.query('ROLLBACK'); } catch { /* A lost connection leaves the outcome unknown to the caller. */ }
    throw error;
  } finally {
    client.release();
  }
}

module.exports = { withIdempotency };
