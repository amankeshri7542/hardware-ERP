const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
const actor = (intent, actorId) => {
  if (!/^[1-9]\d*$/.test(String(actorId)) || String(intent.actorId) !== String(actorId)) throw new Error('Sign in as the original account to recover this document request.');
};
export const documentStorageKey = actorId => `hardware-erp-document-intent-v1:${actorId}`;
export const documentSourcePath = payload => payload.source_type === 'invoice' ? `/invoices/${payload.source_id}` : payload.source_type === 'customer_statement' ? `/customers/${payload.source_id}` : `/payments?receipt=${payload.source_id}`;
export function readDocumentIntent(storage, actorId) {
  const raw = storage.getItem(documentStorageKey(actorId));
  if (!raw) return null;
  const intent = JSON.parse(raw);
  actor(intent, actorId);
  if (intent.version !== 1 || !uuid(intent.key) || !['request','retry'].includes(intent.operation) || !intent.payload || !['invoice','payment','customer_statement'].includes(intent.payload.source_type) || !/^[1-9]\d*$/.test(String(intent.payload.source_id)) || !['a4','thermal80'].includes(intent.payload.layout) || !['pending','uncertain','rejected','completed'].includes(intent.status)) throw new Error('Saved document recovery is unreadable. Keep this browser data and resolve it before requesting another document.');
  return intent.status === 'pending' ? {...intent,status:'uncertain'} : intent;
}
export function newDocumentIntent(actorId, operation, payload) {
  return {version:1,actorId,operation,key:globalThis.crypto.randomUUID(),payload:JSON.parse(JSON.stringify(payload)),status:'pending',createdAt:new Date().toISOString()};
}
function persist(storage, actorId, intent) {
  actor(intent,actorId);
  const key=documentStorageKey(actorId), value=JSON.stringify(intent);
  storage.setItem(key,value);
  if (storage.getItem(key)!==value) throw new Error('Document recovery storage is unavailable. No new request was sent.');
}
export function validDocumentReceipt(receipt,payload) {
  return receipt && uuid(receipt.id) && (!payload.id || receipt.id===payload.id)
    && receipt.source_type===payload.source_type && String(receipt.source_id)===String(payload.source_id)
    && receipt.layout===payload.layout && ['pending','running','ready','retryable_failure','permanent_failure'].includes(receipt.status)
    && typeof receipt.template_version==='string' && receipt.template_version.length>0
    && /^[a-f0-9]{64}$/.test(receipt.content_hash);
}
export const documentError = error => {
  const code=error?.response?.data?.code || error?.code;
  return ({DOCUMENTS_DISABLED:'Document delivery is disabled in this environment.',OPERATION_ACTOR_MISMATCH:'The signed-in account changed. Sign in as the original account and recover this document request.',DOCUMENT_SOURCE_UNVERIFIED:'Historical document facts are unverified. This document needs review before it can be issued.',DOCUMENT_NOT_READY:'The document is not ready. Refresh its status; the financial record remains posted.',DOCUMENT_ARTIFACT_UNAVAILABLE:'The published file is missing. Retry document delivery after storage recovery; do not repeat the financial transaction.'})[code]
    || (error?.response?.status===401 ? 'Your session expired. Sign in as the original account to recover this document request.' : error?.response?.status===403 ? 'This account cannot access this document.' : error?.response?.data?.error || error?.message || 'The document request could not be confirmed. Keep its recovery key and retry.');
};
export async function executeDocumentIntent(storage, actorId, intent, send) {
  actor(intent,actorId);
  const saved=readDocumentIntent(storage,actorId);
  if(saved && saved.key!==intent.key) throw new Error('Recover the saved document request before starting another.');
  const pending={...intent,status:'pending',error:null};
  persist(storage,actorId,pending);
  let result;
  try {
    const response=await send(pending), receipt=response?.data?.data;
    if(response?.data?.success!==true || !validDocumentReceipt(receipt,pending.payload)) throw new Error('The response did not confirm this document request.');
    const fields=['id','source_type','source_id','layout','status','created_at','template_version','content_hash','error_code','attempts'];
    result={...pending,status:'completed',result:Object.fromEntries(fields.filter(k=>receipt[k]!==undefined).map(k=>[k,receipt[k]]))};
  } catch(error) {
    const code=error?.response?.data?.code;
    const definitive=intent.status!=='uncertain' && [400,404,422].includes(error?.response?.status) && ['DOCUMENT_SOURCE_UNVERIFIED','DOCUMENT_SOURCE_NOT_FOUND','DOCUMENT_SOURCE_UNSUPPORTED','DOCUMENT_LAYOUT_UNSUPPORTED','DOCUMENT_STATEMENT_AS_OF_REQUIRED','UNSUPPORTED_DOCUMENT_FIELD','INVALID_DOCUMENT_ID','INVALID_DECIMAL','DECIMAL_RANGE','DECIMAL_PRECISION','INVALID_DATE','INVALID_REPORT_RANGE','UNSUPPORTED_INPUT','VALIDATION_ERROR'].includes(code);
    result={...pending,status:definitive?'rejected':'uncertain',code,error:documentError(error)};
  }
  try {persist(storage,actorId,result);} catch { /* The original pre-dispatch intent still recovers a committed request. */ }
  return result;
}
export function clearDocumentIntent(storage,actorId,intent) {
  actor(intent,actorId);
  const current=readDocumentIntent(storage,actorId);
  if(!current || current.key!==intent.key || !['completed','rejected'].includes(current.status)) throw new Error('Recover this document request before starting another.');
  storage.removeItem(documentStorageKey(actorId));
  if(storage.getItem(documentStorageKey(actorId)))throw new Error('Document recovery data could not be cleared.');
}
export function safeDocumentFilename(name) {
  return typeof name==='string' && /^[a-z0-9][a-z0-9_-]{0,100}\.pdf$/i.test(name) && !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])\.pdf$/i.test(name) ? name : 'document.pdf';
}
