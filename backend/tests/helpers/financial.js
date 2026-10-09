const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { Pool } = require('pg');
const bcrypt = require('bcrypt');
const request = require('supertest');

assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true, 'Preload scripts/local-only-network.cjs before test startup');
assert.equal(process.env.NODE_ENV, 'test');
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
assert.match(process.env.DB_NAME || '', /_test$/);
assert.ok(process.env.TEST_APP_DB_USER, 'A restricted test application role is required');
assert.ok(process.env.TEST_APP_DB_PASSWORD, 'The synthetic application role password is required');
assert.notEqual(process.env.DB_USER, process.env.TEST_APP_DB_USER, 'Fixture owner and application roles must differ');
const ownerPool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, ssl: false, max: 6 });
process.env.DB_USER = process.env.TEST_APP_DB_USER;
process.env.DB_PASSWORD = process.env.TEST_APP_DB_PASSWORD;
process.env.CORS_ORIGIN = 'http://localhost:5173';
process.env.TRUST_PROXY = '127.0.0.1/32,::1/128';
const origin = process.env.CORS_ORIGIN;
const app = require('../../src/app');
const { pool: appPool } = require('../../src/config/db');
const run = randomUUID();
const actors = new Map();
let sequence = 0;
async function setupActor(role = 'admin', scope = 'default') {
  const identity = `${role}:${scope}`;
  if (actors.has(identity)) return actors.get(identity);
  const actorIndex = actors.size;
  const pending = (async () => {
    const password = `Synthetic-financial-${run}`;
    const email = `financial-${role}-${actorIndex}-${run}@example.invalid`;
    const { rows: [user] } = await ownerPool.query('INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,$4) RETURNING id', ['Financial fixture', email, await bcrypt.hash(password, 4), role]);
    const ip = `192.0.2.${10 + actorIndex}`;
    const login = await request(app).post('/api/auth/login').set('Origin', origin).set('X-Forwarded-For', ip).send({ email, password });
    assert.equal(login.status, 200, JSON.stringify(login.body));
    return { id: user.id, email, ip, cookie: login.headers['set-cookie'].find(value => value.startsWith('erp_session=')).split(';')[0] };
  })();
  actors.set(identity, pending);
  return pending;
}
async function post(path, body, { actor, key = randomUUID(), operationActor } = {}) {
  actor ||= await setupActor();
  let call = request(app).post(path.startsWith('/api/') ? path : `/api${path}`).set('Origin', origin).set('Cookie', actor.cookie).set('X-Forwarded-For', actor.ip);
  if (key !== null) call = call.set('Idempotency-Key', key);
  if (operationActor !== null) call = call.set('Idempotency-Actor', String(operationActor === undefined ? actor.id : operationActor));
  return call.send(body);
}
async function fixtureCustomer(overrides = {}) {
  const { rows: [{ id }] } = await ownerPool.query("SELECT nextval(pg_get_serial_sequence('customers','id'))::integer AS id");
  const values = { name: `Customer-${run}-${id}`, phone: String(id).padStart(10, '0'), is_active: true, ...overrides };
  const { rows: [customer] } = await ownerPool.query('INSERT INTO customers(id,name,phone,is_active) VALUES($1,$2,$3,$4) RETURNING *', [id, values.name, values.phone, values.is_active]);
  return customer;
}
async function fixtureProduct(overrides = {}) {
  const values = { name: `Product-${run}-${++sequence}`, category: 'Synthetic', unit: 'piece', mrp: 100, wholesale_price: 100, purchase_price: 30, current_stock: 100, gst_rate: 0, hsn_code: '1234', is_active: true, ...overrides };
  const fields = ['name', 'category', 'unit', 'mrp', 'wholesale_price', 'purchase_price', 'current_stock', 'gst_rate', 'hsn_code', 'is_active'];
  for (const optional of ['base_unit']) if (Object.hasOwn(values, optional)) fields.push(optional);
  const client = await ownerPool.connect();
  try {
    await client.query('BEGIN');
    const { rows: [product] } = await client.query(`INSERT INTO products(${fields.join(',')}) VALUES(${fields.map((_, i) => '$' + (i + 1)).join(',')}) RETURNING *`, fields.map(field => values[field]));
    await client.query("INSERT INTO stock_ledger(product_id,date,movement_type,reference_type,qty_in,qty_out,stock_after,notes) VALUES($1,'2026-01-01','in','opening', $2,0,$2,'Synthetic opening stock')", [product.id, values.current_stock]);
    await client.query('COMMIT');
    return product;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function close() {
  for (const pending of actors.values()) {
    const actor = await pending;
    await request(app).post('/api/auth/logout').set('Origin', origin).set('Cookie', actor.cookie).set('X-Forwarded-For', actor.ip);
  }
  await Promise.all([ownerPool.end(), appPool.end()]);
}
module.exports = { app, request, pool: ownerPool, ownerPool, appPool, origin, setupActor, post, fixtureCustomer, fixtureProduct, close };
