const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const { execFileSync, spawn } = require('node:child_process');

async function port() {
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const value = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return value;
}
function get(client, options) {
  return new Promise((resolve, reject) => {
    client.get(options, response => {
      let body=''; response.setEncoding('utf8'); response.on('data', chunk => { body+=chunk; });
      response.on('end', () => resolve({ status: response.statusCode, headers: response.headers, body }));
    }).on('error', reject);
  });
}
test('real nginx redirects HTTP and serves SPA routes with document security headers', async () => {
  const root = path.resolve(__dirname, '..');
  assert.ok(fs.existsSync(path.join(root, 'frontend/dist/index.html')), 'Build frontend first');
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'erp-nginx-test-'));
  const plainPort=await port(), tlsPort=await port();
  let child;
  try {
    execFileSync('openssl', ['req','-x509','-newkey','rsa:2048','-nodes','-keyout',`${temp}/key.pem`,'-out',`${temp}/cert.pem`,'-days','1','-subj','/CN=localhost','-addext','subjectAltName=DNS:localhost'], { stdio: 'ignore' });
    const config = fs.readFileSync(path.join(root, 'deploy/nginx.conf'), 'utf8')
      .replace('listen 80 default_server', `listen 127.0.0.1:${plainPort} default_server`)
      .replace('listen 443 ssl', `listen 127.0.0.1:${tlsPort} ssl`)
      .replace('/run/certs/tls.crt', `${temp}/cert.pem`).replace('/run/certs/tls.key', `${temp}/key.pem`)
      .replace('/srv/hardware-erp/frontend/dist', path.join(root,'frontend/dist'));
    fs.writeFileSync(`${temp}/nginx.conf`, `pid ${temp}/nginx.pid; error_log ${temp}/error.log; events {} http { access_log off; types { text/html html; application/javascript js; text/css css; } ${config} }`);
    const binary=process.env.NGINX_BIN || 'nginx';
    execFileSync(binary, ['-p',temp,'-c',`${temp}/nginx.conf`,'-t'], { stdio: 'pipe' });
    child=spawn(binary, ['-p',temp,'-c',`${temp}/nginx.conf`,'-g','daemon off; master_process off;'], { stdio: 'ignore' });
    child.on('error', () => {});
    const options={ host:'127.0.0.1', port:tlsPort, servername:'localhost', ca:fs.readFileSync(`${temp}/cert.pem`) };
    let ready=false;
    for (let attempt=0; attempt<100; attempt++) {
      try { await get(https,{...options,path:'/'}); ready=true; break; }
      catch { await new Promise(resolve=>setTimeout(resolve,20)); }
    }
    assert.ok(ready, 'nginx started');
    const redirect=await get(http,{host:'127.0.0.1',port:plainPort,path:'/private/path?x=1',headers:{Host:'localhost'}});
    assert.equal(redirect.status,308);
    assert.equal(redirect.headers.location,'https://localhost/private/path?x=1');
    for (const route of ['/','/index.html','/invoices/123']) {
      const response=await get(https,{...options,path:route});
      assert.equal(response.status,200);
      assert.match(response.body,/<div id="root">/);
      assert.equal(response.headers['x-content-type-options'],'nosniff');
      assert.equal(response.headers['x-frame-options'],'DENY');
      assert.match(response.headers['strict-transport-security'],/max-age=31536000/);
      assert.match(response.headers['content-security-policy'],/script-src 'self'/);
      assert.match(response.headers['content-security-policy'],/frame-ancestors 'none'/);
      assert.equal(response.headers['referrer-policy'],'no-referrer');
    }
  } finally {
    if (child && child.exitCode === null) { child.kill('SIGQUIT'); await new Promise(resolve=>child.once('exit',resolve)); }
    fs.rmSync(temp,{recursive:true,force:true});
  }
});
