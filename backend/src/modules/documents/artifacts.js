const fs = require('node:fs/promises');
const { constants } = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const MAX_BYTES = 8 * 1024 * 1024;
const opaque = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
function error(code) { return Object.assign(new Error(code), { code, status:503 }); }
async function root() {
  if (process.env.NODE_ENV !== 'test' || process.env.DOCUMENT_RUNTIME_MODE !== 'synthetic-local') throw error('DOCUMENT_RUNTIME_DISABLED');
  const value = process.env.DOCUMENT_ARTIFACT_ROOT;
  if (!value || !path.isAbsolute(value) || path.resolve(value) !== value) throw error('DOCUMENT_STORAGE_UNSAFE');
  try { await fs.mkdir(value, {mode:0o700}); } catch (err) { if (err.code !== 'EEXIST') throw err; }
  const stat = await fs.lstat(value);
  if (!stat.isDirectory() || stat.isSymbolicLink() || stat.uid !== process.getuid() || (stat.mode & 0o077) || await fs.realpath(value) !== value) throw error('DOCUMENT_STORAGE_UNSAFE');
  return value;
}
async function store(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 20 || buffer.length > MAX_BYTES || buffer.subarray(0,5).toString() !== '%PDF-') throw error('DOCUMENT_ARTIFACT_INVALID');
  const dir = await root(); const key = crypto.randomUUID();
  const temporary = path.join(dir, `.${key}.stage`); const target = path.join(dir, `${key}.pdf`);
  let handle;
  try {
    handle = await fs.open(temporary, constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW, 0o600);
    await handle.writeFile(buffer); await handle.sync(); await handle.close(); handle = null;
    await fs.rename(temporary, target);
    const directory = await fs.open(dir, constants.O_RDONLY|constants.O_NOFOLLOW);
    try { await directory.sync(); } finally { await directory.close(); }
    return {key, sha256:crypto.createHash('sha256').update(buffer).digest('hex'), bytes:buffer.length};
  } catch (err) { if (handle) await handle.close(); await fs.unlink(temporary).catch(()=>{}); throw err; }
}
async function read(metadata) {
  if (!metadata || !opaque.test(metadata.key) || !/^[0-9a-f]{64}$/.test(metadata.sha256) || !Number.isInteger(metadata.bytes) || metadata.bytes < 20 || metadata.bytes > MAX_BYTES) throw error('DOCUMENT_ARTIFACT_CORRUPT');
  const dir=await root(); let handle;
  try {
    handle = await fs.open(path.join(dir,`${metadata.key}.pdf`),constants.O_RDONLY|constants.O_NOFOLLOW);
    const stat=await handle.stat();
    if (!stat.isFile() || stat.nlink !== 1 || stat.uid !== process.getuid() || (stat.mode&0o077) || stat.size !== metadata.bytes) throw error('DOCUMENT_ARTIFACT_CORRUPT');
    const buffer=await handle.readFile();
    if (buffer.length !== metadata.bytes || crypto.createHash('sha256').update(buffer).digest('hex') !== metadata.sha256 || buffer.subarray(0,5).toString() !== '%PDF-') throw error('DOCUMENT_ARTIFACT_CORRUPT');
    return buffer;
  } catch (err) {
    if (err.code==='ENOENT') throw error('DOCUMENT_ARTIFACT_MISSING');
    if (err.code==='ELOOP') throw error('DOCUMENT_ARTIFACT_CORRUPT');
    throw err;
  } finally { if(handle) await handle.close(); }
}
async function removeOrphans(liveIds, {olderThanMs=86400000, now=Date.now()}={}) {
  if (!Array.isArray(liveIds) || liveIds.some(id=>!opaque.test(id)) || !Number.isSafeInteger(olderThanMs) || olderThanMs<3600000 || !Number.isSafeInteger(now)) throw error('DOCUMENT_CLEANUP_INVALID');
  const live=new Set(liveIds); const dir=await root(); const removed=[];
  for(const name of await fs.readdir(dir)) {
    const key=name.endsWith('.pdf') ? name.slice(0,-4) : name.startsWith('.')&&name.endsWith('.stage') ? name.slice(1,-6) : null;
    if(!key || !opaque.test(key) || live.has(key)) continue;
    const file=path.join(dir,name); const stat=await fs.lstat(file);
    if(!stat.isFile() || stat.isSymbolicLink() || stat.uid!==process.getuid() || stat.nlink!==1 || (stat.mode&0o077) || now-stat.mtimeMs<olderThanMs) continue;
    await fs.unlink(file); removed.push(key);
  }
  return removed;
}
module.exports={store,read,removeOrphans};
