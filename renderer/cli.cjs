"use strict";
const { render, MAX_INPUT } = require('./render.cjs');
let bytes = 0; const chunks = [];
process.stdin.on('data', chunk => { bytes += chunk.length; if (bytes > MAX_INPUT) { process.stderr.write('DOCUMENT_INPUT_LIMIT\n'); process.exit(2); } chunks.push(chunk); });
process.stdin.on('end', async () => {
  try {
    const request = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!request || Object.keys(request).some(key => !['dto','layout'].includes(key))) throw new Error('DOCUMENT_INPUT_INVALID');
    process.stdout.write(await render(request.dto,{layout:request.layout}));
  } catch (error) {
    const allowed = ['DOCUMENT_INPUT_INVALID','DOCUMENT_GLYPH_UNSUPPORTED','DOCUMENT_PAGE_LIMIT','DOCUMENT_TEXT_LIMIT','DOCUMENT_OUTPUT_LIMIT'];
    process.stderr.write((allowed.includes(error.message) ? error.message : 'DOCUMENT_RENDER_FAILED')+'\n'); process.exitCode = 2;
  }
});
