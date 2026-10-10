const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const net=require('node:net');
const {run,renderIsolated}=require('../backend/src/modules/documents/renderProcess');
const artifacts=require('../backend/src/modules/documents/artifacts');
const {fixture,boundaryFixture}=require('../renderer/tests/fixture.cjs');
if(globalThis.__ERP_LOCAL_NETWORK_GUARD__!==true)throw new Error('Network guard must be installed before runtime tests');
if(process.env.NODE_ENV!=='test'||process.env.DOCUMENT_RUNTIME_MODE!=='synthetic-local')throw new Error('Explicit synthetic-local/test runtime required');
let owned,storage;
test.before(async()=>{
 owned=await fs.mkdtemp(path.join(await fs.realpath(os.tmpdir()),'erp-document-runtime-'));
 storage=path.join(owned,'private');process.env.DOCUMENT_ARTIFACT_ROOT=storage;
});
test.after(async()=>{if(owned)await fs.rm(owned,{recursive:true,force:true});});
test('real OS boundary denies outside file, file creation, host-loopback networking and inherited secrets',async()=>{
 const canary=path.join(owned,'outside-canary');await fs.writeFile(canary,'SYNTHETIC_CANARY_ONLY',{mode:0o600});
 const server=net.createServer(socket=>socket.end('network escape'));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 await new Promise((resolve,reject)=>{const socket=net.createConnection({host:'127.0.0.1',port:server.address().port});let value='';socket.on('error',reject);socket.on('data',chunk=>{value+=chunk;});socket.on('end',()=>{try{assert.equal(value,'network escape');resolve();}catch(error){reject(error);}});});
 process.env.DOCUMENT_PROBE_SECRET='SYNTHETIC_SECRET_MUST_NOT_REACH_RENDERER';
 try{
  const result=JSON.parse((await run(Buffer.from(JSON.stringify({canary,writePath:path.join(owned,'escape'),port:server.address().port})),{probe:true})).toString());
  assert.equal(result.guard,true);assert.equal(result.secretPresent,false);assert.equal(result.readDenied,true);assert.equal(result.writeDenied,true);assert.equal(result.networkDenied,true);
  assert.ok(['EPERM','EACCES','ECONNREFUSED','ENETUNREACH','EHOSTUNREACH'].includes(result.networkError));
  console.log('OS isolation denial codes:',JSON.stringify({read:result.readError,write:result.writeError,network:result.networkError}));
  await assert.rejects(fs.stat(path.join(owned,'escape')),{code:'ENOENT'});
 }finally{delete process.env.DOCUMENT_PROBE_SECRET;await new Promise(resolve=>server.close(resolve));}
});
test('isolated bounded worker rejects malformed/large input, times out and cancels without output publication',async()=>{
 await assert.rejects(run(Buffer.from('{bad json')),{code:'DOCUMENT_RENDER_FAILED'});
 await assert.rejects(run(Buffer.alloc(256*1024+1)),{code:'DOCUMENT_INPUT_LIMIT'});
 await assert.rejects(run(Buffer.from('{"mode":"hang"}'),{probe:true,timeoutMs:300}),{code:'DOCUMENT_RENDER_TIMEOUT'});
 const controller=new AbortController();const pending=run(Buffer.from('{"mode":"hang"}'),{probe:true,signal:controller.signal});
 controller.abort();await assert.rejects(pending,{code:'DOCUMENT_RENDER_CANCELLED'});
});
test('actual private artifact roundtrip checks hash, opaque paths, symlinks, missing objects and live cleanup',async()=>{
 const pdf=await renderIsolated(fixture());const saved=await artifacts.store(pdf);
 assert.match(saved.key,/^[a-f0-9-]{36}$/);assert.equal(saved.bytes,pdf.length);assert.deepEqual(await artifacts.read(saved),pdf);
 await assert.rejects(artifacts.read({...saved,key:'../../escape'}),{code:'DOCUMENT_ARTIFACT_CORRUPT'});
 await assert.rejects(artifacts.read({...saved,sha256:'0'.repeat(64)}),{code:'DOCUMENT_ARTIFACT_CORRUPT'});
 const orphan=await artifacts.store(pdf);const past=new Date(Date.now()-172800000);
 for(const id of [saved.key,orphan.key])await fs.utimes(path.join(storage,id+'.pdf'),past,past);
 assert.deepEqual(await artifacts.removeOrphans([saved.key],{olderThanMs:86400000}),[orphan.key]);
 assert.deepEqual(await artifacts.read(saved),pdf);
 await assert.rejects(artifacts.read(orphan),{code:'DOCUMENT_ARTIFACT_MISSING'});
 await fs.unlink(path.join(storage,saved.key+'.pdf'));await fs.symlink(path.join(owned,'outside-canary'),path.join(storage,saved.key+'.pdf'));
 await assert.rejects(artifacts.read(saved),{code:'DOCUMENT_ARTIFACT_CORRUPT'});
 const unsafe=path.join(owned,'unsafe');await fs.mkdir(unsafe,{mode:0o755});process.env.DOCUMENT_ARTIFACT_ROOT=unsafe;
 await assert.rejects(artifacts.store(pdf),{code:'DOCUMENT_STORAGE_UNSAFE'});process.env.DOCUMENT_ARTIFACT_ROOT=storage;
});
test('generate actual synthetic multi-page and thermal samples through isolated process',async()=>{
 const destination=process.env.DOCUMENT_SAMPLE_DIR;
 if(!destination)throw new Error('DOCUMENT_SAMPLE_DIR must name an explicit synthetic output directory');
 await fs.mkdir(destination,{recursive:true,mode:0o700});
 for(const [type,layout,count]of[['sale','a4',90],['sale','thermal80',4],['receipt','a4',2],['receipt','thermal80',2],['sales_credit','a4',6],['customer_statement','a4',80]]){
  const pdf=await renderIsolated(fixture(type,count),{layout});
  await fs.writeFile(path.join(destination,`${type}-${layout}.pdf`),pdf,{mode:0o600});
  assert.ok(pdf.length>3000);
 }
 await fs.writeFile(path.join(destination,'header-boundary-a4.pdf'),await renderIsolated(boundaryFixture()),{mode:0o600});
 console.log('Synthetic document samples:',destination);
});
test('production and missing explicit mode always remain disabled',async()=>{
 const previous=process.env.NODE_ENV;process.env.NODE_ENV='production';
 try{await assert.rejects(renderIsolated(fixture()),{code:'DOCUMENT_RUNTIME_DISABLED'});await assert.rejects(artifacts.store(Buffer.from('%PDF-1.7 enough synthetic bytes')),{code:'DOCUMENT_RUNTIME_DISABLED'});}finally{process.env.NODE_ENV=previous;}
});
