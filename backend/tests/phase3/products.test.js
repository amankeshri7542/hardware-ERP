const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { app, request, pool, origin, setupActor, post, fixtureProduct, fixtureCustomer, close } = require('../helpers/financial');
const { lockWaiters } = require('../helpers/lockWaiters');
after(close);
async function put(product, body) {
  const actor = await setupActor();
  return request(app).put(`/api/products/${product.id}`).set('Origin', origin).set('Cookie',actor.cookie).send(body);
}
const productData = (extra={}) => ({ name:`Opening-${randomUUID()}`,category:'Synthetic',unit:'piece',
  gst_rate:0,mrp:100,wholesale_price:100,purchase_price:30,current_stock:10,...extra });
async function state(id) {
  return (await pool.query('SELECT * FROM products WHERE id=$1',[id])).rows[0];
}
test('Phase3 product control: metadata name edit preserves current stock', async () => {
  const product = await fixtureProduct();
  assert.equal((await put(product,{name:'Synthetic renamed'})).status,200);
  assert.equal((await state(product.id)).current_stock,'100.000');
});
test('Phase3 product detail returns conversions and their catalog version in one read',async()=>{
  const product=await fixtureProduct();const actor=await setupActor();
  await put(product,{conversions:[{unit_name:'box',conversion_value:10,is_sales_unit:true,is_purchase_unit:true}],expected_catalog_version:'0'});
  const response=await request(app).get(`/api/products/${product.id}`).set('Cookie',actor.cookie);
  assert.equal(response.status,200);assert.equal(response.body.data.catalog_version,'1');
  assert.equal(response.body.data.conversions.length,1);
  assert.equal(response.body.data.conversions[0].conversion_value,'10.0000');
});
test('Phase3 opening stock has one attributable ledger movement and durable creation receipt', async () => {
  const actor = await setupActor();
  const key = randomUUID();
  const payload = productData();
  const response = await post('/products',payload,{key,actor});
  assert.equal(response.status,201,JSON.stringify(response.body));
  const id = response.body.data.id;
  const rows = (await pool.query('SELECT * FROM stock_ledger WHERE product_id=$1',[id])).rows;
  assert.equal(rows.length,1,'New opening stock must have its own ledger movement');
  assert.equal(rows[0].qty_in,'10.000');
  assert.equal(rows[0].stock_after,'10.000');
  assert.equal(rows[0].created_by,actor.id);
  assert.equal(rows[0].reference_type,'opening');
  const retry=await post('/products',payload,{key,actor});
  assert.deepEqual(retry.body,response.body);
});
test('Phase3 stale metadata form cannot restore stock consumed by a sale', async () => {
  const product=await fixtureProduct();
  const customer=await fixtureCustomer();
  const sale=await post('/invoices',{customer_id:customer.id,bill_type:'retail',date:'2026-01-15',
    items:[{product_id:product.id,qty:2,unit:'piece',rate:100}],payment:{amount_paid:0,modes:[],due_date:'2026-02-15'}});
  assert.equal(sale.status,201,JSON.stringify(sale.body));
  const result=await put(product,{name:'Stale form',current_stock:100});
  assert.equal(result.status,422,'Metadata stock field must be explicitly rejected');
  assert.equal(result.body.code,'STOCK_COMMAND_REQUIRED');
  assert.equal((await state(product.id)).current_stock,'98.000');
  assert.equal((await state(product.id)).name,product.name);
});
test('Phase3 base-unit edit cannot reinterpret existing physical stock', async () => {
  const product=await fixtureProduct();
  const response=await put(product,{unit:'box',base_unit:'box'});
  assert.equal(response.status,422);
  assert.equal(response.body.code,'BASE_UNIT_CHANGE_UNSUPPORTED');
  assert.equal((await state(product.id)).unit,'piece');
});
test('Phase3 conversion set updates atomically with explicit usable sales and purchase flags', async () => {
  const product=await fixtureProduct();
  const current=await state(product.id);
  const response=await put(product,{name:'With box',expected_catalog_version:current.catalog_version??'0',
    conversions:[{unit_name:'box',conversion_value:'10.0000',is_sales_unit:true,is_purchase_unit:true}]});
  assert.equal(response.status,200,JSON.stringify(response.body));
  const conversions=(await pool.query('SELECT * FROM product_unit_conversions WHERE product_id=$1',[product.id])).rows;
  assert.equal(conversions.length,1,'Atomic edit must actually save the submitted conversion set');
  assert.equal(conversions[0].is_sales_unit,true);
  assert.equal(conversions[0].is_purchase_unit,true);
  const customer=await fixtureCustomer();
  const quote=await post('/invoices/quote',{customer_id:customer.id,bill_type:'retail',date:'2026-01-15',
    items:[{product_id:product.id,qty:1,unit:'box',rate:100}],payment:{amount_paid:0,modes:[],due_date:'2026-02-15'}});
  assert.equal(quote.status,200,JSON.stringify(quote.body));
  assert.equal(quote.body.data.items[0].base_qty,'10.000');
});
test('Phase3 invalid conversion cannot partially save metadata or delete an existing conversion', async () => {
  const product=await fixtureProduct();
  await pool.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit) VALUES($1,'box',10,true)",[product.id]);
  const current=await state(product.id);
  const response=await put(product,{name:'Must roll back',expected_catalog_version:current.catalog_version??'0',
    conversions:[{unit_name:'box',conversion_value:0,is_sales_unit:true,is_purchase_unit:true}]});
  assert.equal(response.status,422);
  assert.equal((await state(product.id)).name,product.name);
  assert.equal((await pool.query('SELECT conversion_value FROM product_unit_conversions WHERE product_id=$1',[product.id])).rows[0].conversion_value,'10.0000');
});
function countIntent(product,extra={}) {
  return {counted_stock:'90.000',expected_stock:product.current_stock,expected_stock_version:product.stock_version,
    date:'2026-01-16',reason:'Synthetic immediate physical count',...extra};
}
async function count(product,payload=countIntent(product),options) {
  return post(`/products/${product.id}/stock-adjustments`,payload,options);
}
async function assertStock(id) {
  const {rows:[row]}=await pool.query(`SELECT p.current_stock,COALESCE(SUM(l.qty_in-l.qty_out),0) AS ledger
    FROM products p LEFT JOIN stock_ledger l ON l.product_id=p.id WHERE p.id=$1 GROUP BY p.id`,[id]);
  assert.equal(Number(row.current_stock),Number(row.ledger));
  return row.current_stock;
}
async function blockedTogether(product,actions) {
  await setupActor();
  const blocker=await pool.connect();let pending;
  try {
    await blocker.query('BEGIN');await blocker.query('SELECT id FROM products WHERE id=$1 FOR UPDATE',[product.id]);
    const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
    pending=actions.map(action=>action());
    let waiting=0;
    for(let i=0;i<500;i++) {waiting=await lockWaiters(pool,pid);if(waiting>=actions.length) break;await new Promise(resolve=>setTimeout(resolve,10));}
    assert.equal(waiting,actions.length,'Both commands must overlap on the fixture product lock');
  } finally {await blocker.query('ROLLBACK');blocker.release();}
  return Promise.all(pending);
}
test('Phase3 explicit count records a reasoned movement and replays one durable result',async()=>{
  const product=await fixtureProduct();const before=await state(product.id);const key=randomUUID();const payload=countIntent(before);
  const first=await count(before,payload,{key});assert.equal(first.status,201,JSON.stringify(first.body));
  assert.equal(first.body.data.current_stock,'90.000');assert.equal(first.body.data.stock_version,'1');
  const retry=await count(before,payload,{key});assert.deepEqual(retry.body,first.body);
  assert.equal(await assertStock(product.id),'90.000');
  const movements=(await pool.query("SELECT * FROM stock_ledger WHERE product_id=$1 AND reference_type='stock_count'",[product.id])).rows;
  assert.equal(movements.length,1);assert.equal(movements[0].qty_out,'10.000');assert.equal(movements[0].notes,payload.reason);
  const conflict=await count(before,{...payload,counted_stock:80},{key});assert.equal(conflict.status,409);assert.equal(conflict.body.code,'IDEMPOTENCY_CONFLICT');
});
test('Phase3 stale stock version cannot overwrite intervening counts even if stock returns to the same quantity',async()=>{
  const product=await fixtureProduct();const initial=await state(product.id);
  assert.equal((await count(initial)).status,201);
  const next=await state(product.id);assert.equal((await count(next,countIntent(next,{counted_stock:100}))).status,201);
  const stale=await count(initial);assert.equal(stale.status,409);assert.equal(stale.body.code,'STOCK_CHANGED');
  assert.equal(await assertStock(product.id),'100.000');
});
test('Phase3 count rejects missing reason, excessive precision and unproven historical opening',async()=>{
  const product=await fixtureProduct();const current=await state(product.id);
  for(const change of [{reason:''},{counted_stock:'1.0001'},{counted_stock:-1}]) {
    assert.equal((await count(current,countIntent(current,change))).status,422);
  }
  await pool.query('UPDATE products SET current_stock=101 WHERE id=$1',[product.id]);
  const broken=await state(product.id);const response=await count(broken);assert.equal(response.status,422);assert.equal(response.body.code,'STOCK_RECONCILIATION_REQUIRED');
  assert.equal((await state(product.id)).current_stock,'101.000');
});
test('Phase3 opening stock and count cannot be posted under a changed actor or cashier',async()=>{
  const actor=await setupActor();const other=await setupActor('admin','different-stock-actor');const cashier=await setupActor('cashier');
  const product=await fixtureProduct();const current=await state(product.id);
  for(const [path,payload] of [['/products',productData()],[`/products/${product.id}/stock-adjustments`,countIntent(current)]]) {
    const key=randomUUID();const switched=await post(path,payload,{actor:other,operationActor:actor.id,key});
    assert.equal(switched.status,409);assert.equal(switched.body.code,'OPERATION_ACTOR_MISMATCH');
    assert.equal((await post(path,payload,{actor:cashier,key})).status,403);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE key=$1',[key])).rows[0].n,0);
  }
});
test('Phase3 stock command late failure rolls back stock, version, movement and reservation',async()=>{
  const product=await fixtureProduct();const current=await state(product.id);const key=randomUUID();const name=`phase3_stock_fail_${product.id}`;
  await pool.query(`CREATE FUNCTION ${name}() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.product_id=${product.id} THEN RAISE EXCEPTION 'Synthetic stock failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON stock_ledger FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try {
    assert.equal((await count(current,countIntent(current),{key})).status,500);
    assert.deepEqual(await state(product.id),current);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE key=$1',[key])).rows[0].n,0);
  } finally {await pool.query(`DROP TRIGGER ${name} ON stock_ledger`);await pool.query(`DROP FUNCTION ${name}()`);}
  assert.equal((await count(current,countIntent(current),{key})).status,201);await assertStock(product.id);
});
test('Phase3 failed opening movement rolls back new product, price history, conversions and key',async()=>{
  const key=randomUUID();const payload=productData({conversions:[{unit_name:'box',conversion_value:10,is_sales_unit:true,is_purchase_unit:true}]});
  const suffix=randomUUID().replaceAll('-','');const name=`phase3_open_${suffix}`;
  await pool.query(`CREATE FUNCTION ${name}() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.reference_type='opening' AND EXISTS(SELECT 1 FROM products WHERE id=NEW.product_id AND name='${payload.name}') THEN RAISE EXCEPTION 'Synthetic opening failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON stock_ledger FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try {
    assert.equal((await post('/products',payload,{key})).status,500);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM products WHERE name=$1',[payload.name])).rows[0].n,0);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE key=$1',[key])).rows[0].n,0);
  } finally {await pool.query(`DROP TRIGGER ${name} ON stock_ledger`);await pool.query(`DROP FUNCTION ${name}()`);}
  const recovered=await post('/products',payload,{key});assert.equal(recovered.status,201);await assertStock(recovered.body.data.id);
});
test('Phase3 unchanged conversions retain identity; changed or missing flags and stale edits are explicit',async()=>{
  const product=await fixtureProduct();const units=[{unit_name:'box',conversion_value:10,is_sales_unit:true,is_purchase_unit:false}];
  assert.equal((await put(product,{conversions:units,expected_catalog_version:'0'})).status,200);
  const before=(await pool.query('SELECT * FROM product_unit_conversions WHERE product_id=$1',[product.id])).rows;
  assert.equal((await put(product,{name:'New name',conversions:units,expected_catalog_version:'1'})).status,200);
  assert.deepEqual((await pool.query('SELECT * FROM product_unit_conversions WHERE product_id=$1',[product.id])).rows,before);
  const stale=await put(product,{conversions:[],expected_catalog_version:'1'});assert.equal(stale.status,409);assert.equal(stale.body.code,'CATALOG_CHANGED');
  const missing=await put(product,{conversions:[{unit_name:'box',conversion_value:2}],expected_catalog_version:'2'});assert.equal(missing.status,422);assert.equal(missing.body.code,'CONVERSION_FLAGS_REQUIRED');
  const obsolete=await post(`/products/${product.id}/unit-conversions`,units[0]);assert.equal(obsolete.status,422);assert.equal(obsolete.body.code,'ATOMIC_CATALOG_UPDATE_REQUIRED');
});
test('Phase3 two conversion edits contend and exactly one wins the catalog version',async()=>{
  const product=await fixtureProduct();const change=factor=>({expected_catalog_version:'0',conversions:[{unit_name:'box',conversion_value:factor,is_sales_unit:true,is_purchase_unit:true}]});
  const results=await blockedTogether(product,[()=>put(product,change(10)),()=>put(product,change(12))]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);
  assert.equal((await state(product.id)).catalog_version,'1');
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM product_unit_conversions WHERE product_id=$1',[product.id])).rows[0].n,1);
});
test('Phase3 metadata and sale overlap without restoring stock; count versus sale rejects a stale baseline',async()=>{
  const product=await fixtureProduct();const customer=await fixtureCustomer();
  const sell=()=>post('/invoices',{customer_id:customer.id,bill_type:'retail',date:'2026-01-15',items:[{product_id:product.id,qty:2,unit:'piece',rate:100}],payment:{amount_paid:0,modes:[],due_date:'2026-02-15'}});
  const results=await blockedTogether(product,[()=>put(product,{name:'Concurrent metadata'}),sell]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,201]);assert.equal(await assertStock(product.id),'98.000');
  const snapshot=await state(product.id);const overlapping=await blockedTogether(product,[sell,()=>count(snapshot)]);
  assert.equal(overlapping[0].status,201);assert.ok([201,409].includes(overlapping[1].status));
  assert.equal(await assertStock(product.id),overlapping[1].status===201?'88.000':'96.000');
});
test('Phase3 simultaneous same-key stock counts have one durable effect',async()=>{
  const product=await fixtureProduct();const snapshot=await state(product.id);const key=randomUUID();
  const results=await blockedTogether(product,[()=>count(snapshot,countIntent(snapshot),{key}),()=>count(snapshot,countIntent(snapshot),{key})]);
  assert.equal(results[0].status,201);assert.deepEqual(results[0].body,results[1].body);
  assert.equal(await assertStock(product.id),'90.000');assert.equal((await state(product.id)).stock_version,'1');
});
test('Phase3 catalog boundary rejects an overlength barcode before database writes',async()=>{
  const product=await fixtureProduct();const before=await state(product.id);
  const response=await put(product,{barcode:'x'.repeat(51)});
  assert.equal(response.status,422);assert.equal(response.body.code,'INVALID_PRODUCT_TEXT');
  assert.deepEqual(await state(product.id),before);
});
test('Phase3 stale explicit price cannot bypass the catalog version after a purchase changes cost',async()=>{
  const product=await fixtureProduct();
  const supplier=(await pool.query("INSERT INTO suppliers(name) VALUES('Synthetic version supplier') RETURNING id")).rows[0];
  const purchase=await post('/purchases',{supplier_id:supplier.id,date:'2026-01-16',items:[{product_id:product.id,qty:1,unit:'piece',cost_price:45}]});
  assert.equal(purchase.status,201,JSON.stringify(purchase.body));
  const before=await state(product.id);
  const response=await put(product,{purchase_price:30});
  assert.equal(response.status,422);assert.equal(response.body.code,'CATALOG_VERSION_REQUIRED');
  assert.deepEqual(await state(product.id),before);
  assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM product_price_history WHERE product_id=$1',[product.id])).rows[0].n,1);
});
test('Phase3 injected conversion failure preserves the complete prior catalog transaction',async()=>{
  const product=await fixtureProduct();const before=await state(product.id);const name=`phase3_conversion_${product.id}`;
  await pool.query(`CREATE FUNCTION ${name}() RETURNS TRIGGER LANGUAGE plpgsql AS $$ BEGIN IF NEW.product_id=${product.id} THEN RAISE EXCEPTION 'Synthetic conversion failure'; END IF; RETURN NEW; END $$`);
  await pool.query(`CREATE TRIGGER ${name} BEFORE INSERT ON product_unit_conversions FOR EACH ROW EXECUTE FUNCTION ${name}()`);
  try {
    const response=await put(product,{name:'Must not persist',mrp:125,expected_catalog_version:before.catalog_version,
      conversions:[{unit_name:'box',conversion_value:10,is_sales_unit:true,is_purchase_unit:true}]});
    assert.equal(response.status,500);assert.deepEqual(await state(product.id),before);
    assert.equal((await pool.query('SELECT COUNT(*)::int AS n FROM product_price_history WHERE product_id=$1',[product.id])).rows[0].n,0);
  } finally {await pool.query(`DROP TRIGGER ${name} ON product_unit_conversions`);await pool.query(`DROP FUNCTION ${name}()`);}
});
test('Phase3 conversion changes and quotes contend; a stale reviewed invoice cannot post a changed conversion',async()=>{
  const product=await fixtureProduct();const customer=await fixtureCustomer();
  const units=factor=>[{unit_name:'box',conversion_value:factor,is_sales_unit:true,is_purchase_unit:true}];
  assert.equal((await put(product,{conversions:units(10),expected_catalog_version:'0'})).status,200);
  const payload={customer_id:customer.id,bill_type:'retail',date:'2026-01-15',items:[{product_id:product.id,qty:1,unit:'box',rate:100}],payment:{amount_paid:0,modes:[],due_date:'2026-02-15'}};
  const initial=await post('/invoices/quote',payload);assert.equal(initial.status,200);
  const results=await blockedTogether(product,[()=>post('/invoices/quote',payload),()=>put(product,{conversions:units(12),expected_catalog_version:'1'})]);
  assert.deepEqual(results.map(r=>r.status),[200,200]);
  assert.ok(['10.000','12.000'].includes(results[0].body.data.items[0].base_qty));
  const stale=await post('/invoices',{...payload,quote_hash:initial.body.data.quote_hash});
  assert.equal(stale.status,409);assert.equal(stale.body.code,'QUOTE_CHANGED');assert.equal(await assertStock(product.id),'100.000');
});
