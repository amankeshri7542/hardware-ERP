const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const { app, request, pool, setupActor, post, diagnoseResponse, fixtureProduct, fixtureCustomer, close } = require('../helpers/financial');
after(close);
async function get(path) { const actor = await setupActor(); return request(app).get(`/api${path}`).set('Cookie', actor.cookie); }
async function supplierHistory() {
  const actor = await setupActor(); const product = await fixtureProduct();
  const { rows: [supplier] } = await pool.query('INSERT INTO suppliers(name) VALUES($1) RETURNING *', [`=Synthetic supplier ${randomUUID()}`]);
  const receipt = await post('/purchases', { supplier_id: supplier.id, date: '2026-01-01', items: [{ product_id: product.id, qty: 4, unit: 'piece', cost_price: 25 }] });
  assert.equal(receipt.status, 201, 'Reporting fixture must use a successful modern receipt');
  const purchase = receipt.body.data.purchase;
  const { rows: [payable] } = await pool.query(`INSERT INTO supplier_payables(purchase_id,supplier_id,amount,date,due_date,document_reference,party_snapshot,created_by,reason) VALUES($1,$2,100,'2026-01-02','2026-01-03',$3,$4,$5,'Synthetic recognition') RETURNING *`, [purchase.id, supplier.id, `=INV-${purchase.id}`, purchase.supplier_snapshot, actor.id]);
  const returned = await post(`/purchases/${purchase.id}/returns`, { items: [{ purchase_item_id: receipt.body.data.items[0].id, qty_returned: 1 }], return_date: '2026-01-03', reason: 'Synthetic reporting return' });
  assert.equal(returned.status, 201, JSON.stringify(returned.body));
  const debit = returned.body.data.debit_note;
  async function event(kind, sourceType, sourceId, amount, date, original) {
    const { rows: [row] } = await pool.query(`INSERT INTO settlement_events(kind,source_type,source_id,supplier_id,amount,date,reason,operator_confirmed,party_snapshot,created_by,reverses_event_id) VALUES($1,$2,$3,$4,$5,$6,'=Synthetic report event',true,$7,$8,$9) RETURNING *`, [kind, sourceType, sourceId, supplier.id, amount, date, purchase.supplier_snapshot, actor.id, original || null]);
    if (kind !== 'supplier_refund') await pool.query("INSERT INTO settlement_lines(event_id,target_type,target_id,amount) VALUES($1,'payable',$2,$3)", [row.id, payable.id, amount]);
    if (kind !== 'supplier_debit_application') await pool.query("INSERT INTO settlement_tenders(event_id,mode,amount) VALUES($1,'cash',$2)", [row.id, amount]);
    return row;
  }
  const payment = await event('supplier_payment', 'payable', payable.id, 20, '2026-01-04');
  await event('supplier_debit_application', 'debit', debit.id, 10, '2026-01-05');
  await event('supplier_refund', 'debit', debit.id, 5, '2026-01-06');
  await event('reversal', 'event', payment.id, 20, '2026-01-07', payment.id);
  return { supplier, payable };
}

test('Phase4 supplier statement computes opening and running balances before type filters or pagination', async () => {
  const f = await supplierHistory();
  const response = await get(`/finance/statements/supplier/${f.supplier.id}?from=2026-01-04&to=2026-01-07&kind=supplier_payment&page=1&limit=1`);
  assert.equal(response.status, 200, JSON.stringify(response.body)); const data = response.body.data;
  assert.equal(data.opening_balance, '75.00'); assert.equal(data.closing_balance, '80.00');
  assert.equal(data.rows.length, 1); assert.equal(data.rows[0].running_balance, '55.00'); assert.equal(data.rows[0].kind, 'supplier_payment');
  assert.equal(data.summary.count, 1); assert.equal(data.summary.credit, '20.00'); assert.equal(data.summary.debit, '0.00');
});

