const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {setImmediate}=require('node:timers');
const {disposableDatabase}=require('../helpers/disposableDatabase');
let api;
before(async()=>{await disposableDatabase('close');api=require('../helpers/financial');});
after(async()=>{if(api) await api.close();});

test('Phase4 day close records exact cash portions and discrepancy without a balancing event',async()=>{
  const customer=await api.fixtureCustomer();
  const receipt=await api.post('/payments',{customer_id:customer.id,amount:100,mode:'mixed',payment_date:'2026-01-15',
    modes_detail:[{mode:'cash',amount:40},{mode:'upi',amount:60}]});
  assert.equal(receipt.status,201,JSON.stringify(receipt.body));
  const opening=await api.post('/finance/days/open',{date:'2026-01-15',opening_float:100,reason:'Counted opening'});
  assert.equal(opening.status,201,JSON.stringify(opening.body));
  const preview=await api.post('/finance/days/quote',{date:'2026-01-15',counted_cash:139,reason:'Counted till',operator_confirmed:true});
  assert.equal(preview.status,200,JSON.stringify(preview.body));
  assert.equal(preview.body.data.expected_cash,'140.00');
  assert.equal(preview.body.data.discrepancy,'-1.00');
  const payload={date:'2026-01-15',counted_cash:139,reason:'Counted till',operator_confirmed:true,quote_hash:preview.body.data.quote_hash};
  const key=randomUUID();const closed=await api.post('/finance/days/close',payload,{key});
  assert.equal(closed.status,201,JSON.stringify(closed.body));
  assert.equal(closed.body.data.record.discrepancy,'-1.00');
  assert.deepEqual((await api.post('/finance/days/close',payload,{key})).body,closed.body);
  assert.equal((await api.pool.query('SELECT COUNT(*)::int AS n FROM payments')).rows[0].n,1);
  assert.equal((await api.pool.query('SELECT COUNT(*)::int AS n FROM settlement_events')).rows[0].n,0);
  const late=await api.post('/payments',{customer_id:customer.id,amount:1,mode:'cash',payment_date:'2026-01-15'});
  assert.equal(late.status,409);assert.equal(late.body.code,'FINANCIAL_PERIOD_CLOSED');
  assert.equal((await api.post('/finance/days/close',payload)).status,409);
});

test('Phase4 day opening is explicit, sequential and admin-only',async()=>{
  const skipped=await api.post('/finance/days/open',{date:'2026-01-17',opening_float:139,reason:'Counted opening'});
  assert.equal(skipped.status,409);assert.equal(skipped.body.code,'DAY_OPEN_SEQUENCE_REQUIRED');
  const cashier=await api.setupActor('cashier');
  const denied=await api.post('/finance/days/open',{date:'2026-01-16',opening_float:139,reason:'Counted opening'},{actor:cashier});
  assert.equal(denied.status,403);
  const response=await api.post('/finance/days/open',{date:'2026-01-16',opening_float:139,reason:'Counted opening'});
  assert.equal(response.status,201,JSON.stringify(response.body));
});

test('Phase4 closed-period guard also rejects late concrete-tender inserts',async()=>{
  const payment=(await api.pool.query('SELECT id FROM payments ORDER BY id LIMIT 1')).rows[0];
  await assert.rejects(api.appPool.query("INSERT INTO payment_modes_detail(payment_id,mode,amount) VALUES($1,'cash',1)",[payment.id]),/FINANCIAL_PERIOD_CLOSED/);
});

test('Phase4 posting and close contend on database gate with one reproducible cutoff',async()=>{
  const customer=await api.fixtureCustomer();const blocker=await api.pool.connect();
  const {lockWaiters}=require('../helpers/lockWaiters');
  let responses;
  try{
    await blocker.query('BEGIN');await blocker.query('SELECT pg_advisory_xact_lock(172904,4)');
    const pid=(await blocker.query('SELECT pg_backend_pid() AS id')).rows[0].id;
    const requests=[api.post('/payments',{customer_id:customer.id,amount:5,mode:'cash',payment_date:'2026-01-16'}).then(r=>r),
      api.post('/finance/days/close',{date:'2026-01-16',counted_cash:139,reason:'Race cutoff',operator_confirmed:true}).then(r=>r)];
    let waiting=0;const deadline=Date.now()+5000;
    while(waiting<2&&Date.now()<deadline){waiting=await lockWaiters(api.pool,pid);await new Promise(setImmediate);}
    await blocker.query('ROLLBACK');responses=await Promise.all(requests);
    assert.equal(waiting,2,'Both transactions must be database-blocked');
  }finally{await blocker.query('ROLLBACK');blocker.release();}
  const [payment,closing]=responses;
  assert.equal(closing.status,201,JSON.stringify(responses.map(r=>({status:r.status,body:r.body}))));
  assert.ok([201,409].includes(payment.status),JSON.stringify(payment.body));
  if(payment.status===409)assert.equal(payment.body.code,'FINANCIAL_PERIOD_CLOSED');
  assert.equal(closing.body.data.record.expected_cash,payment.status===201?'144.00':'139.00');
});

