const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {setImmediate}=require('node:timers/promises');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');const {Pool}=require('pg');
const {disposableDatabase}=require('../helpers/disposableDatabase');
const jobs=require('../../src/modules/documents/jobs');const artifacts=require('../../src/modules/documents/artifacts');
let api,worker,root;
before(async()=>{
  await disposableDatabase('documents'); api=require('../helpers/financial');
  worker=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.TEST_DOCUMENT_WORKER_USER,password:process.env.TEST_DOCUMENT_WORKER_PASSWORD,ssl:false});
  Object.assign(process.env,{DOCUMENT_RUNTIME_MODE:'synthetic-local',DOCUMENT_SELLER_CONFIRMED:'true',STORE_NAME:'Synthetic Lifecycle Shop',STORE_ADDRESS:'Synthetic local address',STORE_GSTIN:'SYNTHETIC'});
  root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'hardware-document-lifecycle-'))); await fs.chmod(root,0o700);process.env.DOCUMENT_ARTIFACT_ROOT=root;
});
after(async()=>{if(worker)await worker.end();if(api)await api.close();if(root)await fs.rm(root,{recursive:true,force:true});});
async function receipt(date='2026-08-02') {
 const customer=await api.fixtureCustomer();const financialKey=randomUUID();const financialInput={customer_id:customer.id,amount:'25.00',mode:'cash',payment_date:date};const response=await api.post('/payments',financialInput,{key:financialKey});assert.equal(response.status,201,JSON.stringify(response.body));
 const id=response.body.data.id;const payload={source_type:'payment',source_id:id,layout:'a4'};const requested=await api.post('/documents',payload);assert.equal(requested.status,201,JSON.stringify(requested.body));return {id,customer,payload,job:requested.body.data,financialKey,financialInput,financialBody:response.body};
}
async function get(id,suffix='') {const actor=await api.setupActor();return api.request(api.app).get('/api/documents/'+id+suffix).set('Cookie',actor.cookie).set('X-Forwarded-For',actor.ip);}
const fake=Buffer.from('%PDF-1.7\nSynthetic byte recovery fixture only\n%%EOF\n');
test('closed-day original reprint has independent idempotency and changes no ledger',async()=>{
 const f=await receipt('2026-08-01');assert.equal((await api.post('/finance/days/open',{date:'2026-08-01',opening_float:'0.00',reason:'Synthetic opening'})).status,201);
 const quote=await api.post('/finance/days/quote',{date:'2026-08-01',counted_cash:'25.00',reason:'Synthetic count',operator_confirmed:true});assert.equal(quote.status,200,JSON.stringify(quote.body));
 const closed=await api.post('/finance/days/close',{date:'2026-08-01',counted_cash:'25.00',reason:'Synthetic count',operator_confirmed:true,quote_hash:quote.body.data.quote_hash});assert.equal(closed.status,201,JSON.stringify(closed.body));
 const before=(await api.ownerPool.query('SELECT row_to_json(l) AS row FROM customer_ledger l WHERE customer_id=$1 ORDER BY id',[f.customer.id])).rows;
 const reprint=await api.post('/documents',{...f.payload,layout:'thermal80'});assert.equal(reprint.status,201);assert.equal(reprint.body.data.content_hash,f.job.content_hash);
 assert.deepEqual((await api.ownerPool.query('SELECT row_to_json(l) AS row FROM customer_ledger l WHERE customer_id=$1 ORDER BY id',[f.customer.id])).rows,before);
 const late=await api.post('/payments',{customer_id:f.customer.id,amount:'1.00',mode:'cash',payment_date:'2026-08-01'});assert.equal(late.body.code,'FINANCIAL_PERIOD_CLOSED');
});
test('missing private artifact invalidates exact metadata and recovers identical content once without another receipt',async()=>{
 const f=await receipt();const done=await jobs.processOne({pool:worker,id:f.job.id,render:async()=>fake,artifacts});assert.equal(done.status,'ready');
 const before=(await api.ownerPool.query('SELECT artifact_key,artifact_sha256,artifact_bytes,published_at FROM document_jobs WHERE id=$1',[f.job.id])).rows[0];
 const downloaded=await get(f.job.id,'/download');assert.equal(downloaded.status,200);assert.match(downloaded.headers['content-type'],/application\/pdf/);assert.equal(downloaded.headers['cache-control'],'private, no-store');assert.equal(downloaded.headers['x-content-type-options'],'nosniff');assert.ok(downloaded.headers['content-disposition'].includes(f.job.id));
 await fs.unlink(path.join(root,before.artifact_key+'.pdf'));
 const missing=await get(f.job.id,'/download');assert.equal(missing.status,503);assert.equal(missing.body.code,'DOCUMENT_ARTIFACT_UNAVAILABLE');
 const key=randomUUID();const retry=await api.post('/documents/'+f.job.id+'/retry',{}, {key});assert.equal(retry.status,201);assert.equal(retry.body.data.status,'pending');
 await api.ownerPool.query("UPDATE document_jobs SET updated_at=clock_timestamp()+interval '1 minute' WHERE id=$1",[f.job.id]);
 assert.equal(await jobs.claim(worker,{id:f.job.id}),null);
 await api.ownerPool.query("UPDATE document_jobs SET updated_at=clock_timestamp()-interval '10 seconds' WHERE id=$1",[f.job.id]);
 assert.equal((await jobs.processOne({pool:worker,id:f.job.id,render:async()=>fake,artifacts})).status,'ready');
 const after=(await api.ownerPool.query('SELECT artifact_key,artifact_sha256,artifact_bytes,published_at FROM document_jobs WHERE id=$1',[f.job.id])).rows[0];
 assert.notEqual(after.artifact_key,before.artifact_key);assert.equal(after.artifact_sha256,before.artifact_sha256);assert.equal(after.artifact_bytes,before.artifact_bytes);assert.deepEqual(after.published_at,before.published_at);
 assert.deepEqual((await api.post('/documents/'+f.job.id+'/retry',{}, {key})).body,retry.body);
 assert.equal((await api.ownerPool.query('SELECT count(*) FROM payments WHERE customer_id=$1',[f.customer.id])).rows[0].count,'1');
});
test('worker expiry consumes bounded attempts; stale workers and exhausted retries cannot publish',async()=>{
 const f=await receipt(); let first;
 const competing=await Promise.all([jobs.claim(worker,{id:f.job.id}),jobs.claim(worker,{id:f.job.id})]);assert.equal(competing.filter(Boolean).length,1);first=competing.find(Boolean);await api.ownerPool.query("UPDATE document_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.job.id]);
 for(let i=1;i<3;i++) {const lease=await jobs.claim(worker,{id:f.job.id});assert.equal(lease.attempts,i+1);first ||= lease;await api.ownerPool.query("UPDATE document_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[f.job.id]);}
 assert.equal(await jobs.claim(worker,{id:f.job.id}),null);
 const row=(await api.ownerPool.query('SELECT status,error_code FROM document_jobs WHERE id=$1',[f.job.id])).rows[0];assert.deepEqual(row,{status:'permanent_failure',error_code:'DOCUMENT_RETRY_EXHAUSTED'});
 assert.equal(await jobs.complete(worker,{...first,artifact_key:randomUUID(),artifact_sha256:'a'.repeat(64),artifact_bytes:50}),false);
 const retry=await api.post('/documents/'+f.job.id+'/retry',{});assert.equal(retry.status,409);assert.equal(retry.body.code,'DOCUMENT_PERMANENT_FAILURE');
});
test('request persistence failure rolls back its new format job and same key remains recoverable',async()=>{
 const f=await receipt();const key=randomUUID();const actor=await api.setupActor();const trigger='document_request_fail_'+randomUUID().replaceAll('-','');
 await api.ownerPool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.key='${key}' THEN RAISE EXCEPTION 'synthetic request persistence failure'; END IF; RETURN NEW; END $$`);
 await api.ownerPool.query(`CREATE TRIGGER ${trigger} BEFORE INSERT ON document_requests FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
 const body={...f.payload,layout:'thermal80'};
 try {const failed=await api.post('/documents',body,{actor,key});assert.equal(failed.status,500);assert.equal((await api.ownerPool.query('SELECT count(*) FROM document_requests WHERE key=$1',[key])).rows[0].count,'0');assert.equal((await api.ownerPool.query("SELECT count(*) FROM document_jobs j JOIN document_sources s ON s.id=j.source_snapshot_id WHERE s.source_type='payment' AND s.source_id=$1 AND j.layout='thermal80'",[f.id])).rows[0].count,'0');}
 finally {await api.ownerPool.query(`DROP TRIGGER ${trigger} ON document_requests`);await api.ownerPool.query(`DROP FUNCTION ${trigger}()`);}
 const recovered=await api.post('/documents',body,{actor,key});assert.equal(recovered.status,201);assert.deepEqual((await api.post('/documents',body,{actor,key})).body,recovered.body);
});
test('runtime disabled and signed-out reads cannot expose even a ready private artifact',async()=>{
 const f=await receipt();assert.equal((await jobs.processOne({pool:worker,id:f.job.id,render:async()=>fake,artifacts})).status,'ready');
 const savedRoot=process.env.DOCUMENT_ARTIFACT_ROOT;process.env.DOCUMENT_ARTIFACT_ROOT=root+'/../invalid';try {const unsafe=await get(f.job.id,'/download');assert.equal(unsafe.status,503);assert.equal(unsafe.body.code,'DOCUMENT_STORAGE_UNSAFE');}finally{process.env.DOCUMENT_ARTIFACT_ROOT=savedRoot;}
 const unsigned=await api.request(api.app).get('/api/documents/'+f.job.id+'/download');assert.equal(unsigned.status,401);
 process.env.DOCUMENT_RUNTIME_MODE='disabled';try {const denied=await get(f.job.id,'/download');assert.equal(denied.status,503);assert.equal(denied.body.code,'DOCUMENTS_DISABLED');}finally{process.env.DOCUMENT_RUNTIME_MODE='synthetic-local';}
});

test('artifact store and selected publication wait on the same cleanup barrier using real database locks',async()=>{
 const f=await receipt();const blocker=await api.ownerPool.connect();let pending,stored=false,failure;
 try {
  const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await blocker.query('SELECT pg_advisory_lock(50502,1)');
  pending=jobs.processOne({pool:worker,id:f.job.id,render:async()=>fake,artifacts:{store:async bytes=>{stored=true;return artifacts.store(bytes);}}});
  const deadline=Date.now()+5000;let waiting=0;while(!waiting&&Date.now()<deadline){waiting=(await api.ownerPool.query('SELECT count(*)::integer AS count FROM pg_stat_activity WHERE datname=current_database() AND usename=$2 AND $1=ANY(pg_blocking_pids(pid))',[pid,process.env.TEST_DOCUMENT_WORKER_USER])).rows[0].count;await setImmediate();}
  assert.equal(waiting,1,'document worker must block before storage on cleanup publication lock');assert.equal(stored,false);
 }catch(error){failure=error;}finally{await blocker.query('SELECT pg_advisory_unlock(50502,1)');blocker.release();}
 const result=await pending;if(failure)throw failure;assert.equal(result.status,'ready');assert.equal(stored,true);
});

test('restricted caller temporary objects cannot shadow privileged document retry or artifact invalidation',async()=>{
 const retry=await receipt();const invalidation=await receipt();
 const first=await jobs.claim(worker,{id:retry.job.id});await jobs.fail(worker,{...first,error_code:'DOCUMENT_RENDER_FAILED'});
 const second=await jobs.claim(worker,{id:invalidation.job.id});const file=await artifacts.store(fake);assert.equal(await jobs.complete(worker,{...second,artifact_key:file.key,artifact_sha256:file.sha256,artifact_bytes:file.bytes}),true);
 const client=await api.appPool.connect();let observed;
 try {
  await client.query('CREATE TEMP TABLE document_jobs (LIKE public.document_jobs INCLUDING ALL)');
  await client.query('INSERT INTO pg_temp.document_jobs SELECT * FROM public.document_jobs WHERE id=ANY($1::uuid[])',[[retry.job.id,invalidation.job.id]]);
  await client.query('CREATE TEMP TABLE document_shadow_effects (job_id UUID)');
  await client.query(`CREATE FUNCTION pg_temp.record_document_shadow() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN INSERT INTO pg_temp.document_shadow_effects VALUES(NEW.id); RETURN NEW; END $$`);
  await client.query('CREATE TRIGGER shadow_document_mutation BEFORE UPDATE ON pg_temp.document_jobs FOR EACH ROW EXECUTE FUNCTION pg_temp.record_document_shadow()');
  assert.equal((await client.query('SELECT public.request_document_retry($1) AS allowed',[retry.job.id])).rows[0].allowed,true);
  assert.equal((await client.query('SELECT public.invalidate_document_artifact($1,$2) AS allowed',[invalidation.job.id,file.sha256])).rows[0].allowed,true);
  observed={public_statuses:(await client.query('SELECT id,status FROM public.document_jobs WHERE id=ANY($1::uuid[]) ORDER BY id',[[retry.job.id,invalidation.job.id]])).rows,shadow_effects:(await client.query('SELECT count(*)::integer AS count FROM pg_temp.document_shadow_effects')).rows[0].count};
  console.log(JSON.stringify({document_search_path_regression:observed}));
 }finally{await client.query('DROP TABLE IF EXISTS pg_temp.document_jobs,pg_temp.document_shadow_effects');await client.query('DROP FUNCTION IF EXISTS pg_temp.record_document_shadow()');client.release();}
 assert.equal(observed.shadow_effects,0,'SECURITY DEFINER must never run caller-controlled temporary-table triggers');
 assert.equal(observed.public_statuses.find(row=>row.id===retry.job.id).status,'pending');
 assert.equal(observed.public_statuses.find(row=>row.id===invalidation.job.id).status,'retryable_failure');
});

test('metadata failure after private artifact storage leaves no download and recovery preserves the original receipt',async()=>{
 const f=await receipt();const trigger='document_publication_fail_'+randomUUID().replaceAll('-','');const before=new Set(await fs.readdir(root));
 await api.ownerPool.query(`CREATE FUNCTION ${trigger}() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN IF NEW.id='${f.job.id}' AND NEW.status='ready' THEN RAISE EXCEPTION 'synthetic publication metadata failure'; END IF; RETURN NEW; END $$`);
 await api.ownerPool.query(`CREATE TRIGGER ${trigger} BEFORE UPDATE ON document_jobs FOR EACH ROW EXECUTE FUNCTION ${trigger}()`);
 try {assert.equal((await jobs.processOne({pool:worker,id:f.job.id,render:async()=>fake,artifacts})).status,'failed');}
 finally {await api.ownerPool.query(`DROP TRIGGER ${trigger} ON document_jobs`);await api.ownerPool.query(`DROP FUNCTION ${trigger}()`);}
 const orphanFiles=(await fs.readdir(root)).filter(file=>!before.has(file));assert.equal(orphanFiles.length,1);assert.match(orphanFiles[0],/^[a-f0-9-]{36}\.pdf$/);
 const metadata=(await api.ownerPool.query('SELECT status,artifact_key,artifact_sha256 FROM document_jobs WHERE id=$1',[f.job.id])).rows[0];assert.deepEqual(metadata,{status:'retryable_failure',artifact_key:null,artifact_sha256:null});
 const unavailable=await get(f.job.id,'/download');assert.equal(unavailable.status,409);assert.equal(unavailable.body.code,'DOCUMENT_NOT_READY');
 assert.deepEqual((await api.post('/payments',f.financialInput,{key:f.financialKey})).body,f.financialBody);assert.equal((await api.ownerPool.query('SELECT count(*) FROM payments WHERE customer_id=$1',[f.customer.id])).rows[0].count,'1');
 const retryKey=randomUUID();const retry=await api.post('/documents/'+f.job.id+'/retry',{}, {key:retryKey});assert.equal(retry.status,201);await api.ownerPool.query("UPDATE document_jobs SET updated_at=clock_timestamp()-interval '10 seconds' WHERE id=$1",[f.job.id]);
 assert.equal((await jobs.processOne({pool:worker,id:f.job.id,render:async()=>fake,artifacts})).status,'ready');
 const restored=(await api.ownerPool.query('SELECT artifact_key,artifact_sha256,artifact_bytes FROM document_jobs WHERE id=$1',[f.job.id])).rows[0];assert.notEqual(restored.artifact_key+'.pdf',orphanFiles[0]);assert.deepEqual(await artifacts.read({key:restored.artifact_key,sha256:restored.artifact_sha256,bytes:restored.artifact_bytes}),await fs.readFile(path.join(root,orphanFiles[0])));
 assert.deepEqual((await api.post('/documents/'+f.job.id+'/retry',{}, {key:retryKey})).body,retry.body);
});

test('statement repeatable-read snapshot includes commits before its first read and excludes later commits',async()=>{
 const f=await receipt();const client=await api.appPool.connect();const {statementDto}=require('../../src/modules/documents/documentDto');const reporting=require('../../src/modules/settlements/reporting');const options=reporting.normalize({as_of:'2026-08-02'});const seller=require('../../src/modules/documents/config').seller();
 const incoming=()=>api.post('/payments',{customer_id:f.customer.id,amount:'10.00',mode:'cash',payment_date:'2026-08-02'});
 try {
  await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ');
  assert.equal((await incoming()).status,201);
  const first=await statementDto(client,f.customer.id,options,seller);assert.equal(first.totals.find(row=>row.label==='Closing account balance').value,'₹ -35.00');assert.equal(first.rows.length,2);
  assert.equal((await incoming()).status,201);
  const frozen=await statementDto(client,f.customer.id,options,seller);assert.equal(frozen.totals.find(row=>row.label==='Closing account balance').value,'₹ -35.00');assert.deepEqual(frozen.rows,first.rows);
  assert.equal(frozen.facts.find(row=>row.label==='Snapshot transaction began').value,first.facts.find(row=>row.label==='Snapshot transaction began').value);
  await client.query('COMMIT');
  const current=await reporting.customerStatement(f.customer.id,{as_of:'2026-08-02'});assert.equal(current.closing_balance,'-45.00');assert.equal(current.rows.length,3);
 }finally{await client.query('ROLLBACK');client.release();}
});