test('Phase4 supplier aging is historical as of date and later reversal does not alter earlier residuals', async () => {
  const f = await supplierHistory();
  const early = await get(`/finance/statements/supplier/${f.supplier.id}?as_of=2026-01-05&to=2026-01-05`);
  assert.equal(early.status, 200, JSON.stringify(early.body));
  assert.equal(early.body.data.aging.total_due, '70.00'); assert.equal(early.body.data.aging.available_credit, '15.00'); assert.equal(early.body.data.aging.days_1_30, '70.00');
  const later = await get(`/finance/statements/supplier/${f.supplier.id}?as_of=2026-01-07&to=2026-01-07`);
  assert.equal(later.status, 200, JSON.stringify(later.body)); assert.equal(later.body.data.aging.total_due, '90.00'); assert.equal(later.body.data.aging.available_credit, '10.00');
});

test('Phase4 report summary and CSV use the complete filtered dataset and neutralize formula text', async () => {
  const f = await supplierHistory(); const query = `party_type=supplier&party_id=${f.supplier.id}&from=2026-01-04&to=2026-01-07&page=1&limit=1`;
  const statement = await get(`/finance/statements/supplier/${f.supplier.id}?from=2026-01-04&to=2026-01-07&page=1&limit=1`);
  assert.equal(statement.status, 200, JSON.stringify(statement.body)); assert.equal(statement.body.data.rows.length, 1); assert.equal(statement.body.data.summary.count, 4);
  const summary = await get(`/finance/summary?${query}`); assert.equal(summary.status, 200, JSON.stringify(summary.body));
  assert.deepEqual(summary.body.data.summary, statement.body.data.summary);
  const csv = await get(`/finance/export.csv?${query}`); assert.equal(csv.status, 200); assert.match(csv.headers['content-type'], /text\/csv/);
  assert.equal(csv.text.trim().split('\n').length, 5, 'Header plus all four filtered rows, regardless of page limit');
  assert.match(csv.text, /'=Synthetic/); assert.doesNotMatch(csv.text, /(?:^|,)"?=Synthetic/);
});

test('Phase4 customer statement starts from prior history and retains issued party identity', async () => {
  const product = await fixtureProduct(); const customer = await fixtureCustomer({ name: `Original statement customer ${randomUUID()}` });
  const sale = await post('/invoices', { customer_id: customer.id, bill_type: 'retail', date: '2026-01-01', items: [{ product_id: product.id, qty: 1, unit: 'piece', rate: 100 }], payment: { amount_paid: 0, modes: [], due_date: '2026-01-03' } });
  assert.equal(sale.status, 201); const payment = await post('/payments', { customer_id: customer.id, invoice_id: sale.body.data.invoice_id, amount: 20, mode: 'cash', payment_date: '2026-01-04' }); assert.equal(payment.status, 201);
  await pool.query("UPDATE customers SET name='Renamed current account' WHERE id=$1", [customer.id]);
  const response = await get(`/finance/statements/customer/${customer.id}?from=2026-01-04&to=2026-01-04`);
  assert.equal(response.status, 200, JSON.stringify(response.body)); const data = response.body.data;
  assert.equal(data.opening_balance, '100.00'); assert.equal(data.closing_balance, '80.00'); assert.equal(data.rows[0].running_balance, '80.00');
  assert.equal(data.rows[0].party_snapshot.name, customer.name); assert.equal(data.summary.credit, '20.00');
});

test('Phase4 existing collections uses concrete mixed portions, dated refunds and complete export filters', async () => {
  const customer=await fixtureCustomer({name:`=Collection ${randomUUID()}`}); const day='2026-04-04';
  const service=require('../../src/modules/reports/reports.service'); const before=await service.getPaymentCollectionsReport({from:day,to:day,mode:'bank'});
  const receipt=await post('/payments',{customer_id:customer.id,amount:'60.00',mode:'mixed',payment_date:day,modes_detail:[{mode:'cash',amount:'10.00'},{mode:'bank',amount:'50.00'}]});assert.equal(receipt.status,201);
  const refund=await post('/finance/customer/commands',{kind:'customer_refund',customer_id:customer.id,source_type:'advance',source_id:receipt.body.data.id,amount:'20.00',date:day,reason:'Synthetic recorded refund',operator_confirmed:true,mode:'bank'});assert.equal(refund.status,201,JSON.stringify(refund.body));
  const result=await service.getPaymentCollectionsReport({from:day,to:day,mode:'bank',page:1,limit:1});
  assert.equal(result.payments.length,1);assert.equal(Number(result.summary.total_collected)-Number(before.summary.total_collected),50);assert.equal(Number(result.summary.total_refunded)-Number(before.summary.total_refunded),20);assert.equal(Number(result.summary.bank_total)-Number(before.summary.bank_total),30);assert.equal(result.pagination.total-before.pagination.total,2);
  const ExcelJS=require('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.load(await require('../../src/modules/reports/exports.service').buildCollectionsExport({from:day,to:day,mode:'bank'}));
  const sheet=book.worksheets[0];assert.equal(sheet.rowCount,result.pagination.total+1);const rows=Array.from({length:sheet.rowCount-1},(_,i)=>sheet.getRow(i+2).values);
  assert.ok(rows.every(r=>r.includes('bank')));assert.ok(rows.some(r=>r.includes('in')));assert.ok(rows.some(r=>r.includes('out')));
  assert.ok(rows.some(r=>r.some(v=>typeof v==='string' && v.startsWith("'=Collection"))));
});

test('Phase4 existing dues defines overdue by due date and keeps as-of credits separate', async () => {
  const product=await fixtureProduct();const customer=await fixtureCustomer();
  const issued=await post('/invoices',{customer_id:customer.id,bill_type:'retail',date:'2026-07-05',items:[{product_id:product.id,qty:1,unit:'piece',rate:100}],payment:{amount_paid:0,modes:[],due_date:'2026-07-10'}});assert.equal(issued.status,201);
  assert.equal((await post('/payments',{customer_id:customer.id,invoice_id:issued.body.data.invoice_id,amount:30,mode:'cash',payment_date:'2026-07-08'})).status,201);
  assert.equal((await post('/payments',{customer_id:customer.id,amount:40,mode:'cash',payment_date:'2026-07-08'})).status,201);
  const service=require('../../src/modules/reports/reports.service');
  const early=await service.getCustomerDuesReport({as_of:'2026-07-07'},true);const before=early.customers.find(c=>c.id===customer.id);assert.equal(before.outstanding_balance,'100.00');assert.equal(before.available_credit,'0.00');
  const notOverdue=await service.getCustomerDuesReport({as_of:'2026-07-09',overdueOnly:true},true);assert.equal(notOverdue.customers.some(c=>c.id===customer.id),false);
  const late=await service.getCustomerDuesReport({as_of:'2026-07-11',overdueOnly:true},true);const after=late.customers.find(c=>c.id===customer.id);assert.equal(after.outstanding_balance,'70.00');assert.equal(after.available_credit,'40.00');assert.equal(after.overdue_amount,'70.00');
  const ExcelJS=require('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.load(await require('../../src/modules/reports/exports.service').buildCustomerDuesExport({as_of:'2026-07-11',overdueOnly:true}));
  const sheet=book.worksheets[0];const column=sheet.getRow(1).values.indexOf('Unpaid Invoices');
  const row=Array.from({length:sheet.rowCount-1},(_,i)=>sheet.getRow(i+2)).find(r=>r.values.includes(customer.name));
  assert.ok(row);assert.equal(row.getCell(column).value,1,'Export must retain the verified unpaid invoice count');
});

test('Phase4 sales collected uses receipt dates and export shares filters and issued identity', async () => {
  const customer=await fixtureCustomer({name:`=Issued sales ${randomUUID()}`});const product=await fixtureProduct();
  const issued=await post('/invoices',{customer_id:customer.id,bill_type:'retail',date:'2026-08-01',items:[{product_id:product.id,qty:1,unit:'piece',rate:100}],payment:{amount_paid:0,modes:[],due_date:'2026-08-10'}});assert.equal(issued.status,201);
  assert.equal((await post('/payments',{customer_id:customer.id,invoice_id:issued.body.data.invoice_id,amount:20,mode:'cash',payment_date:'2026-09-01'})).status,201);
  await pool.query("UPDATE customers SET name='Current renamed party' WHERE id=$1",[customer.id]);
  const service=require('../../src/modules/reports/reports.service');const options={from:'2026-08-01',to:'2026-08-31',customerId:customer.id,billType:'retail'};
  const report=await service.getSalesReport(options);assert.equal(report.summary.total_collected,'0.00');assert.equal(report.summary.total_outstanding,'100.00');assert.equal(report.invoices[0].amount_paid,'0.00');assert.equal(report.invoices[0].customer_name,customer.name);
  const ExcelJS=require('exceljs');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await require('../../src/modules/reports/exports.service').buildSalesExport(options));
  const sheet=workbook.worksheets[0];assert.equal(sheet.rowCount,3);assert.ok(sheet.getRow(2).values.includes("'"+customer.name));assert.ok(sheet.getRow(3).values.includes(100));
});


test('Phase4 global sales summary flags unverified unpaid invoice evidence even without cash movements', async () => {
  const {rows:[unused]}=await pool.query(`SELECT d::date::text AS date FROM generate_series('2000-01-01'::date,'2025-12-31'::date,'1 day') d
    WHERE NOT EXISTS(SELECT 1 FROM invoices i WHERE i.date=d::date) AND NOT EXISTS(SELECT 1 FROM payments p WHERE p.payment_date=d::date)
    AND NOT EXISTS(SELECT 1 FROM settlement_events e WHERE e.date=d::date) ORDER BY d LIMIT 1`);
  const day=unused.date;const customer=await fixtureCustomer();const product=await fixtureProduct();
  const issued=await post('/invoices',{customer_id:customer.id,bill_type:'retail',date:day,items:[{product_id:product.id,qty:1,unit:'piece',rate:100}],payment:{amount_paid:0,modes:[],due_date:day}});assert.equal(issued.status,201,JSON.stringify(issued.body));
  const clean=await get(`/finance/reports?from=${day}&to=${day}`);assert.equal(clean.status,200,JSON.stringify(clean.body));
  assert.equal(clean.body.data.sales.gross_sales,'100.00');assert.equal(clean.body.data.sales.evidence_status,'verified');assert.equal(clean.body.data.reconciliation_required,false);
  const client=await pool.connect();let unknown;
  try {
    await client.query('BEGIN');
    await client.query('ALTER TABLE invoices DISABLE TRIGGER invoice_party_snapshot');
    const result=await client.query(`INSERT INTO invoices(invoice_no,bill_type,date,grand_total,balance_due,profit_amount) VALUES($1,'retail',$2,40,40,7) RETURNING id`,['UNV-'+randomUUID().slice(0,20),day]);unknown=result.rows[0].id;
    await client.query('ALTER TABLE invoices ENABLE TRIGGER invoice_party_snapshot');await client.query('COMMIT');
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
  const report=await get(`/finance/reports?from=${day}&to=${day}`);assert.equal(report.status,200,JSON.stringify(report.body));
  assert.equal(report.body.data.sales.gross_sales,'140.00');assert.equal(report.body.data.sales.evidence_status,'unverified');assert.equal(report.body.data.reconciliation_required,true);
  assert.equal(report.body.data.sales.unverified_invoice_count,1);assert.ok(report.body.data.sales.unverified_invoices.some(i=>i.invoice_id===unknown));
  assert.equal(report.body.data.cash.incoming,'0.00');assert.equal(report.body.data.cash.outgoing,'0.00');
  await pool.query('UPDATE invoices SET amount_paid=1,balance_due=39 WHERE id=$1',[unknown]);
  const ExcelJS=require('exceljs');const book=new ExcelJS.Workbook();await book.xlsx.load(await require('../../src/modules/reports/exports.service').buildSalesExport({from:day,to:day}));
  const sheet=book.worksheets[0];const column=sheet.getRow(1).values.indexOf('Balance');
  const row=Array.from({length:sheet.rowCount-1},(_,i)=>sheet.getRow(i+2)).find(r=>r.values.includes('reconciliation_required'));
  assert.ok(row);assert.equal(row.getCell(column).value,null,'Unknown due must stay blank, never become zero');
});
