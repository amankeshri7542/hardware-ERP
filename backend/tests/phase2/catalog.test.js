const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { setImmediate } = require('node:timers');
const { lockWaiters } = require('../helpers/lockWaiters');
const { app, request, pool, origin, setupActor, fixtureProduct, close } = require('../helpers/financial');
after(close);
async function put(product, body) {
  const actor = await setupActor();
  // Phase 3 makes a reviewed catalog version explicit; retain the price/audit assertions.
  const {rows:[current]}=await pool.query('SELECT catalog_version FROM products WHERE id=$1',[product.id]);
  body={expected_catalog_version:current.catalog_version,...body};
  return request(app).put(`/api/products/${product.id}`).set('Origin', origin).set('Cookie', actor.cookie).set('X-Forwarded-For', actor.ip).send(body);
}
test('explicit catalog price edits retain complete attributed price history', async () => {
  const product = await fixtureProduct();
  const actor = await setupActor();
  await pool.query("INSERT INTO product_price_history(product_id,purchase_price,wholesale_price,mrp,source,changed_by) VALUES($1,30,100,100,'manual',$2)", [product.id, actor.id]);
  const response = await put(product, { mrp: 125 });
  assert.equal(response.status, 200, JSON.stringify(response.body));
  const { rows } = await pool.query('SELECT purchase_price,wholesale_price,mrp,source,changed_by,effective_to FROM product_price_history WHERE product_id=$1 ORDER BY id', [product.id]);
  assert.equal(rows.length, 2, 'Each explicit price change must append one audit record');
  assert.ok(rows[0].effective_to);
  assert.deepEqual(rows[1], { purchase_price: '30.00', wholesale_price: '100.00', mrp: '125.00', source: 'manual', changed_by: actor.id, effective_to: null });
});
test('catalog price update rolls back if its history insertion fails', async () => {
  const product = await fixtureProduct();
  const suffix = product.id;
  await pool.query(`CREATE FUNCTION phase2_catalog_failure_${suffix}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.product_id=${suffix} THEN RAISE EXCEPTION 'synthetic catalog audit failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER phase2_catalog_failure_${suffix} BEFORE INSERT ON product_price_history FOR EACH ROW EXECUTE FUNCTION phase2_catalog_failure_${suffix}()`);
  try {
    const response = await put(product, { mrp: 125, purchase_price: 35 });
    assert.equal(response.status, 500, 'A failed audit insert must abort the product edit');
    const { rows: [saved] } = await pool.query('SELECT mrp,purchase_price FROM products WHERE id=$1', [product.id]);
    assert.deepEqual(saved, { mrp: '100.00', purchase_price: '30.00' });
  } finally {
    await pool.query(`DROP TRIGGER phase2_catalog_failure_${suffix} ON product_price_history`);
    await pool.query(`DROP FUNCTION phase2_catalog_failure_${suffix}()`);
  }
});

test('concurrent catalog edits serialize complete price snapshots and history intervals', async () => {
  const product = await fixtureProduct();
  const actor = await setupActor();
  await pool.query("INSERT INTO product_price_history(product_id,purchase_price,wholesale_price,mrp,source,changed_by) VALUES($1,30,100,100,'manual',$2)", [product.id, actor.id]);
  const blocker = await pool.connect();
  let pending;
  try {
    await blocker.query('BEGIN');
    await blocker.query('SELECT id FROM products WHERE id=$1 FOR UPDATE', [product.id]);
    const blockerPid = (await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending = Promise.all([put(product, { mrp: 125 }), put(product, { wholesale_price: 80 })]);
    const deadline = Date.now() + 5000;
    let waiting = 0;
    while (Date.now() < deadline) {
      waiting = await lockWaiters(pool, blockerPid);
      if (waiting >= 2) break;
      await new Promise(resolve => setImmediate(resolve));
    }
    assert.ok(waiting >= 2, 'Both edits overlap while the product row is locked');
    await blocker.query('COMMIT');
    const results=await pending;
    const changes=[{mrp:125},{wholesale_price:80}];
    assert.equal(results.filter(response=>response.status===200).length,1);
    for (let index=0;index<results.length;index++) {
      const response=results[index];
      if(response.status===409) {
        assert.equal(response.body.code,'CATALOG_CHANGED');
        assert.equal((await put(product,changes[index])).status,200,'A reviewed retry uses the current version');
      } else assert.equal(response.status,200,JSON.stringify(response.body));
    }
  } finally {
    await blocker.query('ROLLBACK'); blocker.release();
    if (pending) await pending;
  }
  const { rows } = await pool.query('SELECT purchase_price,wholesale_price,mrp,effective_from,effective_to,changed_by FROM product_price_history WHERE product_id=$1 ORDER BY id', [product.id]);
  assert.equal(rows.length, 3);
  for (let i = 0; i < 2; i++) {
    assert.ok(rows[i].effective_to >= rows[i].effective_from);
    assert.deepEqual(rows[i].effective_to, rows[i + 1].effective_from);
  }
  assert.equal(rows[2].effective_to, null);
  assert.equal(rows[2].mrp, '125.00');
  assert.equal(rows[2].wholesale_price, '80.00');
  assert.equal(rows[2].purchase_price, '30.00');
  assert.equal(rows[2].changed_by, actor.id);
});
