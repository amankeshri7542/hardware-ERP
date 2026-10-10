import test from 'node:test';
import assert from 'node:assert/strict';
import { newDocumentIntent, readDocumentIntent, executeDocumentIntent, clearDocumentIntent, documentStorageKey, safeDocumentFilename } from '../src/components/Documents/documentIntent.js';
assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true);
const memory = () => { const m=new Map(); return {getItem:k=>m.get(k)??null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)}; };
const payload={source_type:'invoice',source_id:31,layout:'a4'};
const receipt={id:'12e45678-e89b-42d3-a456-426614174000',...payload,status:'pending',template_version:'v1',content_hash:'a'.repeat(64)};
const ok=(value=receipt)=>({data:{success:true,data:value}});
test('Phase5B document request persists exact intent before dispatch and recovers original key after response loss', async()=>{
 const storage=memory(), original=newDocumentIntent(7,'request',payload);
 const result=await executeDocumentIntent(storage,7,original,async intent=>{
  assert.deepEqual(readDocumentIntent(storage,7).payload,payload); assert.equal(intent.key,original.key); throw new Error('Lost response');
 });
 assert.equal(result.status,'uncertain'); assert.throws(()=>clearDocumentIntent(storage,7,result),/Recover/);
 const reloaded=readDocumentIntent(storage,7);
 const recovered=await executeDocumentIntent(storage,7,reloaded,async intent=>{assert.equal(intent.key,original.key);return ok();});
 assert.equal(recovered.status,'completed'); assert.equal(recovered.result.id,receipt.id);
});
test('Phase5B documents never overwrite a financial intent or another document operation',async()=>{
 const storage=memory(); storage.setItem('hardware-erp-intent-v1:7:invoice','financial draft');
 const first=newDocumentIntent(7,'request',payload);
 await executeDocumentIntent(storage,7,first,async()=>{throw new Error('Lost');});
 await assert.rejects(executeDocumentIntent(storage,7,newDocumentIntent(7,'request',{...payload,source_id:32}),async()=>ok()),/saved document/);
 assert.equal(storage.getItem('hardware-erp-intent-v1:7:invoice'),'financial draft');
});
test('Phase5B document actor mismatch is rejected before dispatch and never clears original intent',async()=>{
 const storage=memory(),original=newDocumentIntent(7,'request',payload);let sent=0;
 await executeDocumentIntent(storage,7,original,async()=>{throw new Error('Lost');});
 await assert.rejects(executeDocumentIntent(storage,8,original,async()=>{sent++;return ok();}),/original account/);
 assert.equal(sent,0);assert.equal(readDocumentIntent(storage,7).key,original.key);
});
for(const patch of [{source_id:99},{source_type:'payment'},{layout:'thermal80'},{id:'../private'},{status:'invented'}, {content_hash:'invalid'}]) test(`Phase5B invalid document receipt ${JSON.stringify(patch)} remains uncertain`,async()=>{
 const result=await executeDocumentIntent(memory(),7,newDocumentIntent(7,'request',payload),async()=>ok({...receipt,...patch}));assert.equal(result.status,'uncertain');
});
test('Phase5B later rejection cannot resolve an uncertain original request',async()=>{
 const storage=memory(),original=newDocumentIntent(7,'request',payload);
 const lost=await executeDocumentIntent(storage,7,original,async()=>{throw new Error('Lost');});
 const rejected=await executeDocumentIntent(storage,7,lost,async()=>{throw {response:{status:422,data:{code:'DOCUMENT_SOURCE_UNVERIFIED'}}};});
 assert.equal(rejected.status,'uncertain');assert.equal(rejected.key,original.key);
});
test('Phase5B storage failure prevents dispatch',async()=>{
 const storage=memory();storage.setItem=()=>{throw new Error('Quota');};let sent=0;
 await assert.rejects(executeDocumentIntent(storage,7,newDocumentIntent(7,'request',payload),async()=>{sent++;return ok();}),/Quota/);assert.equal(sent,0);
});
test('Phase5B retry validates the original document identity',async()=>{
 const original=newDocumentIntent(7,'retry',{id:receipt.id,...payload});
 assert.equal((await executeDocumentIntent(memory(),7,original,async()=>ok())).status,'completed');
 assert.equal((await executeDocumentIntent(memory(),7,original,async()=>ok({...receipt,id:'22e45678-e89b-42d3-a456-426614174000'}))).status,'uncertain');
});
test('Phase5B corrupt recovery fails closed and filenames cannot choose paths',()=>{
 const storage=memory();storage.setItem(documentStorageKey(7),JSON.stringify({version:1,status:'pending',actorId:8}));
 assert.throws(()=>readDocumentIntent(storage,7));
 assert.equal(safeDocumentFilename('invoice-31.pdf'),'invoice-31.pdf');
 for(const name of ['../../secret.pdf','bad.html','invoice\n.pdf','CON.pdf'])assert.equal(safeDocumentFilename(name),'document.pdf');
});
