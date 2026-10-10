const { fail } = require('../../utils/financial');
const { preparePayment } = require('../payments/paymentPosting');
const reporting = require('../settlements/reporting');
const MAX_ROWS = 300;
function literal(value, maximum = 2000) {
  if (value === null || value === undefined || value === '') return 'Unknown / not supplied';
  if (typeof value !== 'string' || value.length > maximum || Array.from(value).some(char => {const code=char.codePointAt(0);return (code<32&&!'\t\n\r'.includes(char))||code===127||(code>=8234&&code<=8238)||(code>=8294&&code<=8297);})) fail('DOCUMENT_CONTENT_INVALID');
  return value;
}
function money(value) { if (typeof value !== 'string' || !/^-?\d{1,13}\.\d{2}$/.test(value)) fail('DOCUMENT_MONEY_INVALID'); return '₹ ' + value; }
function party(value) {
  if (!value || typeof value.name !== 'string' || !value.name.trim()) fail('DOCUMENT_PARTY_SNAPSHOT_REQUIRED');
  return { name:literal(value.name,240), address:literal(value.address,800), tax_id:literal(value.gstin,100) };
}
function shape(type, number, issued_on, seller, customer, generated_at) {
  return { schema_version:1, type, number:literal(number,100), issued_on, generated_at, seller, customer,
    facts:[], columns:[], rows:[], totals:[], notices:['Synthetic local document. Not accountant-certified.'] };
}
async function invoiceDto(client,id,seller) {
  const { rows:[row] }=await client.query(`SELECT id,invoice_no,date::text,document_kind,original_invoice_id,customer_snapshot,subtotal,discount_total,taxable_total,gst_total,grand_total,created_at FROM invoices WHERE id=$1`,[id]);
  if (!row) fail('DOCUMENT_SOURCE_NOT_FOUND',404);
  if (!['sale','sales_return'].includes(row.document_kind)) fail('DOCUMENT_SOURCE_UNSUPPORTED');
  try { await require('../../utils/invoiceReconciliation').requireReconciledInvoice(client,row.original_invoice_id||id); } catch(error) { if(!error.errorCode) throw error; fail('DOCUMENT_SOURCE_RECONCILIATION_REQUIRED'); }
  const {rows:items}=await client.query(`SELECT product_name_snapshot,hsn_snapshot,qty,unit,rate,discount_pct,discount_amount,allocated_discount_total,taxable_amount,gst_pct,gst_amount,line_total,base_qty,base_unit_snapshot FROM invoice_items WHERE invoice_id=$1 ORDER BY id LIMIT 301`,[id]);
  if (!items.length || items.length>MAX_ROWS) fail('DOCUMENT_CONTENT_LIMIT');
  const dto=shape(row.document_kind==='sale'?'sale':'sales_credit',row.invoice_no,row.date,seller,party(row.customer_snapshot),row.created_at.toISOString());
  if (row.original_invoice_id) { const {rows:[original]}=await client.query('SELECT invoice_no FROM invoices WHERE id=$1',[row.original_invoice_id]); dto.facts.push({label:'Original sale',value:literal(original?.invoice_no,100)}); }
  dto.facts.push({label:'Value basis',value:'Original issued facts; current payments and allocations are shown separately in statements.'});
  dto.columns=[['item','Item / HSN'],['quantity','Selected quantity / base stock'],['rate','Rate per selected unit'],['discount',row.document_kind==='sales_return'?'Allocated discount':'Discount per selected unit'],['tax','Tax'],['total','Line total']].map(([key,label],i)=>({key,label,align:i<2?'left':'right'}));
  dto.rows=items.map(item=>{
    if (!item.unit || !item.base_unit_snapshot || !item.base_qty || !item.product_name_snapshot || item.hsn_snapshot===null) fail('DOCUMENT_ITEM_SNAPSHOT_REQUIRED');
    return {cells:[literal(item.product_name_snapshot,1000)+' / '+literal(item.hsn_snapshot,100), literal(item.qty,30)+' '+literal(item.unit,100)+' / '+literal(item.base_qty,30)+' '+literal(item.base_unit_snapshot,100),money(item.rate),money(row.document_kind==='sales_return'?item.allocated_discount_total:item.discount_amount)+' ('+literal(item.discount_pct,20)+'%)',money(item.gst_amount)+' ('+literal(item.gst_pct,20)+'%)',money(item.line_total)]};
  });
  dto.totals=[['Subtotal',row.subtotal],['Discount',row.discount_total],['Taxable total',row.taxable_total],['Tax',row.gst_total],[row.document_kind==='sale'?'Original sale total':'Original credit note total',row.grand_total]].map(([label,value])=>({label,value:money(value)}));
  return dto;
}
async function receiptDto(client,id,seller) {
  const {rows:[row]}=await client.query(`SELECT p.id,p.customer_id,p.created_by,p.reference_no,p.invoice_id,p.amount,p.mode,p.payment_date::text,p.customer_snapshot,p.created_at,i.invoice_no FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.id=$1`,[id]);
  if (!row) fail('DOCUMENT_SOURCE_NOT_FOUND',404);
  let tenders; try { tenders=await require('../settlements/customerEvidence').verifyReceipt(client,row); } catch(error) { if(!error.errorCode) throw error; fail('DOCUMENT_RECEIPT_RECONCILIATION_REQUIRED'); }
  let verified; try { verified=preparePayment({amount:row.amount,modes:tenders}); } catch { fail('DOCUMENT_RECEIPT_RECONCILIATION_REQUIRED'); }
  if (verified.mode!==row.mode) fail('DOCUMENT_RECEIPT_RECONCILIATION_REQUIRED');
  const dto=shape('receipt','RECEIPT-'+id,row.payment_date,seller,party(row.customer_snapshot),row.created_at.toISOString());
  dto.facts=[{label:'Receipt purpose',value:row.invoice_id?'Receipt against '+literal(row.invoice_no,100):'Customer advance received'}, {label:'Confirmation',value:'Operator-recorded receipt; not independently bank/provider verified.'}];
  dto.columns=[{key:'mode',label:'Concrete tender',align:'left'},{key:'reference',label:'Operator reference',align:'left'},{key:'amount',label:'Received',align:'right'}];
  dto.rows=tenders.map(t=>({cells:[literal(t.mode,20),literal(t.reference_no,100),money(t.amount)]}));
  dto.totals=[{label:'Original amount received',value:money(row.amount)}]; return dto;
}
async function statementDto(client,id,options,seller) {
  const data=await reporting.customerDataset(client,id,options,true);
  if (data.reconciliation_required) fail('DOCUMENT_STATEMENT_RECONCILIATION_REQUIRED');
  if (data.rows.length>MAX_ROWS) fail('DOCUMENT_CONTENT_LIMIT');
  const timing=(await client.query('SELECT transaction_timestamp() AS began,clock_timestamp() AS generated')).rows[0];
  const generated=timing.generated.toISOString();
  const dto=shape('customer_statement','STATEMENT-'+id,options.as_of,seller,party(data.party),generated);
  dto.facts=[{label:'From',value:options.from||'Full history'},{label:'Through',value:options.to},{label:'As of business date',value:options.as_of},{label:'Snapshot transaction began',value:timing.began.toISOString()},{label:'Ordering',value:'Business date, recorded timestamp, stable source order. Running balances include history before this range.'}];
  dto.columns=[['date','Date'],['kind','Entry'],['debit','Debit'],['credit','Credit'],['balance','Running balance']].map(([key,label],i)=>({key,label,align:i<2?'left':'right'}));
  dto.rows=data.rows.map(row=>({cells:[row.date,literal(row.kind,100)+' '+literal(row.source_type,50)+' #'+row.source_id,money(row.debit),money(row.credit),money(row.running_balance)]}));
  dto.totals=[['Opening balance',data.opening_balance],['Period debit',data.summary.debit],['Period credit',data.summary.credit],['Closing account balance',data.closing_balance],['Outstanding invoices',data.aging.total_due],['Available customer credit',data.aging.available_credit]].map(([label,value])=>({label,value:money(value)}));
  dto.notices.push('Rows reflect the repeatable-read database snapshot established at its first read; concurrent later commits are excluded. Business as-of is separate.');
  dto.notices.push('Current customer contact identity captured at generation; issued entry identities remain in the source records. Statement is an as-of view, not a reissued sale or receipt.'); return dto;
}
function preflight(content) {
  for(const party of [content.seller,content.customer]) {literal(party.name,240);literal(party.address,800);literal(party.tax_id,120);}
  for(const value of [content.number,content.issued_on,content.generated_at]) literal(value,120);
  for(const entry of [...content.facts,...content.totals]) {literal(entry.label,120);literal(entry.value,600);}
  for(const column of content.columns) {literal(column.key,50);literal(column.label,80);}
  if(content.rows.length>MAX_ROWS) fail('DOCUMENT_CONTENT_LIMIT');
  for(const row of content.rows) for(const cell of row.cells) literal(cell,600);
  for(const notice of content.notices) literal(notice,800);
  return content;
}
module.exports={invoiceDto,receiptDto,statementDto,preflight};
