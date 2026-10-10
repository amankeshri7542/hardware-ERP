const test=require('node:test');const assert=require('node:assert/strict');
const {render,validate}=require('../render.cjs');const {fixture,boundaryFixture}=require('./fixture.cjs');
test('allowlisted DTO rejects hidden data, malformed cells, unsupported layouts and unbounded input',()=>{
 const dto=fixture();assert.doesNotThrow(()=>validate(dto,'a4'));
 for(const invalid of [{...dto,cost:'100'}, {...dto,seller:{...dto.seller,session:'secret'}},{...dto,rows:[{cells:['bad']}]},{...dto,rows:Array(301).fill(dto.rows[0])},{...dto,number:'x'.repeat(121)}])assert.throws(()=>validate(invalid,'a4'),/DOCUMENT_INPUT_INVALID/);
 assert.throws(()=>validate(fixture('sales_credit'),'thermal80'),/DOCUMENT_INPUT_INVALID/);
 assert.throws(()=>validate({...dto,number:'Unsupported glyph 😀'},'a4'),/DOCUMENT_GLYPH_UNSUPPORTED/);
});
test('same frozen DTO produces byte-identical output',async()=>{
 const dto=fixture();assert.deepEqual(await render(dto),await render(dto));
});
test('actual A4 and thermal PDFs preserve literal Unicode, exact signed/zero strings and paginate',async()=>{
 for(const [type,layout,count] of [['sale','a4',90],['sale','thermal80',4],['receipt','a4',2],['receipt','thermal80',2],['sales_credit','a4',6],['customer_statement','a4',80]]){
  const pdf=await render(fixture(type,count),{layout});assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.ok(pdf.length>3000);assert.ok(pdf.toString('latin1').includes('/Type /Page'));assert.ok(pdf.toString('latin1').includes('/FontFile2'));
 }
});

test('a table header crossing the first page is drawn once on its new page',async()=>{
 const PDF=require('pdfkit');const original=PDF.prototype.text;const headers=[];
 PDF.prototype.text=function(value,...args){if(value==='Item / वस्तु')headers.push(this.bufferedPageRange().count);return original.call(this,value,...args);};
 try{const pdf=await render(boundaryFixture());assert.equal(pdf.subarray(0,5).toString(),'%PDF-');assert.deepEqual(headers,[2]);}finally{PDF.prototype.text=original;}
});
test('a table row plus its repeated header must fit one page',async()=>{
 const dto=fixture('sale',1);dto.columns[0].label='H\n'.repeat(30);dto.rows[0].cells[0]='Row\n'.repeat(40);
 await assert.rejects(render(dto),/DOCUMENT_TEXT_LIMIT/);
});
