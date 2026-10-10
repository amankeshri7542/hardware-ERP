// Synthetic local coordinator only; the renderer receives no database/session environment.
const { Pool } = require('pg');
const { requireEnabled } = require('./src/modules/documents/config');
const jobs = require('./src/modules/documents/jobs');
const artifacts = require('./src/modules/documents/artifacts');
const { renderIsolated } = require('./src/modules/documents/renderProcess');
async function main() {
 requireEnabled();
 if (!globalThis.__ERP_LOCAL_NETWORK_GUARD__ || !['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST) || !/_test$/.test(process.env.DB_NAME || '')) throw new Error('DOCUMENT_WORKER_LOCAL_TEST_REQUIRED');
 if (!process.env.DOCUMENT_DB_USER || !process.env.DOCUMENT_DB_PASSWORD || process.env.DOCUMENT_DB_USER === process.env.DB_USER) throw new Error('DOCUMENT_WORKER_ROLE_REQUIRED');
 if (process.argv.length !== 3 || !['--once','--cleanup'].includes(process.argv[2])) throw new Error('DOCUMENT_WORKER_COMMAND_REQUIRED');
 const pool = new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.DOCUMENT_DB_USER,password:process.env.DOCUMENT_DB_PASSWORD,ssl:false,max:1});
 try {
   if (process.argv[2] === '--cleanup') {
     const client = await pool.connect();
     try {
       await client.query('SELECT pg_advisory_lock(50502,1)');
       const {rows} = await client.query('SELECT artifact_key FROM document_jobs WHERE artifact_key IS NOT NULL');
       const removed = await artifacts.removeOrphans(rows.map(row => row.artifact_key));
       console.log(JSON.stringify({removed:removed.length}));
     } finally {
       try { await client.query('SELECT pg_advisory_unlock(50502,1)'); }
       finally { client.release(); }
     }
   } else {
     const result = await jobs.processOne({pool,render:renderIsolated,artifacts});
     console.log(JSON.stringify({processed:Boolean(result),result}));
   }
 } finally { await pool.end(); }
}
main().catch(() => { console.error('DOCUMENT_WORKER_FAILED'); process.exitCode=1; });
