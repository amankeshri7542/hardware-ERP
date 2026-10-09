const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {readFileSync}=require('node:fs');
const path=require('node:path');
const {Pool}=require('pg');
const {disposableDatabase}=require('../helpers/disposableDatabase');
let api,corrupt,cleanName,corruptName;
const sql=readFileSync(path.resolve(__dirname,'../../../db/reconciliation/phase-4.sql'),'utf8');
before(async()=>{
  const owner={host:process.env.DB_HOST,port:Number(process.env.DB_PORT),user:process.env.DB_USER,password:process.env.DB_PASSWORD,ssl:false};
  cleanName=await disposableDatabase('clean');corruptName=await disposableDatabase('corrupt');
  corrupt=new Pool({...owner,database:corruptName});process.env.DB_NAME=cleanName;api=require('../helpers/financial');
});
after(async()=>{if(api)await api.close();await corrupt?.end();});
async function posted(url,body){const response=await api.post(url,body);assert.equal(response.status,201,JSON.stringify(response.body));return response.body.data;}
async function command(domain,body){body={operator_confirmed:true,...body};const q=await api.post(`/finance/${domain}/quote`,body);assert.equal(q.status,200,JSON.stringify(q.body));return posted(`/finance/${domain}/commands`,{...body,quote_hash:q.body.data.quote_hash});}

