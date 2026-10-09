const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {disposableDatabase}=require('../helpers/disposableDatabase');
let api;
before(async()=>{await disposableDatabase('period_writers');api=require('../helpers/financial');});
after(async()=>{if(api)await api.close();});
async function saved(url,body){const r=await api.post(url,body);assert.equal(r.status,201,JSON.stringify(r.body));return r.body.data;}

test('closed day rejects every inherited posting and settlement writer; later correction preserves its close',async()=>{
  const date='2026-02-01';const customer=await api.fixtureCustomer();const product=await api.fixtureProduct();
  const supplier=(await api.pool.query("INSERT INTO suppliers(name) VALUES('Closed-period synthetic supplier') RETURNING *")).rows[0];
  const invoiceBody={customer_id:customer.id,bill_type:'retail',date,items:[{product_id:product.id,qty:1,unit:'piece',rate:100}],payment:{amount_paid:0,modes:[],due_date:'2026-02-10'}};
  const invoice=await saved('/invoices',invoiceBody);
  const line=(await api.pool.query('SELECT id FROM invoice_items WHERE invoice_id=$1',[invoice.invoice_id])).rows[0];
  const purchaseBody={supplier_id:supplier.id,date,items:[{product_id:product.id,qty:1,unit:'piece',cost_price:100}]};
  const purchase=(await saved('/purchases',purchaseBody)).purchase;
  const purchaseLine=(await api.pool.query('SELECT id FROM purchase_items WHERE purchase_id=$1',[purchase.id])).rows[0];
  const paymentBody={customer_id:customer.id,amount:100,mode:'cash',payment_date:date};
  const advance=await saved('/payments',paymentBody);
  const refundBody={kind:'customer_refund',customer_id:customer.id,source_type:'advance',source_id:advance.id,amount:20,date,reason:'Confirmed refund',operator_confirmed:true,mode:'cash'};
  const refund=(await saved('/finance/customer/commands',refundBody)).record;
  const recognition={kind:'payable_recognition',supplier_id:supplier.id,purchase_id:purchase.id,amount:100,date,due_date:'2026-02-10',document_reference:'Acknowledged synthetic bill',reason:'Confirmed payable'};
  const payable=(await saved('/finance/supplier/commands',recognition)).record;
  const stock=(await api.pool.query('SELECT current_stock,stock_version FROM products WHERE id=$1',[product.id])).rows[0];
  await saved('/finance/days/open',{date,opening_float:0,reason:'Counted float'});
  const close=(await saved('/finance/days/close',{date,counted_cash:80,reason:'Counted cash',operator_confirmed:true})).record;
  const reversal={kind:'reversal',customer_id:customer.id,source_type:'event',source_id:refund.id,date,reason:'Confirmed correction cash returned',operator_confirmed:true,amount:20};
  const commands=[
    ['/invoices',invoiceBody],['/payments',paymentBody],['/purchases',purchaseBody],
    [`/invoices/${invoice.invoice_id}/return`,{date,reason:'Sellable return',disposition:'sellable',items:[{invoice_item_id:line.id,qty_returned:1}]}],
    [`/purchases/${purchase.id}/returns`,{return_date:date,reason:'Supplier return',items:[{purchase_item_id:purchaseLine.id,qty_returned:1}]}],
    [`/products/${product.id}/stock-adjustments`,{date,counted_stock:99,expected_stock:stock.current_stock,expected_stock_version:stock.stock_version,reason:'Counted stock'}],
    ['/finance/customer/commands',refundBody],['/finance/customer/commands',reversal],
    ['/finance/customer/commands',{kind:'customer_allocation',customer_id:customer.id,source_type:'advance',source_id:advance.id,date,reason:'Allocate held advance',operator_confirmed:true,targets:[{invoice_id:invoice.invoice_id,amount:1}]}],
    ['/finance/supplier/commands',recognition],
    ['/finance/supplier/commands',{kind:'supplier_payment',supplier_id:supplier.id,source_type:'payable',source_id:payable.id,amount:1,date,reason:'Confirmed outgoing money',operator_confirmed:true,mode:'cash'}],
  ];
  const counts=async()=>{const result={};for(const table of ['invoices','invoice_items','payments','customer_ledger','purchases','purchase_returns','stock_ledger','settlement_events','settlement_lines','settlement_tenders','idempotency_keys'])result[table]=(await api.pool.query(`SELECT COUNT(*)::int AS n FROM ${table}`)).rows[0].n;return result;};
  const before=await counts();
  for(const [url,body]of commands){const r=await api.post(url,body);assert.equal(r.status,409,`${url}: ${JSON.stringify(r.body)}`);assert.equal(r.body.code,'FINANCIAL_PERIOD_CLOSED');assert.deepEqual(await counts(),before);}
  const corrected=(await saved('/finance/customer/commands',{...reversal,date:'2026-02-02'})).record;
  assert.equal(corrected.reverses_event_id,refund.id);
  const preserved=(await api.pool.query('SELECT expected_cash,counted_cash,discrepancy FROM financial_day_closes WHERE id=$1',[close.id])).rows[0];
  assert.deepEqual(preserved,{expected_cash:'80.00',counted_cash:'80.00',discrepancy:'0.00'});
  assert.equal((await api.pool.query('SELECT COUNT(*)::int AS n FROM settlement_events WHERE id=$1',[refund.id])).rows[0].n,1);
});