test('Phase4 same-key concurrent close and lost response recover one durable close',async()=>{
  assert.equal((await api.post('/finance/days/open',{date:'2026-01-17',opening_float:10,reason:'Explicit float'})).status,201);
  const payload={date:'2026-01-17',counted_cash:10,reason:'Confirmed physical count',operator_confirmed:true};
  const key=randomUUID();const results=await Promise.all([api.post('/finance/days/close',payload,{key}),api.post('/finance/days/close',payload,{key})]);
  assert.deepEqual(results.map(r=>r.status),[201,201],JSON.stringify(results.map(r=>r.body)));
  assert.deepEqual(results[0].body,results[1].body);
  assert.deepEqual((await api.post('/finance/days/close',payload,{key})).body,results[0].body);
  assert.equal((await api.pool.query("SELECT COUNT(*)::int AS n FROM financial_day_closes WHERE date='2026-01-17'")).rows[0].n,1);
  const conflict=await api.post('/finance/days/close',{...payload,counted_cash:9},{key});
  assert.equal(conflict.status,409);assert.equal(conflict.body.code,'IDEMPOTENCY_CONFLICT');
});

test('Phase4 changed cash quote rejects without close then reviewed retry succeeds',async()=>{
  assert.equal((await api.post('/finance/days/open',{date:'2026-01-18',opening_float:10,reason:'Explicit float'})).status,201);
  const payload={date:'2026-01-18',counted_cash:10,reason:'Counted till',operator_confirmed:true};
  const quoted=await api.post('/finance/days/quote',payload);assert.equal(quoted.status,200);
  const customer=await api.fixtureCustomer();assert.equal((await api.post('/payments',{customer_id:customer.id,amount:1,mode:'cash',payment_date:payload.date})).status,201);
  const response=await api.post('/finance/days/close',{...payload,quote_hash:quoted.body.data.quote_hash});
  assert.equal(response.status,409);assert.equal(response.body.code,'DAY_QUOTE_CHANGED');
  assert.equal((await api.pool.query('SELECT COUNT(*)::int AS n FROM financial_day_closes WHERE date=$1',[payload.date])).rows[0].n,0);
  const revised=await api.post('/finance/days/quote',payload);assert.equal(revised.body.data.expected_cash,'11.00');
  assert.equal((await api.post('/finance/days/close',{...payload,quote_hash:revised.body.data.quote_hash})).status,201);
});

test('Phase4 failure saving close result rolls back close and leaves original key reusable',async()=>{
  assert.equal((await api.post('/finance/days/open',{date:'2026-01-19',opening_float:10,reason:'Explicit float'})).status,201);
  const payload={date:'2026-01-19',counted_cash:10,reason:'Counted till',operator_confirmed:true};const key=randomUUID();
  await api.pool.query(`CREATE FUNCTION phase4_close_fail() RETURNS trigger AS $$ BEGIN IF NEW.operation='finance.day_close' AND NEW.key='${key}' THEN RAISE EXCEPTION 'Injected final result failure'; END IF; RETURN NEW; END $$ LANGUAGE plpgsql;
    CREATE TRIGGER phase4_close_fail BEFORE UPDATE ON idempotency_keys FOR EACH ROW EXECUTE FUNCTION phase4_close_fail()`);
  try{assert.equal((await api.post('/finance/days/close',payload,{key})).status,500);}
  finally{await api.pool.query('DROP TRIGGER phase4_close_fail ON idempotency_keys;DROP FUNCTION phase4_close_fail()');}
  assert.equal((await api.pool.query('SELECT COUNT(*)::int AS n FROM idempotency_keys WHERE key=$1',[key])).rows[0].n,0);
  assert.equal((await api.pool.query('SELECT COUNT(*)::int AS n FROM financial_day_closes WHERE date=$1',[payload.date])).rows[0].n,0);
  assert.equal((await api.post('/finance/days/close',payload,{key})).status,201);
});

test('Phase4 recorded money rejects a future business date before any receipt effects',async()=>{
  const customer=await api.fixtureCustomer();
  const response=await api.post('/payments',{customer_id:customer.id,amount:1,mode:'cash',payment_date:'2099-01-01'});
  assert.equal(response.status,422);assert.equal(response.body.code,'FUTURE_FINANCIAL_DATE');
  assert.equal((await api.pool.query('SELECT COUNT(*)::int AS n FROM payments WHERE customer_id=$1',[customer.id])).rows[0].n,0);
});
