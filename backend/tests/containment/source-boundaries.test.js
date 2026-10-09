const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const source = (name) => fs.readFileSync(path.join(__dirname, '../../src', name), 'utf8');

test('candidate contains no unsandboxed browser launch', () => {
  assert.equal(/--no-sandbox|--disable-setuid-sandbox|puppeteer\.launch/.test(source('utils/pdf.js')), false);
  assert.equal(/puppeteer|--no-sandbox/.test(source('modules/reports/exports.service.js')), false);
});

test('purchase attachment endpoint cannot parse multipart before containment', () => {
  assert.equal(/upload\.single|multer/.test(source('modules/purchases/purchases.router.js')), false);
});

test('storage selection does not infer a driver from presence of an AWS key', () => {
  assert.equal(/if\s*\([^)]*AWS_ACCESS_KEY_ID/.test(source('utils/s3.js')), false);
});

test('PM2 does not restart the intentionally disabled worker', () => {
  const { apps } = require('../../ecosystem.config');
  assert.deepEqual(apps.map(app => app.script), ['./server.js']);
});
