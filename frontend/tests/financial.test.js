import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { calculateLineItem, calculateInvoiceTotals, decimal, moneySum } from '../src/utils/billing.calculations.js';
import { intentStorageKey, readIntent, newIntent, executeIntent, clearIntent } from '../src/utils/financialIntent.js';

const memory = () => { const values = new Map(); return { getItem: k => values.get(k) ?? null, setItem: (k, v) => values.set(k, v), removeItem: k => values.delete(k) }; };
test('selected-unit prices, fractional quantities, percentage rounding and tender sums remain exact', () => {
 const item = calculateLineItem({ qty: '1.125', rate: '10.05', discount_pct: '2.50', gst_pct: '18.00', _conversionValue: '2.0000' });
 assert.equal(item.base_qty, '2.250');
 assert.equal(item.discount_amount, '0.25');
 assert.equal(item.taxable_amount, '11.03');
 assert.equal(item.gst_amount, '1.99');
 assert.equal(item.line_total, '13.02');
 assert.equal(calculateInvoiceTotals([item]).subtotal, '11.31');
 assert.equal(calculateInvoiceTotals([item]).discount_total, '0.28');
 assert.equal(moneySum(['0.10','0.20']), '0.30');
 assert.throws(() => decimal('1.001', 2));
 assert.throws(() => calculateLineItem({ qty:'0.001', rate:'1.00', _conversionValue:'0.1000' }));
});
test('canonical frontend preview agrees with backend shared fixtures', async () => {
 const fixtures = JSON.parse(await readFile(new URL('../../shared/billing-fixtures.json', import.meta.url),'utf8'));
 for (const fixture of fixtures) {
 const totals = calculateInvoiceTotals(fixture.items.map(i => calculateLineItem({...i,_conversionValue: fixture.name.includes('boxes') ? '10' : '1'})));
 for (const key of ['subtotal','discount_total','taxable_total','gst_total','grand_total']) assert.equal(totals[key],fixture.expected[key],`${fixture.name}: ${key}`);
 }
});
test('lost response and reload explicitly retry the same persisted intent and key', async () => {
 const storage = memory(); const payload = { amount:'0.30', mode:'cash' };
 const first = newIntent(payload, { selectedInvoiceId:12 });
 let calls = 0;
 const lost = await executeIntent(storage, 4, 'payment', first, async (sent, key) => { calls++; assert.deepEqual(sent, payload); assert.equal(key, first.key); throw new Error('Lost response'); });
 assert.equal(lost.status, 'uncertain');
 const recovered = readIntent(storage, 4, 'payment');
 assert.equal(recovered.key, first.key);
 assert.equal(calls, 1, 'Reading state must not replay a mutation');
 const result = await executeIntent(storage, 4, 'payment', recovered, async (sent,key) => { calls++; assert.deepEqual(sent,payload); assert.equal(key,first.key); return { data:{success:true,data:{id:7,amount:'0.30',outstanding_balance:'0.00'}}}; });
 assert.equal(result.status,'completed'); assert.equal(result.result.id,7); assert.equal(calls,2);
 assert.equal(readIntent(storage, 5, 'payment'),null,'Other users cannot recover this operation');
 assert.throws(() => clearIntent(storage,4,'payment',lost));
 clearIntent(storage,4,'payment',result);
 assert.notEqual(newIntent({amount:'0.31'}).key,first.key,'Deliberately changed intent has a new key');
});
test('storage failure blocks financial dispatch; rejected/auth/conflict responses have distinct recovery states', async () => {
 let sent=false;
 const blocked={getItem:()=>null,setItem:()=>{throw new Error('Storage blocked');}};
 await assert.rejects(executeIntent(blocked,4,'invoice',newIntent({}),async()=>{sent=true;}));
 assert.equal(sent,false);
 for (const [status,code,expected] of [[422,'VALIDATION_ERROR','rejected'],[404,'CUSTOMER_NOT_FOUND','rejected'],[404,'INVOICE_NOT_FOUND','rejected'],[400,'INVALID_OPERATION_ACTOR','uncertain'],[409,'OPERATION_ACTOR_MISMATCH','uncertain'],[429,'RATE_LIMITED','uncertain'],[408,'REQUEST_TIMEOUT','uncertain'],[409,'QUOTE_CHANGED','rejected'],[401,'UNAUTHORIZED','uncertain'],[403,'FORBIDDEN','uncertain'],[409,'IDEMPOTENCY_CONFLICT','uncertain'],[500,'INTERNAL_ERROR','uncertain']]) {
 const storage=memory(); const result=await executeIntent(storage,4,'invoice',newIntent({}),async()=>{throw {response:{status,data:{code,error:'Synthetic failure'}}};});
 assert.equal(result.status,expected); assert.ok(storage.getItem(intentStorageKey(4,'invoice')));
 }
});

