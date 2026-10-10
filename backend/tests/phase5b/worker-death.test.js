const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {spawn}=require('node:child_process');
const {randomUUID}=require('node:crypto');
const {setImmediate}=require('node:timers/promises');
const fs=require('node:fs/promises');const path=require('node:path');const os=require('node:os');
const {disposableDatabase}=require('../helpers/disposableDatabase');
let api,root;
before(async()=>{
 await disposableDatabase('document_worker_death');api=require('../helpers/financial');
 Object.assign(process.env,{DOCUMENT_RUNTIME_MODE:'synthetic-local',DOCUMENT_SELLER_CONFIRMED:'true',STORE_NAME:'Synthetic Worker Recovery Shop',STORE_ADDRESS:'Synthetic local address',STORE_GSTIN:'SYNTHETIC'});
 root=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'hardware-worker-death-')));await fs.chmod(root,0o700);process.env.DOCUMENT_ARTIFACT_ROOT=root;
});
after(async()=>{if(api)await api.close();if(root)await fs.rm(root,{recursive:true,force:true});});
function startWorker() {
 const env={PATH:process.env.PATH,LANG:'C.UTF-8',NODE_ENV:'test',NODE_OPTIONS:process.env.NODE_OPTIONS,DB_HOST:process.env.DB_HOST,DB_PORT:process.env.DB_PORT,DB_NAME:process.env.DB_NAME,DB_USER:process.env.TEST_APP_DB_USER,
  DOCUMENT_DB_USER:process.env.TEST_DOCUMENT_WORKER_USER,DOCUMENT_DB_PASSWORD:process.env.TEST_DOCUMENT_WORKER_PASSWORD,DOCUMENT_RUNTIME_MODE:'synthetic-local',DOCUMENT_ARTIFACT_ROOT:root,
  DOCUMENT_RENDERER_DRIVER:process.env.DOCUMENT_RENDERER_DRIVER||(process.platform==='darwin'?'macos-sandbox':'docker'),DOCUMENT_RENDERER_IMAGE:process.env.DOCUMENT_RENDERER_IMAGE||'hardware-erp-renderer:phase5b'};
 assert.ok(env.DOCUMENT_DB_USER&&env.DOCUMENT_DB_PASSWORD);assert.ok(env.NODE_OPTIONS.includes('local-only-network.cjs'));
 const child=spawn(process.execPath,['document-worker.js','--once'],{cwd:path.resolve(__dirname,'../..'),env,stdio:['ignore','pipe','pipe']});
 let stdout='',stderr='',spawnError=null,timedOut=false;
 child.stdout.on('data',chunk=>{stdout=(stdout+chunk.toString()).slice(-8192);});child.stderr.on('data',chunk=>{stderr=(stderr+chunk.toString()).slice(-8192);});child.on('error',error=>{spawnError=error.code;});
 const timer=setTimeout(()=>{timedOut=true;child.kill('SIGKILL');},30000);
 const closed=new Promise(resolve=>child.on('close',(code,signal)=>{clearTimeout(timer);resolve({code,signal,stdout,stderr,spawnError,timedOut});}));
 return {child,closed};
}
async function financialState(customerId) {
 return (await api.ownerPool.query(`SELECT (SELECT count(*) FROM payments WHERE customer_id=$1)::integer AS payments,(SELECT count(*) FROM customer_ledger WHERE customer_id=$1)::integer AS ledger_rows,(SELECT outstanding_balance FROM customers WHERE id=$1) AS balance,(SELECT count(*) FROM stock_ledger)::integer AS stock_rows`,[customerId])).rows[0];
}
test('actual document worker SIGKILL after render recovers one ready version without another financial effect',async()=>{
 const customer=await api.fixtureCustomer();const key=randomUUID();const input={customer_id:customer.id,amount:'25.00',mode:'cash',payment_date:'2026-09-01'};
 const payment=await api.post('/payments',input,{key});assert.equal(payment.status,201,JSON.stringify(payment.body));
 const requested=await api.post('/documents',{source_type:'payment',source_id:payment.body.data.id,layout:'a4'});assert.equal(requested.status,201,JSON.stringify(requested.body));const id=requested.body.data.id;
 const before=await financialState(customer.id);const blocker=await api.ownerPool.connect();let first,firstOutcome,failure;
 try {
  const pid=(await blocker.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;await blocker.query('SELECT pg_advisory_lock(50502,1)');
  first=startWorker();let observed;const deadline=Date.now()+20000;
  while(Date.now()<deadline) {
   observed=(await api.ownerPool.query(`SELECT j.status,j.attempts,j.lease_token,j.artifact_key,(SELECT count(*)::integer FROM pg_stat_activity a WHERE a.datname=current_database() AND a.usename=$2 AND $3=ANY(pg_blocking_pids(a.pid))) AS blocked_workers FROM document_jobs j WHERE j.id=$1`,[id,process.env.TEST_DOCUMENT_WORKER_USER,pid])).rows[0];
   if(observed.status==='running'&&observed.blocked_workers===1)break;
   if(first.child.exitCode!==null||first.child.signalCode!==null)throw new Error('Worker exited before publication barrier: '+JSON.stringify(await first.closed));
   await setImmediate();
  }
  assert.equal(observed.status,'running');assert.equal(observed.blocked_workers,1,'real restricted worker must finish isolated rendering and wait at publication');assert.equal(observed.attempts,1);assert.equal(observed.artifact_key,null);assert.deepEqual(await fs.readdir(root),[]);
  assert.equal(first.child.kill('SIGKILL'),true);firstOutcome=await first.closed;assert.equal(firstOutcome.signal,'SIGKILL');assert.equal(firstOutcome.timedOut,false);
 }catch(error){failure=error;}finally{
  if(first&&first.child.exitCode===null&&first.child.signalCode===null)first.child.kill('SIGKILL');
  if(first&&!firstOutcome)firstOutcome=await first.closed;
  await blocker.query('SELECT pg_advisory_unlock(50502,1)');blocker.release();
 }
 if(failure)throw failure;
 const abandoned=(await api.ownerPool.query('SELECT status,attempts,lease_token,artifact_key FROM document_jobs WHERE id=$1',[id])).rows[0];assert.equal(abandoned.status,'running');assert.equal(abandoned.artifact_key,null);
 // Advance only the synthetic lease fixture; the child death above was a real OS SIGKILL.
 await api.ownerPool.query("UPDATE document_jobs SET lease_until=clock_timestamp()-interval '1 second' WHERE id=$1",[id]);
 const second=startWorker();const completed=await second.closed;assert.equal(completed.code,0,JSON.stringify(completed));assert.equal(completed.timedOut,false);const result=JSON.parse(completed.stdout.trim());assert.deepEqual(result,{processed:true,result:{id,status:'ready'}});
 const published=(await api.ownerPool.query('SELECT status,attempts,lease_token,artifact_key,artifact_sha256,artifact_bytes,source_snapshot_id FROM document_jobs WHERE id=$1',[id])).rows[0];assert.equal(published.status,'ready');assert.equal(published.attempts,2);assert.ok(BigInt(published.lease_token)>BigInt(abandoned.lease_token));
 const file=await require('../../src/modules/documents/artifacts').read({key:published.artifact_key,sha256:published.artifact_sha256,bytes:published.artifact_bytes});assert.equal(file.subarray(0,5).toString(),'%PDF-');assert.deepEqual(await fs.readdir(root),[published.artifact_key+'.pdf']);
 assert.equal((await api.ownerPool.query('SELECT count(*) FROM document_jobs WHERE source_snapshot_id=$1',[published.source_snapshot_id])).rows[0].count,'1');assert.deepEqual(await financialState(customer.id),before);assert.deepEqual((await api.post('/payments',input,{key})).body,payment.body);
 console.log(JSON.stringify({worker_death_recovery:{job_id:id,killed_signal:firstOutcome.signal,lease_expiry:'synthetic fixture advanced after real process death',attempts:published.attempts,artifact_sha256:published.artifact_sha256,financial_state:before}}));
});
