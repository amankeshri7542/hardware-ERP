const { fail: invalid } = require('../../utils/financial');
async function claim(pool,{id=null,leaseSeconds=90}={}) {
  if (!Number.isInteger(leaseSeconds)||leaseSeconds<1||leaseSeconds>300) invalid('DOCUMENT_LEASE_INVALID');
  await pool.query(`UPDATE document_jobs SET status='permanent_failure',error_code='DOCUMENT_RETRY_EXHAUSTED',lease_until=NULL,updated_at=clock_timestamp() WHERE status='running' AND lease_until<clock_timestamp() AND attempts>=3 AND ($1::uuid IS NULL OR id=$1)`,[id]);
  const {rows:[job]}=await pool.query(`WITH candidate AS (
      SELECT id FROM document_jobs WHERE attempts<3 AND ($1::uuid IS NULL OR id=$1)
      AND ((status='pending' AND (attempts=0 OR updated_at<=clock_timestamp()-make_interval(secs=>attempts*2))) OR (status='running' AND lease_until<clock_timestamp())) ORDER BY created_at,id FOR UPDATE SKIP LOCKED LIMIT 1
    ) UPDATE document_jobs j SET status='running',attempts=attempts+1,lease_token=lease_token+1,lease_until=clock_timestamp()+make_interval(secs=>$2),error_code=NULL,updated_at=clock_timestamp()
    FROM candidate c WHERE j.id=c.id RETURNING j.*`,[id,leaseSeconds]);
  if (!job) return null;
  const {rows:[source]}=await pool.query('SELECT dto,content_hash FROM document_sources WHERE id=$1',[job.source_snapshot_id]);
  return {...job,...source};
}
async function complete(pool,{id,lease_token,artifact_key,artifact_sha256,artifact_bytes}) {
  if (!/^[0-9a-f-]{36}$/i.test(artifact_key)||!/^[0-9a-f]{64}$/.test(artifact_sha256)||!Number.isInteger(artifact_bytes)||artifact_bytes<1||artifact_bytes>8388608) invalid('DOCUMENT_ARTIFACT_INVALID');
  const {rowCount}=await pool.query(`UPDATE document_jobs SET status='ready',published_at=COALESCE(published_at,clock_timestamp()),artifact_key=$3,artifact_sha256=$4,artifact_bytes=$5,lease_until=NULL,error_code=NULL,updated_at=clock_timestamp()
    WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>clock_timestamp() AND (artifact_sha256 IS NULL OR artifact_sha256=$4)`,[id,lease_token,artifact_key,artifact_sha256,artifact_bytes]);
  return rowCount===1;
}
async function fail(pool,{id,lease_token,error_code,retryable=true}) {
  const code=/^DOCUMENT_[A-Z_]{1,80}$/.test(error_code||'')?error_code:'DOCUMENT_RENDER_FAILED';
  const {rowCount}=await pool.query(`UPDATE document_jobs SET status=CASE WHEN $4 AND attempts<3 THEN 'retryable_failure' ELSE 'permanent_failure' END,error_code=$3,lease_until=NULL,updated_at=clock_timestamp() WHERE id=$1 AND lease_token=$2 AND status='running' AND lease_until>clock_timestamp()`,[id,lease_token,code,retryable]);
  return rowCount===1;
}
async function processOne({pool,render,artifacts,id}) {
  require('./config').requireEnabled();
  const job=await claim(pool,{id}); if (!job) return null;
  let publicationClient,locked=false;
  try {
    const bytes=await render(job.dto,{layout:job.layout});
    publicationClient=await pool.connect(); await publicationClient.query('SELECT pg_advisory_lock(50502,1)'); locked=true;
    const file=await artifacts.store(bytes);
    if(job.artifact_sha256 && job.artifact_sha256!==file.sha256) { await fail(publicationClient,{...job,error_code:'DOCUMENT_ARTIFACT_REGENERATION_MISMATCH',retryable:false}); return {id:job.id,status:'permanent_failure'}; }
    const selected=await complete(publicationClient,{...job,artifact_key:file.key,artifact_sha256:file.sha256,artifact_bytes:file.bytes});
    return {id:job.id,status:selected?'ready':'stale_completion'};
  } catch(error) {
    await fail(publicationClient||pool,{...job,error_code:error.code||error.errorCode,retryable:!['DOCUMENT_CONTENT_INVALID','DOCUMENT_CONTENT_LIMIT','DOCUMENT_LAYOUT_UNSUPPORTED','DOCUMENT_DTO_INVALID','DOCUMENT_GLYPH_UNSUPPORTED','DOCUMENT_INPUT_INVALID','DOCUMENT_PAGE_LIMIT','DOCUMENT_TEXT_LIMIT','DOCUMENT_INPUT_LIMIT','DOCUMENT_OUTPUT_LIMIT'].includes(error.code||error.errorCode)});
    return {id:job.id,status:'failed'};
  } finally {
    if(publicationClient) { let broken=false; if(locked) {try {await publicationClient.query('SELECT pg_advisory_unlock(50502,1)');}catch{broken=true;}} publicationClient.release(broken); }
  }
}
module.exports={claim,complete,fail,processOne};
