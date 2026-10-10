const { spawn } = require('node:child_process');
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const renderer = path.resolve(__dirname, '../../../../renderer');
const guard = path.resolve(renderer, '../scripts/local-only-network.cjs');
const MAX_INPUT = 256*1024; const MAX_OUTPUT=8*1024*1024;
function failure(code) { return Object.assign(new Error(code),{code,status:503}); }
function assertEnabled() {
  if(process.env.NODE_ENV!=='test'||process.env.DOCUMENT_RUNTIME_MODE!=='synthetic-local') throw failure('DOCUMENT_RUNTIME_DISABLED');
}
function nativeProfile() {
  const literal=value=>JSON.stringify(fs.realpathSync(value));
  const readable=[renderer,path.dirname(process.execPath),'/System/Library','/usr/lib','/usr/share/zoneinfo'];
  return `(version 1) (deny default) (allow process-exec (literal ${literal(process.execPath)})) (allow signal (target self)) (allow sysctl-read) (allow file-read-metadata) (allow file-read* ${readable.map(value=>`(subpath ${literal(value)})`).join(' ')} (literal ${literal(guard)}) (literal "/") (literal "/dev/null") (literal "/dev/urandom") (literal "/dev/random"))`;
}
function command({probe=false,name}={}) {
  const driver=process.env.DOCUMENT_RENDERER_DRIVER;
  if(driver==='macos-sandbox' && process.platform==='darwin') {
    // CPU is an OS rlimit; V8 heap, bounded input/pages/output and deadline bound memory/work.
    return {executable:'/bin/sh',args:['-c','ulimit -t 10; exec "$@"','erp-render','/usr/bin/sandbox-exec','-p',nativeProfile(),process.execPath,'--max-old-space-size=96',path.join(renderer,probe?'isolation-probe.cjs':'cli.cjs')]};
  }
  if(driver==='docker') {
    const image=process.env.DOCUMENT_RENDERER_IMAGE||'hardware-erp-renderer:phase5b';
    if(!/^[a-z0-9][a-z0-9._:/@-]{0,190}$/.test(image)) throw failure('DOCUMENT_RENDERER_CONFIG_INVALID');
    return {executable:'docker',args:['run','--rm','--name',name,'--pull=never','--network=none','--read-only','--user=65532:65532','--cap-drop=ALL','--security-opt=no-new-privileges','--memory=256m','--memory-swap=256m','--cpus=1','--pids-limit=16','--ulimit=cpu=10:10','--ulimit=nofile=64:64','--log-driver=none','-i',image,...(probe?['node','--max-old-space-size=96','isolation-probe.cjs']:[])]};
  }
  throw failure('DOCUMENT_ISOLATION_UNAVAILABLE');
}
function run(input,{signal,timeoutMs=15000,probe=false}={}) {
  assertEnabled();
  if(!Buffer.isBuffer(input)||input.length>MAX_INPUT) return Promise.reject(failure('DOCUMENT_INPUT_LIMIT'));
  if(!Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>15000) return Promise.reject(failure('DOCUMENT_RENDERER_CONFIG_INVALID'));
  if(signal?.aborted) return Promise.reject(failure('DOCUMENT_RENDER_CANCELLED'));
  const name=`erp-render-${crypto.randomUUID()}`; const invocation=command({probe,name});
  return new Promise((resolve,reject)=>{
    const env={PATH:'/usr/local/bin:/usr/bin:/bin',LANG:'C.UTF-8',HOME:'/nonexistent',NODE_OPTIONS:`--require=${guard}`};
    const child=spawn(invocation.executable,invocation.args,{cwd:renderer,env,stdio:['pipe','pipe','pipe'],detached:process.platform!=='win32'});
    let size=0; let diagnostic=''; const chunks=[]; let settled=false; let endingError=null;
    const stop=code=>{if(endingError)return;endingError=failure(code);try{process.kill(-child.pid,'SIGKILL');}catch{child.kill('SIGKILL');}if(process.env.DOCUMENT_RENDERER_DRIVER==='docker')spawn('docker',['rm','-f',name],{env,stdio:'ignore'}).unref();};
    const timer=setTimeout(()=>stop('DOCUMENT_RENDER_TIMEOUT'),timeoutMs);
    const cancel=()=>stop('DOCUMENT_RENDER_CANCELLED'); signal?.addEventListener('abort',cancel,{once:true});
    const finish=(error,buffer)=>{if(settled)return;settled=true;clearTimeout(timer);signal?.removeEventListener('abort',cancel);error?reject(error):resolve(buffer);};
    child.on('error',()=>finish(failure('DOCUMENT_ISOLATION_UNAVAILABLE')));
    child.stdout.on('data',chunk=>{size+=chunk.length;if(size>MAX_OUTPUT)stop('DOCUMENT_OUTPUT_LIMIT');else chunks.push(chunk);});
    // Renderer diagnostics are deliberately fixed codes; never forward child source payloads.
    child.stderr.on('data',chunk=>{if(diagnostic.length<256)diagnostic+=chunk.toString().slice(0,256-diagnostic.length);}); child.stdin.on('error',()=>{});
    child.on('close',code=>{
      const allowed=['DOCUMENT_INPUT_INVALID','DOCUMENT_GLYPH_UNSUPPORTED','DOCUMENT_PAGE_LIMIT','DOCUMENT_TEXT_LIMIT','DOCUMENT_INPUT_LIMIT','DOCUMENT_OUTPUT_LIMIT'];
      const safeCode=allowed.includes(diagnostic.trim())?diagnostic.trim():'DOCUMENT_RENDER_FAILED';
      finish(endingError||(code!==0?failure(safeCode):null),Buffer.concat(chunks));
    });
    child.stdin.end(input);
  });
}
async function renderIsolated(dto,{layout='a4',signal}={}) {
  const output=await run(Buffer.from(JSON.stringify({dto,layout})),{signal});
  if(output.length<20||output.subarray(0,5).toString()!=='%PDF-')throw failure('DOCUMENT_RENDER_FAILED');
  return output;
}
module.exports={renderIsolated,run};
