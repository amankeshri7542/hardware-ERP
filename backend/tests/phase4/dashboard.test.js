const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {app,request,pool,setupActor,post,fixtureCustomer,fixtureProduct,close}=require('../helpers/financial');
const reporting=require('../../src/modules/settlements/reporting');
after(close);
async function get(path){const actor=await setupActor();return request(app).get('/api/dashboard/'+path).set('Cookie',actor.cookie);}

test('Phase4 dashboard tender breakdown splits mixed receipts and exposes opposite money separately',async()=>{
  const day='1988-11-15';const customer=await fixtureCustomer();
  const before=await get(`payment-modes?from=${day}&to=${day}`);assert.equal(before.status,200,JSON.stringify(before.body));
  const receipt=await post('/payments',{customer_id:customer.id,amount:'60.00',mode:'mixed',payment_date:day,modes_detail:[{mode:'cash',amount:'7.00'},{mode:'bank',amount:'53.00'}]});assert.equal(receipt.status,201,JSON.stringify(receipt.body));
  const refund=await post('/finance/customer/commands',{kind:'customer_refund',customer_id:customer.id,source_type:'advance',source_id:receipt.body.data.id,amount:'20.00',date:day,reason:'Synthetic dashboard refund',operator_confirmed:true,mode:'bank'});assert.equal(refund.status,201,JSON.stringify(refund.body));
  const result=await get(`payment-modes?from=${day}&to=${day}`);assert.equal(result.status,200,JSON.stringify(result.body));
  const prior=mode=>before.body.data.find(r=>r.mode===mode)||{total:0,outgoing:0,net:0};
  const cash=result.body.data.find(r=>r.mode==='cash'),bank=result.body.data.find(r=>r.mode==='bank');
  assert.equal(cash.total-prior('cash').total,7);assert.equal(bank.total-prior('bank').total,53);assert.equal(bank.outgoing-prior('bank').outgoing,20);assert.equal(bank.net-prior('bank').net,33);
  assert.equal(result.body.data.some(r=>r.mode==='mixed'),false);
  const {rows:[proof]}=await pool.query(`SELECT p.amount,(SELECT SUM(amount) FROM payment_modes_detail WHERE payment_id=p.id)::text AS tender_total FROM payments p WHERE p.id=$1`,[receipt.body.data.id]);
  assert.equal(proof.amount,'60.00');assert.equal(proof.tender_total,'60.00');
  const overview=await get(`sales-overview?from=${day}&to=${day}`);assert.equal(overview.status,200);const dayRow=overview.body.data[0];
  assert.equal(dayRow.total_collections,result.body.data.reduce((n,r)=>n+r.incoming,0));assert.equal(dayRow.total_refunds,result.body.data.reduce((n,r)=>n+r.outgoing,0));
});

test('Phase4 dashboard overdue receivables remain positive when the same customer has larger refundable credit',async()=>{
  const asOf=reporting.today(),day=new Date(Date.parse(asOf)-86400000).toISOString().slice(0,10);
  const customer=await fixtureCustomer({credit_limit:5000000});const product=await fixtureProduct({mrp:999999.99,wholesale_price:999999.99});
  const invoice=await post('/invoices',{customer_id:customer.id,bill_type:'retail',date:day,items:[{product_id:product.id,qty:1,unit:'piece',rate:'999999.99'}],payment:{amount_paid:0,modes:[],due_date:day}});assert.equal(invoice.status,201,JSON.stringify(invoice.body));
  assert.equal((await post('/payments',{customer_id:customer.id,amount:'1999999.98',mode:'cash',payment_date:day})).status,201);
  assert.equal((await pool.query('SELECT outstanding_balance FROM customers WHERE id=$1',[customer.id])).rows[0].outstanding_balance,'-999999.99');
  const overdue=await get('overdue-customers?limit=100');assert.equal(overdue.status,200,JSON.stringify(overdue.body));
  const row=overdue.body.data.customers.find(r=>r.id===customer.id);assert.ok(row,'Refundable credit must not hide this overdue invoice');
  assert.equal(row.outstanding_balance,999999.99);assert.equal(row.total_overdue_amount,999999.99);assert.equal(row.available_credit,1999999.98);
  const summary=await get('summary');assert.equal(summary.status,200,JSON.stringify(summary.body));
  assert.ok(summary.body.data.total_outstanding>=999999.99);assert.ok(summary.body.data.customer_available_credit>=1999999.98);
  assert.equal(summary.body.data.as_of,asOf);assert.equal(summary.body.data.timezone,'Asia/Kolkata');
});

test('Phase4 dashboard defaults use the shop-local day across a UTC date boundary',async t=>{
  t.mock.timers.enable({apis:['Date'],now:Date.parse('2026-10-08T20:00:00.000Z')});
  try {
    const result=await get('payment-modes');assert.equal(result.status,200,JSON.stringify(result.body));assert.ok(result.body.data.length>0,'The boundary assertion must inspect actual tender rows');
    for(const row of result.body.data){assert.equal(row.from,'2026-10-01');assert.equal(row.to,'2026-10-09');}
    assert.equal(reporting.today(),'2026-10-09');
  }finally{t.mock.timers.reset();}
});
