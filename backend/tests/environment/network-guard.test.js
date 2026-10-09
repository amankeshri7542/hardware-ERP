const { test } = require('node:test');
const assert = require('node:assert/strict');
const net = require('node:net');
const http = require('node:http');
const https = require('node:https');
const tls = require('node:tls');
const dns = require('node:dns');
const dgram = require('node:dgram');
const { spawnSync } = require('node:child_process');

test('preloaded network policy blocks nonlocal TCP, TLS, HTTP, fetch, DNS and UDP before connection', async () => {
  assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true, 'Start tests with NODE_OPTIONS=--require=<absolute guard path>');
  const blocked = (error) => error.code === 'TEST_NETWORK_DENIED';
  assert.throws(() => net.connect({ host: '192.0.2.1', port: 80 }), blocked);
  assert.throws(() => tls.connect({ host: 'service.invalid', port: 443 }), blocked);
  assert.throws(() => http.get('http://service.invalid/'), blocked);
  assert.throws(() => https.get('https://service.invalid/'), blocked);
  await assert.rejects(fetch('http://service.invalid/'), (error) => blocked(error.cause));
  assert.throws(() => dns.lookup('service.invalid', () => {}), blocked);
  await assert.rejects(dns.promises.lookup('service.invalid'), blocked);
  assert.throws(() => dns.resolve4('service.invalid', () => {}), blocked);
  assert.throws(() => new dns.Resolver().resolve4('service.invalid', () => {}), blocked);
  assert.throws(() => dgram.createSocket('udp4'), blocked);
  const child = spawnSync(process.execPath, ['-e', "require('node:net').connect({host:'192.0.2.1',port:80})"], { env: process.env, encoding: 'utf8' });
  assert.equal(child.status, 1);
  assert.match(child.stderr, /TEST_NETWORK_DENIED/);
});

test('loopback HTTP works and an external redirect is rejected without following it', async () => {
  const server = http.createServer((req, res) => {
    if (req.url === '/redirect') { res.writeHead(302, { Location: 'http://service.invalid/' }); res.end(); }
    else res.end('local canary');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const base = `http://127.0.0.1:${server.address().port}`;
    assert.equal(await (await fetch(base)).text(), 'local canary');
    await assert.rejects(fetch(`${base}/redirect`), (error) => error.cause?.code === 'TEST_NETWORK_DENIED');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
