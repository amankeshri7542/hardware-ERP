const { validateEnvironment } = require('./src/config/env');
validateEnvironment();
console.log(JSON.stringify({ event: 'worker_disabled', code: 'PDF_DISABLED' }));
