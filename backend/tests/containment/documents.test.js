const { test } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { generateInvoicePDF, renderInvoiceHtml } = require('../../src/utils/pdf');

for (const template of ['invoice-a4', 'invoice-thermal']) {
  test(`${template}: untrusted placeholder-like text is never reparsed`, () => {
    const html = renderInvoiceHtml({ customer_name: 'customer-{{ITEM_ROWS}}-end',
      items: [{ product_name: 'product-{{ITEM_ROWS}}-end', quantity: 1, unit: 'piece' }],
    }, { template });
    assert.equal(html.includes('customer-{{ITEM_ROWS}}-end'), true);
    assert.equal(html.includes('product-{{ITEM_ROWS}}-end'), true);
  });
  test(`${template}: invoice text is literal, including HTML and template-looking text`, () => {
    const literal = '<img src="http://127.0.0.1:9/canary"> & {{storeName}} $&';
    const html = renderInvoiceHtml({
      invoice_no: 'SYNTHETIC-1', customer_name: literal, store_name: 'STORE',
      items: [{ product_name: literal, unit: '<svg/onload=alert(1)>', quantity: 1, rate: 1, total: 1 }],
    }, { template });
    assert.equal(html.includes('<img'), false);
    assert.equal(html.includes('<svg'), false);
    assert.equal(html.includes('&lt;img src=&quot;http://127.0.0.1:9/canary&quot;&gt; &amp; {{storeName}} $&'), true);
    assert.equal(html.includes('&lt;svg/onload=alert(1)&gt;'), true);
  });
}

test('template selection is an exact allowlist', () => {
  assert.throws(() => renderInvoiceHtml({}, { template: '../config/db' }), /Unknown invoice template/);
});

test('all callable rendering/storage/queue paths fail closed without network requests', async () => {
  let requests = 0;
  const canary = http.createServer((req, res) => { requests++; res.end('canary'); });
  await new Promise(resolve => canary.listen(0, '127.0.0.1', resolve));
  try {
    const payload = `<img src="http://127.0.0.1:${canary.address().port}/canary">`;
    await assert.rejects(generateInvoicePDF({ customer_name: payload }), { errorCode: 'PDF_DISABLED', statusCode: 503 });
    await assert.rejects(require('../../src/queues/pdfQueue').addPdfJob(1), { errorCode: 'PDF_DISABLED' });
    await assert.rejects(require('../../src/utils/s3').uploadInvoicePDF(payload, Buffer.from('test')), { errorCode: 'PDF_DISABLED' });
    await assert.rejects(require('../../src/utils/s3').getPresignedUrl('local:///etc/passwd'), { errorCode: 'ATTACHMENTS_DISABLED' });
    assert.equal(require('../../src/workers/pdfWorker').status, 'disabled');
    assert.equal(requests, 0);
  } finally {
    await new Promise(resolve => canary.close(resolve));
  }
});
