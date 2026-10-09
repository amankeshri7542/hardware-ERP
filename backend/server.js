const fs = require('fs');
const path = require('path');
const dotenv = require('dotenv');

const localEnv = path.resolve(__dirname, '.env.local');
dotenv.config({
  path: process.env.NODE_ENV !== 'production' && fs.existsSync(localEnv) ? localEnv : path.resolve(__dirname, '.env'),
});

const { validateEnvironment } = require('./src/config/env');
const { securityLog } = require('./src/utils/securityLog');

async function start() {
  validateEnvironment();
  const app = require('./src/app');
  const { testConnection } = require('./src/config/db');
  await testConnection();
  const port = process.env.PORT || 4000;
  app.listen(port, () => securityLog('server.started'));
}

start().catch(() => {
  securityLog('server.start_failed', { status: 500 });
  process.exitCode = 1;
});
