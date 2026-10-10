const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const request = require('supertest');
const {Pool}=require('pg');
const workerPool=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.TEST_DOCUMENT_WORKER_USER,password:process.env.TEST_DOCUMENT_WORKER_PASSWORD,ssl:false});
after(()=>workerPool.end());
const { post, ownerPool: db, appPool, app, fixtureCustomer, fixtureProduct, setupActor, close } = require('../helpers/financial');
after(close);
process.env.DOCUMENT_RUNTIME_MODE = 'synthetic-local';
process.env.DOCUMENT_SELLER_CONFIRMED = 'true';
process.env.STORE_NAME = 'Synthetic Hardware दुकान';
process.env.STORE_ADDRESS = 'Synthetic local address';
process.env.STORE_GSTIN = 'SYNTHETIC-NOT-A-TAX-ID';
async function sale() {
  const customer = await fixtureCustomer(); const product = await fixtureProduct();
  const response = await post('/invoices', { customer_id: customer.id, bill_type: 'retail', date: '2026-07-01', items: [{ product_id: product.id, qty: '1.250', unit: 'piece', rate: '100.00' }], payment: { amount_paid: '25.00', modes: [{ mode: 'cash', amount: '25.00' }], due_date: '2026-07-31' } });
  assert.equal(response.status,201,JSON.stringify(response.body)); return { id:response.body.data.invoice_id, customer, product };
}
const document = id => ({ source_type:'invoice', source_id:id, layout:'a4' });
test('new sale commits one immutable allowlisted document outbox without rendering or duplicate effects',async () => {
  const f=await sale(); const records=await db.query("SELECT * FROM document_sources WHERE source_type='invoice' AND source_id=$1",[f.id]);
  assert.equal(records.rowCount,1); assert.equal(records.rows[0].dto.type,'sale');
  assert.equal(records.rows[0].dto.seller.name,'Synthetic Hardware दुकान');
  const text=JSON.stringify(records.rows[0].dto); for (const forbidden of ['purchase_price','cost_price','profit','notes','session']) assert.equal(text.includes(forbidden),false);
  assert.equal(records.rows[0].dto.totals.find(row=>row.label==='Original sale total').value,'₹ 125.00');
  const key=randomUUID(); const replies=await Promise.all([post('/documents',document(f.id),{key}),post('/documents',document(f.id),{key})]);
  assert.deepEqual(replies.map(r=>r.status),[201,201]); assert.deepEqual(replies[0].body,replies[1].body);
  assert.equal((await db.query('SELECT count(*) FROM document_jobs WHERE source_snapshot_id=$1',[records.rows[0].id])).rows[0].count,'1');
  assert.equal((await post('/documents',{...document(f.id),layout:'thermal80'},{key})).body.code,'IDEMPOTENCY_CONFLICT');
});
test('document reads preserve issuance content after mutable party and settlement changes',async()=>{
  const f=await sale(); const initial=await post('/documents',document(f.id)); assert.equal(initial.status,201);
  await db.query("UPDATE customers SET name='Later current name' WHERE id=$1",[f.customer.id]);
  await post('/payments',{customer_id:f.customer.id,invoice_id:f.id,amount:'100.00',mode:'cash',payment_date:'2026-07-02'});
  const later=await post('/documents',document(f.id)); assert.equal(later.status,201); assert.equal(later.body.data.id,initial.body.data.id); assert.equal(later.body.data.content_hash,initial.body.data.content_hash);
});
test('document actor check and cashier denial precede reservation, and unsupported source creates no job',async()=>{
  const f=await sale(); const admin=await setupActor(); const cashier=await setupActor('cashier'); const key=randomUUID();
  const mismatch=await post('/documents',document(f.id),{key,actor:admin,operationActor:cashier.id});
  assert.equal(mismatch.status,409); assert.equal(mismatch.body.code,'OPERATION_ACTOR_MISMATCH');
  assert.equal((await post('/documents',document(f.id),{actor:cashier})).status,403);
  assert.equal((await post('/documents',{source_type:'purchase',source_id:1,layout:'a4'})).status,422);
  assert.equal((await db.query('SELECT count(*) FROM document_requests WHERE key=$1',[key])).rows[0].count,'0');
  const missing=await request(app).get('/api/documents/00000000-0000-4000-8000-000000000000').set('Cookie',admin.cookie); assert.equal(missing.status,404);
});
test('document jobs fence expired workers and bound attempts without financial mutation',async()=>{
  const jobs=require('../../src/modules/documents/jobs'); const f=await sale(); const job=(await post('/documents',document(f.id))).body.data;
  const claim=await jobs.claim(workerPool,{id:job.id,leaseSeconds:30}); assert.equal(claim.id,job.id);
  await db.query("UPDATE document_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[job.id]);
  const next=await jobs.claim(workerPool,{id:job.id,leaseSeconds:30}); assert.ok(next.lease_token>claim.lease_token);
  const artifact={artifact_key:randomUUID(),artifact_sha256:'a'.repeat(64),artifact_bytes:123};
  assert.equal(await jobs.complete(workerPool,{...claim,...artifact}),false);
  assert.equal(await jobs.complete(workerPool,{...next,...artifact}),true);
  assert.equal(await jobs.complete(workerPool,{...next,...artifact}),false);
  const stored=(await db.query('SELECT amount_paid,balance_due FROM invoices WHERE id=$1',[f.id])).rows[0]; assert.deepEqual(stored,{amount_paid:'25.00',balance_due:'100.00'});
});

test('legacy seller facts stay blocked even when current settings are confirmed; immutable snapshots reject mutation',async()=>{
  const confirmed=process.env.DOCUMENT_SELLER_CONFIRMED; delete process.env.DOCUMENT_SELLER_CONFIRMED;
  let f; try {f=await sale();} finally {process.env.DOCUMENT_SELLER_CONFIRMED=confirmed;}
  const result=await post('/documents',document(f.id)); assert.equal(result.status,201); assert.equal(result.body.data.status,'permanent_failure'); assert.equal(result.body.data.error_code,'DOCUMENT_SELLER_SNAPSHOT_REQUIRED');
  await assert.rejects(appPool.query("UPDATE document_sources SET dto='{}' WHERE source_id=$1",[f.id]));
  await assert.rejects(appPool.query("UPDATE document_jobs SET status='ready' WHERE id=$1",[result.body.data.id]));
  for (const table of ['payments','customer_ledger','auth_sessions','users']) await assert.rejects(workerPool.query(`SELECT * FROM ${table} LIMIT 1`),error=>error.code==='42501');
  await assert.rejects(appPool.query('UPDATE document_jobs SET artifact_key=$1 WHERE id=$2',[randomUUID(),result.body.data.id]),error=>error.code==='42501');
});
test('partial credit notes keep negative values and original seller and issued customer snapshots',async()=>{
  const f=await sale(); const line=(await db.query('SELECT id FROM invoice_items WHERE invoice_id=$1',[f.id])).rows[0];
  const response=await post('/invoices/'+f.id+'/return',{return_date:'2026-07-03',disposition:'sellable',reason:'Synthetic partial return',items:[{invoice_item_id:line.id,qty_returned:'0.250'}]});
  assert.equal(response.status,201,JSON.stringify(response.body));
  const source=(await db.query("SELECT dto FROM document_sources WHERE source_type='invoice' AND source_id=$1",[response.body.data.credit_note_id])).rows[0];
  assert.equal(source.dto.type,'sales_credit'); assert.equal(source.dto.seller.name,'Synthetic Hardware दुकान'); assert.equal(source.dto.totals.at(-1).value,'₹ -25.00');
  assert.equal((await post('/documents',{...document(response.body.data.credit_note_id),layout:'thermal80'})).body.code,'DOCUMENT_LAYOUT_UNSUPPORTED');
});
test('statement captures full filtered history with opening balances, exact money and explicit as-of facts',async()=>{
  const f=await sale(); await post('/payments',{customer_id:f.customer.id,invoice_id:f.id,amount:'10.00',mode:'cash',payment_date:'2026-07-02'});
  const result=await post('/documents',{source_type:'customer_statement',source_id:f.customer.id,layout:'a4',from:'2026-07-02',to:'2026-07-02',as_of:'2026-07-02'});
  assert.equal(result.status,201,JSON.stringify(result.body)); assert.equal(result.body.data.status,'pending');
  const content=(await db.query('SELECT s.dto FROM document_sources s JOIN document_jobs j ON j.source_snapshot_id=s.id WHERE j.id=$1',[result.body.data.id])).rows[0].dto;
  assert.equal(content.rows.length,1); assert.equal(content.totals.find(r=>r.label==='Opening balance').value,'₹ 100.00'); assert.equal(content.totals.find(r=>r.label==='Closing account balance').value,'₹ 90.00');
  assert.equal(content.facts.find(r=>r.label==='As of business date').value,'2026-07-02'); assert.equal(content.rows[0].cells.at(-1),'₹ 90.00');
  assert.equal(content.facts.some(row=>row.label==='Recorded cutoff'),false);assert.ok(content.facts.some(row=>row.label==='Snapshot transaction began'));assert.ok(content.notices.some(text=>text.includes('snapshot established at its first read')));
});
test('source/outbox database failure rolls back a sale; renderer failure never reposts money',async()=>{
  const actor=await setupActor('admin','document-injection'); const customer=await fixtureCustomer();const product=await fixtureProduct();
  const trigger='document_failure_'+randomUUID().replaceAll('-','');
  await db.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.captured_by=${actor.id} THEN RAISE EXCEPTION 'synthetic document write failure'; END IF; RETURN NEW; END $$`);
  await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON document_sources FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
  const key=randomUUID();const body={customer_id:customer.id,bill_type:'retail',date:'2026-07-01',items:[{product_id:product.id,qty:'1',unit:'piece',rate:'100.00'}],payment:{amount_paid:'100.00',modes:[{mode:'cash',amount:'100.00'}]}};
  try {const failed=await post('/invoices',body,{actor,key});assert.equal(failed.status,500);assert.equal((await db.query('SELECT count(*) FROM invoices WHERE customer_id=$1',[customer.id])).rows[0].count,'0');assert.equal((await db.query('SELECT count(*) FROM idempotency_keys WHERE key=$1',[key])).rows[0].count,'0');}
  finally {await db.query(`DROP TRIGGER ${trigger} ON document_sources`);await db.query(`DROP FUNCTION ${trigger}()`);}
  const retry=await post('/invoices',body,{actor,key});assert.equal(retry.status,201,JSON.stringify(retry.body));const id=retry.body.data.invoice_id;
  const requested=await post('/documents',document(id)); const jobs=require('../../src/modules/documents/jobs');
  const result=await jobs.processOne({pool:workerPool,id:requested.body.data.id,render:async()=>{throw Object.assign(new Error('Synthetic outage'),{code:'DOCUMENT_RENDER_TIMEOUT'});},artifacts:{store(){throw new Error('must not reach storage');}}});
  assert.equal(result.status,'failed'); assert.equal((await db.query('SELECT count(*) FROM invoices WHERE customer_id=$1',[customer.id])).rows[0].count,'1');
  const repeat=await post('/invoices',body,{actor,key});assert.deepEqual(repeat.body,retry.body); assert.equal((await db.query('SELECT count(*) FROM payments WHERE invoice_id=$1',[id])).rows[0].count,'1');
  const job=(await db.query('SELECT status,error_code FROM document_jobs WHERE id=$1',[requested.body.data.id])).rows[0];assert.deepEqual(job,{status:'retryable_failure',error_code:'DOCUMENT_RENDER_TIMEOUT'});
});

test('document quantities preserve selected boxes and base pieces, and zero-value sales remain printable',async()=>{
 const product=await fixtureProduct();await db.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit) VALUES($1,'box',12,true)",[product.id]);
 const customer=await fixtureCustomer();
 for(const rate of ['120.00','0.00']) {
  const result=await post('/invoices',{customer_id:customer.id,bill_type:'retail',date:'2026-07-04',items:[{product_id:product.id,qty:'0.500',unit:'box',rate}],payment:{amount_paid:rate==='0.00'?'0.00':'60.00',modes:rate==='0.00'?[]:[{mode:'cash',amount:'60.00'}]}});
  assert.equal(result.status,201,JSON.stringify(result.body));const content=(await db.query("SELECT dto FROM document_sources WHERE source_type='invoice' AND source_id=$1",[result.body.data.invoice_id])).rows[0].dto;
  assert.equal(content.rows[0].cells[1],'0.500 box / 6.000 piece');assert.equal(content.rows[0].cells[2],'₹ '+rate);assert.equal(content.totals.at(-1).value,rate==='0.00'?'₹ 0.00':'₹ 60.00');
 }
});
test('failure while adding the second outbox write rolls back source and business effects',async()=>{
 const actor=await setupActor('admin','document-job-injection');const customer=await fixtureCustomer();const product=await fixtureProduct();const trigger='document_job_fail_'+randomUUID().replaceAll('-','');
 await db.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF EXISTS(SELECT 1 FROM document_sources WHERE id=NEW.source_snapshot_id AND captured_by=${actor.id}) THEN RAISE EXCEPTION 'synthetic outbox job failure'; END IF; RETURN NEW; END $$`);await db.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON document_jobs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
 const key=randomUUID();const body={customer_id:customer.id,bill_type:'retail',date:'2026-07-04',items:[{product_id:product.id,qty:'1',unit:'piece',rate:'100.00'}],payment:{amount_paid:'100.00',modes:[{mode:'cash',amount:'100.00'}]}};
 try {const failed=await post('/invoices',body,{actor,key});assert.equal(failed.status,500);for(const table of ['invoices','payments','customer_ledger'])assert.equal((await db.query(`SELECT count(*) FROM ${table} WHERE customer_id=$1`,[customer.id])).rows[0].count,'0');assert.equal((await db.query('SELECT count(*) FROM document_sources WHERE captured_by=$1',[actor.id])).rows[0].count,'0');assert.equal((await db.query('SELECT current_stock FROM products WHERE id=$1',[product.id])).rows[0].current_stock,'100.000');}
 finally{await db.query(`DROP TRIGGER ${trigger} ON document_jobs`);await db.query(`DROP FUNCTION ${trigger}()`);}
 assert.equal((await post('/invoices',body,{actor,key})).status,201);
});