test('an uncertain operation stays locked even when recovery returns a nominal validation failure',async()=>{
 for(const [status,code] of [[429,'RATE_LIMITED'],[408,'REQUEST_TIMEOUT'],[422,'VALIDATION_ERROR'],[409,'QUOTE_CHANGED']]){
 const storage=memory();const original=newIntent({amount:'1.00'});
 const lost=await executeIntent(storage,4,'payment',original,async()=>{throw new Error('response lost');});
 const retried=await executeIntent(storage,4,'payment',lost,async()=>{throw {response:{status,data:{code}}};});
 assert.equal(retried.status,'uncertain');assert.equal(retried.key,original.key);assert.throws(()=>clearIntent(storage,4,'payment',retried));
 }
});

test('recovery receipts exclude cost/profit snapshots and cannot replace another saved intent',async()=>{
 const storage=memory();const first=newIntent({amount:'1.00'});
 const result=await executeIntent(storage,4,'invoice',first,async()=>({data:{success:true,data:{invoice_id:8,grand_total:'1.00',amount_paid:'1.00',balance_due:'0.00',totals:{grand_total:'1.00',total_cost:'9.00',profit_amount:'-8.00'},items:[{product_id:1,cost_price_snapshot:'9.00',line_profit:'-8.00',line_total:'1.00'}]}}}));
 assert.equal(result.result.items[0].cost_price_snapshot,undefined);assert.equal(result.result.totals.total_cost,undefined);
 let dispatched=false;await assert.rejects(executeIntent(storage,4,'invoice',newIntent({amount:'2.00'}),async()=>{dispatched=true;}));assert.equal(dispatched,false);
});

test('a malformed successful transport response stays uncertain under the original key',async()=>{
 for(const data of ['<html>proxy page</html>',{success:true},{success:false,data:{invoice_id:8}},{success:true,data:{invoice_id:8}}]){
 const storage=memory();const original=newIntent({payment:{amount_paid:'1.00'}});
 const result=await executeIntent(storage,4,'invoice',original,async()=>({status:200,data}));
 assert.equal(result.status,'uncertain');assert.equal(result.key,original.key);assert.throws(()=>clearIntent(storage,4,'invoice',result));
 }
});

test('financial dispatch carries the original persisted actor and rejects an actor change before sending',async()=>{
 const storage=memory();const intent=newIntent({amount:'1.00'},null,4);assert.equal(intent.actorId,4);
 let captured;const uncertain=await executeIntent(storage,4,'payment',intent,async(_payload,_key,actor)=>{captured=actor;throw new Error('lost response');});
 assert.equal(captured,4);assert.equal(readIntent(storage,4,'payment').actorId,4);
 let sent=false;await assert.rejects(executeIntent(storage,5,'payment',uncertain,async()=>{sent=true;}));assert.equal(sent,false);assert.equal(readIntent(storage,5,'payment'),null);
 const mismatch=await executeIntent(storage,4,'payment',uncertain,async(_payload,_key,actor)=>{assert.equal(actor,4);throw {response:{status:409,data:{code:'OPERATION_ACTOR_MISMATCH'}}};});
 assert.equal(mismatch.status,'uncertain');assert.equal(mismatch.key,intent.key);assert.equal(mismatch.actorId,4);assert.throws(()=>clearIntent(storage,4,'payment',mismatch));
});
