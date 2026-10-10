const { randomUUID, createHash } = require('node:crypto');
const { pool } = require('../../config/db');
const { fail, positiveId } = require('../../utils/financial');
const config = require('./config');
const dto = require('./documentDto');
const reporting = require('../settlements/reporting');
const TEMPLATE = 'phase5b-v1';
function canonical(value) { if (Array.isArray(value)) return '['+value.map(canonical).join(',')+']'; if (value && typeof value==='object') return '{'+Object.keys(value).sort().map(key=>JSON.stringify(key)+':'+canonical(value[key])).join(',')+'}'; return JSON.stringify(value); }
function hash(value) { return createHash('sha256').update(canonical(value)).digest('hex'); }
function uuid(value) { if (typeof value !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) fail('INVALID_DOCUMENT_ID',400); return value.toLowerCase(); }
function normalize(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k=>!['source_type','source_id','layout','from','to','as_of'].includes(k))) fail('UNSUPPORTED_DOCUMENT_FIELD');
  if (!['invoice','payment','customer_statement'].includes(input.source_type)) fail('DOCUMENT_SOURCE_UNSUPPORTED');
  if (!['a4','thermal80'].includes(input.layout)) fail('DOCUMENT_LAYOUT_UNSUPPORTED');
  const value={source_type:input.source_type,source_id:positiveId(input.source_id),layout:input.layout};
  if (value.source_type==='customer_statement') {
    if (value.layout!=='a4') fail('DOCUMENT_LAYOUT_UNSUPPORTED');
    if (!input.as_of) fail('DOCUMENT_STATEMENT_AS_OF_REQUIRED');
    const options=reporting.normalize(input); Object.assign(value,{from:options.from,to:options.to,as_of:options.as_of});
  } else if (['from','to','as_of'].some(k=>input[k]!==undefined)) fail('UNSUPPORTED_DOCUMENT_FIELD');
  return value;
}
async function requireSource(client,type,id) {
  const table={invoice:'invoices',payment:'payments',customer_statement:'customers'}[type];
  if (!table) fail('DOCUMENT_SOURCE_UNSUPPORTED');
  const {rows:[source]}=await client.query(`SELECT id${type==='invoice'?',document_kind':''} FROM ${table} WHERE id=$1`,[id]);
  if (!source) fail('DOCUMENT_SOURCE_NOT_FOUND',404); return source;
}
async function saveSource(client,{type,id,basis='original',actorId,build}) {
  const {rows:[existing]}=await client.query('SELECT * FROM document_sources WHERE source_type=$1 AND source_id=$2 AND basis=$3',[type,id,basis]);
  if (existing) return existing;
  let content=null,error=null;
  try { content=dto.preflight(await build()); if (Buffer.byteLength(JSON.stringify({dto:content,layout:'thermal80'}),'utf8')>262144) fail('DOCUMENT_CONTENT_LIMIT'); }
  catch (failure) { if (!failure.errorCode?.startsWith('DOCUMENT_')) throw failure; content=null; error=failure.errorCode; }
  await client.query(`INSERT INTO document_sources(id,source_type,source_id,basis,content_hash,dto,error_code,captured_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT(source_type,source_id,basis) DO NOTHING`,[randomUUID(),type,id,basis,hash(content||{error}),content,error,actorId]);
  return (await client.query('SELECT * FROM document_sources WHERE source_type=$1 AND source_id=$2 AND basis=$3',[type,id,basis])).rows[0];
}
async function saveJob(client,source,layout='a4') {
  if (layout==='thermal80' && source.dto && !['sale','receipt'].includes(source.dto.type)) fail('DOCUMENT_LAYOUT_UNSUPPORTED');
  await client.query(`INSERT INTO document_jobs(id,source_snapshot_id,layout,template_version,status,error_code) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(source_snapshot_id,layout,template_version) DO NOTHING`,[randomUUID(),source.id,layout,TEMPLATE,source.error_code?'permanent_failure':'pending',source.error_code]);
  return (await client.query('SELECT id FROM document_jobs WHERE source_snapshot_id=$1 AND layout=$2 AND template_version=$3',[source.id,layout,TEMPLATE])).rows[0].id;
}
const SELECT=`SELECT j.id,s.source_type,s.source_id,j.layout,j.template_version,j.status,j.error_code,j.attempts,j.created_at,s.content_hash FROM document_jobs j JOIN document_sources s ON s.id=j.source_snapshot_id`;
async function metadata(client,id) {
  const {rows:[job]}=await client.query(SELECT+' WHERE j.id=$1',[uuid(id)]);
  if (!job) fail('DOCUMENT_NOT_FOUND',404); await requireSource(client,job.source_type,job.source_id); return job;
}
async function command(actorId,key,operation,intent,action) {
  if (typeof key!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/.test(key)) fail('INVALID_IDEMPOTENCY_KEY',400);
  const client=await pool.connect(), lock=JSON.stringify(['document',actorId,operation,key]); let locked=false;
  try {
    // Session lock precedes the repeatable-read snapshot so identical statement requests see a committed result.
    await client.query('SELECT pg_advisory_lock(hashtextextended($1,0))',[lock]); locked=true;
    await client.query(intent.source_type==='customer_statement'?'BEGIN ISOLATION LEVEL REPEATABLE READ':'BEGIN');
    const {rows:[saved]}=await client.query('SELECT request_hash,response_body,job_id FROM document_requests WHERE actor_id=$1 AND operation=$2 AND key=$3',[actorId,operation,key]);
    if (saved) { if (saved.request_hash!==hash(intent)) fail('IDEMPOTENCY_CONFLICT',409); await metadata(client,saved.job_id); await client.query('COMMIT'); return {status:201,body:saved.response_body}; }
    const job=await action(client); const body={success:true,data:await metadata(client,job)};
    await client.query('INSERT INTO document_requests(actor_id,operation,key,request_hash,job_id,response_body) VALUES($1,$2,$3,$4,$5,$6)',[actorId,operation,key,hash(intent),job,body]);
    await client.query('COMMIT'); return {status:201,body};
  } catch(error) { try {await client.query('ROLLBACK');} catch { /* Preserve unknown completion for original-key recovery. */ } throw error; }
  finally { let broken=false; if (locked) { try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1,0))',[lock]); } catch { broken=true; } } client.release(broken); }
}
async function requestDocument(input,actorId,key) {
  config.requireEnabled(); const intent=normalize(input);
  return command(actorId,key,'request',intent,async client=>{
    const original=await requireSource(client,intent.source_type,intent.source_id);
    if (intent.layout==='thermal80' && original.document_kind==='sales_return') fail('DOCUMENT_LAYOUT_UNSUPPORTED');
    const statement=intent.source_type==='customer_statement';
    const source=await saveSource(client,{type:intent.source_type,id:intent.source_id,basis:statement?'statement:'+actorId+':'+key:'original',actorId,
      build:()=>statement?dto.statementDto(client,intent.source_id,reporting.normalize(intent),config.seller()):fail('DOCUMENT_SELLER_SNAPSHOT_REQUIRED')});
    return saveJob(client,source,intent.layout);
  });
}
async function retryDocument(id,actorId,key,body={}) {
  config.requireEnabled(); id=uuid(id); if (!body || typeof body!=='object' || Array.isArray(body) || Object.keys(body).length) fail('UNSUPPORTED_DOCUMENT_FIELD');
  return command(actorId,key,'retry',{id},async client=>{
    const row=await metadata(client,id);
    if (row.status==='permanent_failure') fail('DOCUMENT_PERMANENT_FAILURE',409);
    if (row.status==='retryable_failure') { const {rows:[result]}=await client.query('SELECT request_document_retry($1) AS allowed',[id]); if (!result.allowed) fail('DOCUMENT_RETRY_EXHAUSTED',409); }
    return id;
  });
}
async function getDocument(id) { config.requireEnabled(); return metadata(pool,id); }
async function listDocuments(query) {
  config.requireEnabled(); if (Object.keys(query).some(k=>!['source_type','source_id'].includes(k))) fail('UNSUPPORTED_DOCUMENT_FIELD');
  const id=positiveId(query.source_id); await requireSource(pool,query.source_type,id);
  return {documents:(await pool.query(SELECT+' WHERE s.source_type=$1 AND s.source_id=$2 ORDER BY j.created_at DESC,j.id LIMIT 50',[query.source_type,id])).rows};
}
async function downloadDocument(id) {
  config.requireEnabled(); const job=await metadata(pool,id); if(job.status!=='ready') fail('DOCUMENT_NOT_READY',409);
  const {rows:[artifact]}=await pool.query('SELECT artifact_key,artifact_sha256,artifact_bytes FROM document_jobs WHERE id=$1',[id]);
  try { const buffer=await require('./artifacts').read({key:artifact.artifact_key,sha256:artifact.artifact_sha256,bytes:artifact.artifact_bytes}); return {buffer,filename:'erp-'+job.id+'.pdf'}; }
  catch(error) {
    const code=error.code||error.errorCode;
    if (['DOCUMENT_STORAGE_UNSAFE','DOCUMENT_RUNTIME_DISABLED'].includes(code)) fail(code,503);
    if (!['DOCUMENT_ARTIFACT_MISSING','DOCUMENT_ARTIFACT_CORRUPT'].includes(code)) throw error;
    await pool.query('SELECT invalidate_document_artifact($1,$2)',[id,artifact.artifact_sha256]); fail('DOCUMENT_ARTIFACT_UNAVAILABLE',503);
  }
}
async function captureFinancialResult(client,{operation,result,actorId}) {
  const data=result.body.data; const sources=[];
  if (operation==='invoice.create') {
    sources.push(['invoice',data.invoice_id]);
    for (const payment of (await client.query('SELECT id FROM payments WHERE invoice_id=$1 ORDER BY id',[data.invoice_id])).rows) sources.push(['payment',payment.id]);
  } else if (operation==='invoice.return') sources.push(['invoice',data.credit_note_id]);
  else if (operation==='payment.create') sources.push(['payment',data.id]);
  for (const [type,id] of sources) {
    const source=await saveSource(client,{type,id,actorId,build:async()=>{
      let seller;
      if(operation==='invoice.return') { seller=(await client.query("SELECT dto->'seller' AS seller FROM document_sources WHERE source_type='invoice' AND source_id=$1 AND basis='original'",[data.original_invoice_id])).rows[0]?.seller; if(!seller) fail('DOCUMENT_SELLER_SNAPSHOT_REQUIRED'); }
      else seller=config.seller();
      return type==='invoice'?dto.invoiceDto(client,id,seller):dto.receiptDto(client,id,seller);
    }});
    await saveJob(client,source);
  }
}
module.exports={requestDocument,retryDocument,getDocument,listDocuments,downloadDocument,captureFinancialResult};
