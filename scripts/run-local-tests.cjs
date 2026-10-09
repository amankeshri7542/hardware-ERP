// Start application/test code only after the local-only network policy is preloaded.
const { spawn } = require('node:child_process');
const path = require('node:path');
const preload = path.join(__dirname, 'local-only-network.cjs');
const child = spawn(process.execPath, process.argv.slice(2), {
  stdio: 'inherit',
  env: { ...process.env, NODE_OPTIONS: `${process.env.NODE_OPTIONS || ''} --require=${JSON.stringify(preload)}`.trim() },
});
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code;
});