test('oversized immutable DTO becomes a permanent document failure without cancelling a valid zero-value sale',async()=>{
 const customer=await fixtureCustomer();const product=await fixtureProduct({name:'क'.repeat(250),current_stock:'1000.000'});
 const result=await post('/invoices',{customer_id:customer.id,bill_type:'retail',date:'2026-07-05',items:Array.from({length:500},()=>({product_id:product.id,qty:'1',unit:'piece',rate:'0.00'})),payment:{amount_paid:'0.00',modes:[]}});
 assert.equal(result.status,201,JSON.stringify(result.body));const source=(await db.query("SELECT dto,error_code FROM document_sources WHERE source_type='invoice' AND source_id=$1",[result.body.data.invoice_id])).rows[0];assert.equal(source.dto,null);assert.equal(source.error_code,'DOCUMENT_CONTENT_LIMIT');
 const requested=await post('/documents',document(result.body.data.invoice_id));assert.equal(requested.status,201);assert.equal(requested.body.data.status,'permanent_failure');assert.equal((await db.query('SELECT current_stock FROM products WHERE id=$1',[product.id])).rows[0].current_stock,'500.000');
});

test('seller identity bounds reject content the fixed renderer cannot accept before capture',()=>{
 const config=require('../../src/modules/documents/config');const originalName=process.env.STORE_NAME,originalAddress=process.env.STORE_ADDRESS;
 try {process.env.STORE_NAME='S'.repeat(241);assert.throws(()=>config.seller(),error=>error.errorCode==='DOCUMENT_SELLER_SNAPSHOT_REQUIRED');process.env.STORE_NAME=originalName;process.env.STORE_ADDRESS='A'.repeat(801);assert.throws(()=>config.seller(),error=>error.errorCode==='DOCUMENT_SELLER_SNAPSHOT_REQUIRED');}
 finally{process.env.STORE_NAME=originalName;process.env.STORE_ADDRESS=originalAddress;}
});

test('document preflight rejects overlong complete cells and renderer-forbidden directional controls without truncation',()=>{
 const {preflight}=require('../../src/modules/documents/documentDto');const content={number:'test',issued_on:'2026-07-01',generated_at:'2026-07-01T00:00:00.000Z',seller:{name:'Synthetic',address:'Address',tax_id:'Unknown'},customer:{name:'Synthetic',address:'Address',tax_id:'Unknown'},facts:[],totals:[],columns:[{key:'one',label:'One',align:'left'}],rows:[{cells:['A'.repeat(600)]}],notices:[]};
 assert.equal(preflight(content),content);content.rows[0].cells[0]='A'.repeat(601);assert.throws(()=>preflight(content),error=>error.errorCode==='DOCUMENT_CONTENT_INVALID');assert.equal(content.rows[0].cells[0].length,601);
 content.rows[0].cells[0]='Untrusted'+String.fromCodePoint(8238)+' text';assert.throws(()=>preflight(content),error=>error.errorCode==='DOCUMENT_CONTENT_INVALID');
});
