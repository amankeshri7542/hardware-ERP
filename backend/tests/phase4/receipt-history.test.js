const {test,after}=require('node:test');
const assert=require('node:assert/strict');
const {app,request,pool,setupActor,post,fixtureCustomer,close}=require('../helpers/financial');
after(close);
test('customer receipt history filters ownership, retains issued identity and pages the complete customer count',async()=>{
  const actor=await setupActor();const customer=await fixtureCustomer();const other=await fixtureCustomer();
  const ids=[];
  for(const owner of [customer,other,customer]){const r=await post('/payments',{customer_id:owner.id,amount:1,mode:'cash',payment_date:'2026-04-01'});assert.equal(r.status,201);if(owner.id===customer.id)ids.push(r.body.data.id);}
  await pool.query("UPDATE customers SET name='Changed current identity' WHERE id=$1",[customer.id]);
  for(const page of [1,2]){const r=await request(app).get(`/api/payments?customer_id=${customer.id}&page=${page}&limit=1`).set('Cookie',actor.cookie);
    assert.equal(r.status,200,JSON.stringify(r.body));assert.equal(r.body.data.total,2);assert.equal(r.body.data.totalPages,2);
    assert.equal(r.body.data.payments.length,1);assert.equal(r.body.data.payments[0].customer_id,customer.id);
    assert.equal(r.body.data.payments[0].id,ids[2-page]);assert.equal(r.body.data.payments[0].customer_name,customer.name);}
  const invalid=await request(app).get('/api/payments?customer_id=invalid').set('Cookie',actor.cookie);
  assert.equal(invalid.status,422);assert.equal(invalid.body.code,'INVALID_DECIMAL');
});
