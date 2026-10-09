const bcrypt = require('bcrypt');
const { randomBytes, createHmac, createHash } = require('node:crypto');
const { pool } = require('../../config/db');
const { validateEnvironment } = require('../../config/env');
const { capabilitiesFor } = require('../../middleware/authorize');
const { sessionSecret, sessionTtlMs } = validateEnvironment();
const DUMMY_HASH = bcrypt.hashSync('unknown-account-timing-check', 12);

async function findUserByEmail(email) {
  const { rows } = await pool.query(
    'SELECT id, name, email, password_hash, role FROM users WHERE email = $1 AND is_active = true', [email]);
  return rows[0] || null;
}

function verifyPassword(plaintext, hash) {
  return bcrypt.compare(plaintext, hash || DUMMY_HASH);
}

function hashPassword(plaintext) {
  return bcrypt.hash(plaintext, 12);
}

function tokenHash(token) {
  if (typeof token !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(token)) return null;
  return createHmac('sha256', sessionSecret).update(token).digest('hex');
}

function passwordFingerprint(passwordHash) {
  return createHash('sha256').update(passwordHash).digest('hex');
}

function publicUser(user) {
  return { id: user.id, name: user.name, role: user.role, capabilities: capabilitiesFor(user.role) };
}

async function createSession(user) {
  const token = randomBytes(32).toString('base64url');
  await pool.query('DELETE FROM auth_sessions WHERE expires_at <= NOW()');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // Match the revocation trigger's lock without granting the application UPDATE on users.
    await client.query('SELECT pg_advisory_xact_lock(73421, $1)', [user.id]);
    const { rowCount } = await client.query(
      `INSERT INTO auth_sessions (token_hash,user_id,password_fingerprint,expires_at)
       SELECT $1, u.id, $2, NOW() + $3 * INTERVAL '1 millisecond'
       FROM users u WHERE u.id = $4 AND u.password_hash = $5 AND u.is_active = true`,
      [tokenHash(token), passwordFingerprint(user.password_hash), sessionTtlMs, user.id, user.password_hash]);
    await client.query('COMMIT');
    return rowCount ? token : null;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

async function findSession(token) {
  const digest = tokenHash(token);
  if (!digest) return null;
  const { rows } = await pool.query(
    `SELECT u.id, u.name, u.role, u.password_hash, s.password_fingerprint
     FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > NOW() AND u.is_active = true`, [digest]);
  const user = rows[0];
  if (!user || passwordFingerprint(user.password_hash) !== user.password_fingerprint) return null;
  return publicUser(user);
}

async function revokeSession(token) {
  const digest = tokenHash(token);
  if (digest) await pool.query('DELETE FROM auth_sessions WHERE token_hash = $1', [digest]);
}

module.exports = { findUserByEmail, verifyPassword, hashPassword, createSession, findSession, revokeSession, publicUser };
