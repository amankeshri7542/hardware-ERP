const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const cookieParser = require('cookie-parser');
const request = require('supertest');
const bcrypt = require('bcrypt');

assert.equal(process.env.NODE_ENV, 'test');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
assert.match(process.env.DB_NAME || '', /_test$/);

const { pool } = require('../../src/config/db');
const app = express();
app.use(express.json(), cookieParser());
app.use('/auth', require('../../src/modules/auth/auth.router'));
app.get('/private', require('../../src/middleware/authenticateJWT'), (_req, res) => res.json({ ok: true }));
after(() => pool.end());

test('logout invalidates the credential already issued to the client', async () => {
  const email = `revocation-${process.pid}@example.invalid`;
  const password = 'Synthetic-test-password-37';
  await pool.query('INSERT INTO users (name,email,password_hash,role) VALUES ($1,$2,$3,$4)',
    ['Synthetic admin', email, await bcrypt.hash(password, 4), 'admin']);
  try {
    const login = await request(app).post('/auth/login').set('Origin', 'http://localhost:5173').send({ email, password });
    assert.equal(login.status, 200);
    const cookies = login.headers['set-cookie'].map((cookie) => cookie.split(';')[0]);
    const credential = login.body.data.accessToken;
    const authenticated = () => {
      const req = request(app).get('/private').set('Cookie', cookies);
      return credential ? req.set('Authorization', `Bearer ${credential}`) : req;
    };
    assert.equal((await authenticated()).status, 200);
    const logout = await request(app).post('/auth/logout').set('Origin', 'http://localhost:5173').set('Cookie', cookies);
    assert.equal(logout.status, 200);
    assert.equal((await authenticated()).status, 401);
  } finally {
    await pool.query('DELETE FROM users WHERE email = $1', [email]);
  }
});
