// Test-process preload: install before application imports; inherited through NODE_OPTIONS.
const net = require('node:net');
const dns = require('node:dns');
const dgram = require('node:dgram');
const { syncBuiltinESMExports } = require('node:module');

function denied() {
  const error = new Error('Test network policy permits loopback TCP only');
  error.code = 'TEST_NETWORK_DENIED';
  throw error;
}
function local(host) {
  return typeof host === 'string' && ['127.0.0.1', '::1', 'localhost', '::ffff:127.0.0.1'].includes(host.toLowerCase());
}
function lookup(host, options, callback) {
  if (!local(host)) return denied();
  if (typeof options === 'function') { callback = options; options = {}; }
  const family = options === 6 || options?.family === 6 || host.includes(':') ? 6 : 4;
  const address = family === 6 ? '::1' : '127.0.0.1';
  process.nextTick(() => options?.all ? callback(null, [{ address, family }]) : callback(null, address, family));
}
const connect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  if (Array.isArray(args[0])) args = args[0];
  let options;
  let callback;
  if (args[0] && typeof args[0] === 'object') {
    options = { ...args[0] }; callback = args[1];
  } else {
    if (typeof args[0] === 'string' && !/^\d+$/.test(args[0])) return denied();
    options = { port: args[0], host: typeof args[1] === 'string' ? args[1] : 'localhost' };
    callback = typeof args[1] === 'function' ? args[1] : args[2];
  }
  if (options.path || options.fd !== undefined || !local(options.host || 'localhost')) return denied();
  // A caller-supplied lookup must not turn an allowed localhost name into a remote address.
  options.lookup = lookup;
  return connect.call(this, options, callback);
};
dns.lookup = lookup;
dns.promises.lookup = (host, options = {}) => new Promise((resolve, reject) => {
  try { lookup(host, options, (error, address, family) => error ? reject(error) : resolve(options.all ? address : { address, family })); }
  catch (error) { reject(error); }
});
for (const target of [dns, dns.Resolver.prototype]) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (/^(resolve|reverse|lookupService)/.test(name)) target[name] = denied;
  }
}
for (const target of [dns.promises, dns.promises.Resolver.prototype]) {
  for (const name of Object.getOwnPropertyNames(target)) {
    if (/^(resolve|reverse|lookupService)/.test(name)) target[name] = async () => denied();
  }
}
dgram.createSocket = denied;
syncBuiltinESMExports();
Object.defineProperty(globalThis, '__ERP_LOCAL_NETWORK_GUARD__', { value: true, configurable: false });
