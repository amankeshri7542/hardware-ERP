const {createHash}=require('node:crypto');
const {pool}=require('../../config/db');
const {decimal,format,date,fail}=require('../../utils/financial');
const {withIdempotency}=require('../../utils/idempotency');
const {requireOpenDate}=require('../../utils/financialPeriod');
const {getCashMovements}=require('./cashMovements');

function normalize(input,kind) {
  const allowed=['date','reason','operator_confirmed','quote_hash',kind==='day_open'?'opening_float':'counted_cash'];
  if(!input || typeof input!=='object' || Array.isArray(input) || Object.keys(input).some(k=>!allowed.includes(k))) fail('UNSUPPORTED_DAY_FIELD');
  if(typeof input.reason!=='string'||!input.reason.trim()||input.reason.length>500) fail('DAY_REASON_REQUIRED');
  if(kind==='day_close'&&input.operator_confirmed!==true) fail('OPERATOR_CONFIRMATION_REQUIRED');
  if(input.quote_hash!==undefined&&!/^[a-f0-9]{64}$/.test(input.quote_hash)) fail('INVALID_QUOTE');
  const field=kind==='day_open'?'opening_float':'counted_cash';
  return {kind,date:date(input.date),reason:input.reason.trim(),operator_confirmed:true,
    [field]:format(decimal(input[field],2)),...(input.quote_hash?{quote_hash:input.quote_hash}:{})};
}
function hash(value){return createHash('sha256').update(JSON.stringify(value)).digest('hex');}
async function calendar(client){return (await client.query(`SELECT timezone,(CURRENT_TIMESTAMP AT TIME ZONE timezone)::date::text AS today,
  (SELECT MAX(date)::text FROM financial_day_closes) AS closed_through FROM shop_finance_config WHERE id=true`)).rows[0];}
async function dayState(client,day) {
  const config=await calendar(client);
  const opening=(await client.query('SELECT *,date::text AS date FROM financial_day_openings WHERE date=$1',[day])).rows[0]||null;
  const closed=(await client.query('SELECT *,date::text AS date FROM financial_day_closes WHERE date=$1',[day])).rows[0]||null;
  if(closed) return {...config,date:day,opening,closed,expected_cash:closed.expected_cash,movements:closed.movements};
  const movements=await getCashMovements(client,{from:day,to:day});
  const totals={cash_in:0n,cash_out:0n,noncash_in:0n,noncash_out:0n};
  for(const item of movements) totals[`${item.mode==='cash'?'cash':'noncash'}_${item.direction}`]+=decimal(item.amount,2);
  const cash=Object.fromEntries(Object.entries(totals).map(([key,value])=>[key,format(value)]));
  return {...config,date:day,opening,closed,...cash,movements,
    expected_cash:opening?format(decimal(opening.opening_float,2)+totals.cash_in-totals.cash_out):null};
}
async function calculate(client,intent) {
  const config=await requireOpenDate(client,intent.date);
  if(intent.date>config.today) fail('FUTURE_FINANCIAL_DATE');
  const state=await dayState(client,intent.date);
  if(intent.kind==='day_open') {
    if(state.opening) fail('DAY_ALREADY_OPEN',409);
    const {rows:[prior]}=await client.query(`SELECT (MAX(date)+1)::text AS next_date FROM financial_day_closes`);
    const pending=await client.query('SELECT id FROM financial_day_openings o WHERE NOT EXISTS(SELECT 1 FROM financial_day_closes c WHERE c.date=o.date)');
    if(pending.rowCount||prior.next_date&&prior.next_date!==intent.date) fail('DAY_OPEN_SEQUENCE_REQUIRED',409);
    const result={kind:intent.kind,date:intent.date,opening_float:intent.opening_float,timezone:config.timezone,closed_through:config.closed_through};
    return {...result,quote_hash:hash(result)};
  }
  if(!state.opening) fail('DAY_OPENING_REQUIRED');
  const expected=state.expected_cash;
  const discrepancy=format(decimal(intent.counted_cash,2)-(expected.startsWith('-')?-decimal(expected.slice(1),2):decimal(expected,2)));
  const result={kind:intent.kind,date:intent.date,opening_float:state.opening.opening_float,expected_cash:expected,counted_cash:intent.counted_cash,
    discrepancy,cash_in:state.cash_in,cash_out:state.cash_out,noncash_in:state.noncash_in,noncash_out:state.noncash_out,movements:state.movements,timezone:state.timezone};
  return {...result,quote_hash:hash(result)};
}
async function quote(input) {
  const intent=normalize(input,Object.hasOwn(input||{},'opening_float')?'day_open':'day_close');
  const client=await pool.connect();
  try{await client.query('BEGIN');const value=await calculate(client,intent);await client.query('ROLLBACK');return value;}
  catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
async function execute(input,userId,key,kind) {
  const intent=normalize(input,kind);
  return withIdempotency({actorId:userId,operation:`finance.${kind}`,key,intent},async client=>{
    const reviewed=await calculate(client,intent);
    if(intent.quote_hash&&intent.quote_hash!==reviewed.quote_hash) fail('DAY_QUOTE_CHANGED',409);
    let record;
    if(kind==='day_open') record=(await client.query(`INSERT INTO financial_day_openings(date,opening_float,reason,created_by)
      VALUES($1,$2,$3,$4) RETURNING *,date::text AS date`,[intent.date,intent.opening_float,intent.reason,userId])).rows[0];
    else record=(await client.query(`INSERT INTO financial_day_closes(date,expected_cash,counted_cash,discrepancy,movements,reason,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *,date::text AS date`,[intent.date,reviewed.expected_cash,intent.counted_cash,reviewed.discrepancy,JSON.stringify(reviewed.movements),intent.reason,userId])).rows[0];
    return {status:201,body:{success:true,data:{record:{...record,kind},quote:reviewed}}};
  });
}
async function getDay(query={}) {
  if(Object.keys(query).some(key=>key!=='date')) fail('UNSUPPORTED_DAY_FILTER');
  const client=await pool.connect();
  try{await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');const config=await calendar(client);
    const result=await dayState(client,query.date?date(query.date):config.today);await client.query('COMMIT');return result;
  }catch(error){await client.query('ROLLBACK');throw error;}finally{client.release();}
}
module.exports={quote,getDay,open:(input,user,key)=>execute(input,user,key,'day_open'),close:(input,user,key)=>execute(input,user,key,'day_close')};