test('Phase4 clean deterministic journeys reconcile money, owners, original stock and two closed days',async()=>{
  const actor=await api.setupActor();const customer=await api.fixtureCustomer();
  const product=await posted('/products',{name:'Clean supported stock',category:'Synthetic',unit:'piece',current_stock:0,mrp:8000,wholesale_price:8000,purchase_price:200,gst_rate:0});
  const suppliers=[];
  for(const name of ['Clean supplier one','Clean supplier two'])suppliers.push((await api.pool.query('INSERT INTO suppliers(name) VALUES($1) RETURNING *',[name])).rows[0]);
  const receipts=[],payables=[];
  for(const supplier of suppliers){
    const receipt=await posted('/purchases',{supplier_id:supplier.id,date:'2026-02-01',items:[{product_id:product.id,qty:5,unit:'piece',cost_price:200}]});
    receipts.push(receipt.purchase);
    const payable=await command('supplier',{kind:'payable_recognition',supplier_id:supplier.id,purchase_id:receipt.purchase.id,amount:1000,date:'2026-02-01',due_date:'2026-02-10',document_reference:`Confirmed-${supplier.id}`,reason:'Confirmed goods invoice obligation'});
    payables.push(payable.record);
  }
  const advance=await posted('/payments',{customer_id:customer.id,amount:5000,mode:'cash',payment_date:'2026-02-01'});
  async function sale(amount,paid,anonymous=false){return posted('/invoices',{customer_id:anonymous?null:customer.id,customer_name_walkin:anonymous?'Counter sale':undefined,bill_type:anonymous?'quickbill':'retail',date:'2026-02-01',items:[{product_id:product.id,qty:1,unit:'piece',rate:amount}],payment:{amount_paid:paid,modes:paid?[{mode:'cash',amount:paid}]:[],due_date:'2026-02-10'}});}
  const target=await sale(8000,0),creditSale=await sale(500,500),anonymousSale=await sale(100,100,true);
  await command('customer',{kind:'customer_allocation',customer_id:customer.id,source_type:'advance',source_id:advance.id,date:'2026-02-01',reason:'Apply held advance',targets:[{invoice_id:target.invoice_id,amount:5000}]});
  assert.equal((await api.pool.query('SELECT balance_due FROM invoices WHERE id=$1',[target.invoice_id])).rows[0].balance_due,'3000.00');
  await command('supplier',{kind:'supplier_payment',supplier_id:suppliers[1].id,source_type:'payable',source_id:payables[1].id,amount:1000,date:'2026-02-01',reason:'Recorded supplier payment',operator_confirmed:true,mode:'cash'});
  async function saleReturn(invoice){const item=(await api.pool.query('SELECT id FROM invoice_items WHERE invoice_id=$1',[invoice.invoice_id])).rows[0];return posted(`/invoices/${invoice.invoice_id}/return`,{date:'2026-02-02',reason:'Sellable original goods',disposition:'sellable',items:[{invoice_item_id:item.id,qty_returned:1}]});}
  await saleReturn(creditSale);await saleReturn(anonymousSale);
  const credit=(await api.pool.query('SELECT id FROM sales_return_applications WHERE original_invoice_id=$1',[creditSale.invoice_id])).rows[0];
  await command('customer',{kind:'customer_allocation',customer_id:customer.id,source_type:'return_credit',source_id:credit.id,date:'2026-02-02',reason:'Use part of return credit',targets:[{invoice_id:target.invoice_id,amount:300}]});
  await command('customer',{kind:'customer_refund',customer_id:customer.id,source_type:'return_credit',source_id:credit.id,date:'2026-02-02',reason:'Confirmed remaining credit refund',amount:200,operator_confirmed:true,mode:'cash'});
  const liability=(await api.pool.query('SELECT id FROM anonymous_return_liabilities WHERE original_invoice_id=$1',[anonymousSale.invoice_id])).rows[0];
  for(const amount of [40,60])await command('customer',{kind:'anonymous_refund',source_type:'anonymous_liability',source_id:liability.id,date:'2026-02-02',reason:'Confirmed counter refund',amount,operator_confirmed:true,mode:'cash'});
  const debits=[];
  for(const receipt of receipts){const item=(await api.pool.query('SELECT id FROM purchase_items WHERE purchase_id=$1',[receipt.id])).rows[0];
    const result=await posted(`/purchases/${receipt.id}/returns`,{return_date:'2026-02-02',reason:'Original receipt goods returned',items:[{purchase_item_id:item.id,qty_returned:1}]});debits.push(result.debit_note);}
  await command('supplier',{kind:'supplier_debit_application',supplier_id:suppliers[0].id,source_type:'debit',source_id:debits[0].id,date:'2026-02-02',reason:'Apply agreed claim',amount:200,targets:[{payable_id:payables[0].id,amount:200}]});
  await command('supplier',{kind:'supplier_payment',supplier_id:suppliers[0].id,source_type:'payable',source_id:payables[0].id,date:'2026-02-02',reason:'Confirmed residual payment',amount:800,operator_confirmed:true,mode:'cash'});
  await command('supplier',{kind:'supplier_refund',supplier_id:suppliers[1].id,source_type:'debit',source_id:debits[1].id,date:'2026-02-02',reason:'Confirmed supplier refund received',amount:200,operator_confirmed:true,mode:'cash'});
  assert.equal((await api.pool.query('SELECT outstanding_balance FROM customers WHERE id=$1',[customer.id])).rows[0].outstanding_balance,'2700.00');
  assert.equal((await api.pool.query('SELECT current_stock FROM products WHERE id=$1',[product.id])).rows[0].current_stock,'7.000');
  for(const [day,opening,expected] of [['2026-02-01',100,4700],['2026-02-02',4700,3800]]){
    await posted('/finance/days/open',{date:day,opening_float:opening,reason:'Explicit counted float'});
    const closed=await posted('/finance/days/close',{date:day,counted_cash:expected,reason:'Confirmed till count',operator_confirmed:true});
    assert.equal(closed.record.expected_cash,expected.toFixed(2));assert.equal(closed.record.discrepancy,'0.00');
  }
  const results=await api.appPool.query(sql);
  for(const result of results){for(const row of result.rows||[]){assert.ok(!row.issue,JSON.stringify(row));if(row.limitation)assert.equal(Number(row.records),0,JSON.stringify(row));}}
  const {rows:[counts]}=await api.pool.query(`SELECT (SELECT COUNT(*) FROM payments)::int AS receipts,(SELECT COUNT(*) FROM stock_ledger WHERE reference_type='purchase_return')::int AS supplier_stock_returns`);
  assert.equal(counts.receipts,3);assert.equal(counts.supplier_stock_returns,2);
  assert.ok(actor.id);console.log(JSON.stringify({clean_database:cleanName,corruption_database:corruptName,unexplained_discrepancies:0,closing_cash:'3800.00'}));
});

test('Phase4 reconciliation detects deliberately corrupt stock in a separate database',async()=>{
  await corrupt.query("INSERT INTO products(name,current_stock) VALUES('Deliberately unproven stock',5)");
  const results=await corrupt.query(sql);const issues=results.flatMap(r=>r.rows||[]).filter(row=>row.issue);
  assert.equal(issues.length,1,JSON.stringify(issues));assert.equal(issues[0].issue,'stock_projection');
});
