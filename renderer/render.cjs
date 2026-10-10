"use strict";
const PDFDocument = require('pdfkit');
const path = require('node:path');
const MAX_INPUT = 256 * 1024;
const MAX_OUTPUT = 8 * 1024 * 1024;
const MAX_PAGES = 40;
const fontPath = path.join(__dirname, 'fonts/NotoSansDevanagari.ttf');
const font = require('fontkit').openSync(fontPath);
function invalid() { const error = new Error('DOCUMENT_INPUT_INVALID'); error.code = error.message; throw error; }
function keys(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) invalid();
}
function text(value, max = 512) {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value)) invalid();
  for (const character of value) if (!/[\n\r\t]/.test(character) && !font.hasGlyphForCodePoint(character.codePointAt(0))) throw new Error('DOCUMENT_GLYPH_UNSUPPORTED');
}
function entries(value, max, check) { if (!Array.isArray(value) || value.length > max) invalid(); value.forEach(check); }
function validate(dto, layout) {
  if (!['a4', 'thermal80'].includes(layout)) invalid();
  keys(dto, ['schema_version', 'type', 'number', 'issued_on', 'generated_at', 'seller', 'customer', 'facts', 'columns', 'rows', 'totals', 'notices']);
  if (dto.schema_version !== 1 || !['sale', 'sales_credit', 'receipt', 'customer_statement'].includes(dto.type)) invalid();
  if (layout === 'thermal80' && !['sale', 'receipt'].includes(dto.type)) invalid();
  ['number', 'issued_on', 'generated_at'].forEach(key => text(dto[key], 120));
  for (const party of [dto.seller, dto.customer]) {
    keys(party, ['name', 'address', 'tax_id']);
    text(party.name, 240); text(party.address, 800); text(party.tax_id, 120);
  }
  for (const list of [dto.facts, dto.totals]) entries(list, 20, item => { keys(item, ['label', 'value']); text(item.label, 120); text(item.value, 600); });
  entries(dto.columns, 8, item => { keys(item, ['key', 'label', 'align']); text(item.key, 50); text(item.label, 80); if (!['left', 'right'].includes(item.align)) invalid(); });
  if (!dto.columns.length || new Set(dto.columns.map(c => c.key)).size !== dto.columns.length) invalid();
  entries(dto.rows, 300, item => { keys(item, ['cells']); entries(item.cells, 8, value => text(value, 600)); if (item.cells.length !== dto.columns.length) invalid(); });
  entries(dto.notices, 12, value => text(value, 800));
  if (Buffer.byteLength(JSON.stringify(dto)) > MAX_INPUT) invalid();
  return dto;
}
async function render(dto, { layout = 'a4' } = {}) {
  validate(dto, layout);
  const thermal = layout === 'thermal80';
  const margin = thermal ? 12 : 36;
  const doc = new PDFDocument({ autoFirstPage: false, compress: true, bufferPages: true,
    info: { Title: `ERP ${dto.type} ${dto.number}`, Author: dto.seller.name, Creator: 'Hardware ERP snapshot renderer v1',
      CreationDate: new Date('2000-01-01T00:00:00Z'), ModDate: new Date('2000-01-01T00:00:00Z') } });
  doc.registerFont('Bundled', fontPath);
  let page = 0; let y = 0;
  let length = 0; const chunks = [];
  const result = new Promise((resolve, reject) => {
    doc.on('data', buffer => { length += buffer.length; if (length > MAX_OUTPUT) doc.destroy(new Error('DOCUMENT_OUTPUT_LIMIT')); else chunks.push(buffer); });
    doc.on('error', reject); doc.on('end', () => resolve(Buffer.concat(chunks)));
  });
  const title = {sale:'Issued sale', sales_credit:'Sales-return credit note', receipt:'Customer receipt', customer_statement:'Customer statement'}[dto.type];
  const addPage = () => {
    if (++page > MAX_PAGES) throw new Error('DOCUMENT_PAGE_LIMIT');
    doc.addPage({ size: thermal ? [226.772, 841.89] : 'A4', margin });
    doc.font('Bundled').fontSize(thermal ? 9 : 10);
    y = margin;
  };
  addPage();
  const width = doc.page.width - margin * 2;
  const bottom = () => doc.page.height - margin - 24;
  const height = (value, size, w = width) => { doc.fontSize(size); return doc.heightOfString(value, { width:w, lineGap:2 }); };
  const block = (value, {size = thermal ? 9 : 10, align = 'left', gap = 5} = {}) => {
    const h = height(value, size);
    if (h > bottom() - margin) throw new Error('DOCUMENT_TEXT_LIMIT');
    if (y + h > bottom()) addPage();
    doc.fontSize(size).fillColor('#111111').text(value, margin, y, {width, align, lineGap:2}); y += h + gap;
  };
  block(dto.seller.name, {size:thermal ? 13 : 17}); block(dto.seller.address);
  block(`Seller tax identity: ${dto.seller.tax_id}`);
  block(title, {size:thermal ? 12 : 15});
  block(`${dto.number} | ${dto.issued_on}`);
  block(`Customer: ${dto.customer.name}`); block(dto.customer.address); block(`Customer tax identity: ${dto.customer.tax_id}`);
  dto.facts.forEach(item => block(`${item.label}: ${item.value}`));
  const rule = () => { doc.moveTo(margin, y).lineTo(margin + width, y).strokeColor('#777777').stroke(); y += 7; };
  rule();
  if (thermal) {
    for (const row of dto.rows) {
      row.cells.forEach((cell, index) => block(`${dto.columns[index].label}: ${cell}`, {align:dto.columns[index].align, gap:3}));
      rule();
    }
  } else {
    const weights = dto.columns.map((column, index) => index === 0 ? 2.8 : column.align === 'left' ? 1.5 : 1);
    const totalWeight = weights.reduce((a,b) => a+b,0);
    const widths = weights.map(weight => width * weight / totalWeight);
    const rowHeight = cells => Math.max(...cells.map((cell,index) => height(cell,9,widths[index]-8))) + 12;
    const headerCells = dto.columns.map(column => column.label);
    const headerHeight = rowHeight(headerCells);
    const drawRow = (cells, isHeader = false) => {
      const h = rowHeight(cells);
      if (h + (isHeader ? 0 : headerHeight) > bottom()-margin) throw new Error('DOCUMENT_TEXT_LIMIT');
      if (y+h>bottom()) { addPage(); if (!isHeader) drawRow(headerCells,true); }
      let x=margin;
      cells.forEach((cell,index) => { doc.fontSize(9).fillColor(isHeader?'#444444':'#111111').text(cell,x+4,y+4,{width:widths[index]-8,align:dto.columns[index].align,lineGap:2}); x+=widths[index]; });
      y+=h; doc.moveTo(margin,y).lineTo(margin+width,y).strokeColor('#dddddd').stroke();
    };
    drawRow(headerCells,true); dto.rows.forEach(row=>drawRow(row.cells)); y+=10;
  }
  dto.totals.forEach(item => block(`${item.label}: ${item.value}`,{align:'right',size:thermal?10:11}));
  dto.notices.forEach(notice=>block(notice,{size:8}));
  block(`Generated: ${dto.generated_at}`,{size:8});
  const pages=doc.bufferedPageRange();
  for(let i=0;i<pages.count;i++) {
    doc.switchToPage(i); doc.fontSize(8).fillColor('#555555').text(`Page ${i+1} / ${pages.count}`,margin,doc.page.height-margin-12,{width,align:'right',lineBreak:false});
  }
  doc.end(); return result;
}
module.exports = { render, validate, MAX_INPUT, MAX_OUTPUT };
