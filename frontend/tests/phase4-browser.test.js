import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { access, readFile } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';

assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true, 'Preload the local-only network guard before importing application code');
assert.equal(process.env.NODE_ENV, 'test');
assert.match(process.env.DB_NAME || '', /_test$/);
assert.ok(['127.0.0.1', 'localhost', '::1'].includes(process.env.DB_HOST));
assert.notEqual(process.env.DB_USER, process.env.FIXTURE_DB_USER);
assert.ok(process.env.FIXTURE_DB_USER);
const origin = 'http://localhost:5173';
assert.equal(process.env.CORS_ORIGIN, origin);
const requireBackend = createRequire(new URL('../../backend/package.json', import.meta.url));
const express = requireBackend('express');
const bcrypt = requireBackend('bcrypt');
const { Pool } = requireBackend('pg');
const app = requireBackend('./src/app');
const { pool } = requireBackend('./src/config/db');
const fixtures = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME,
  user: process.env.FIXTURE_DB_USER, password: process.env.FIXTURE_DB_PASSWORD });
const run = randomUUID();
const password = `Synthetic-phase4-${run}`;
const email = `phase4-${run}@example.invalid`;
const otherEmail = `phase4-other-${run}@example.invalid`;
let userId, otherUserId, cashierId, browser, server, sessionNumber = 100;
const cashierEmail = `phase4-cashier-${run}@example.invalid`;

before(async () => {
  const dist = fileURLToPath(new URL('../dist/', import.meta.url));
  await access(`${dist}/index.html`);
  userId = (await fixtures.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",
    ['Synthetic Phase4 browser', email, await bcrypt.hash(password, 4)])).rows[0].id;
  otherUserId = (await fixtures.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",
    ['Synthetic Phase4 switched account', otherEmail, await bcrypt.hash(password, 4)])).rows[0].id;
  cashierId = (await fixtures.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'cashier') RETURNING id", ['Synthetic Phase4 cashier', cashierEmail, await bcrypt.hash(password,4)])).rows[0].id;
  const web = express();
  web.use(app);
  web.use(express.static(dist));
  web.get(/^(?!\/api).*/, (_req, res) => res.sendFile(`${dist}/index.html`));
  server = await new Promise((resolve, reject) => {
    const candidate = web.listen(5173, '127.0.0.1', () => resolve(candidate));
    candidate.once('error', reject);
  });
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  if (server) await new Promise(resolve => server.close(resolve));
  await pool.end();
  await fixtures.end();
});

async function seed() {
  const name = `Synthetic Phase4 item ${randomUUID()}`;
  const supplierName = `Synthetic Phase4 supplier ${randomUUID()}`;
  const customerName = `Synthetic Phase4 customer ${randomUUID()}`;
  const product = (await fixtures.query(`INSERT INTO products(name,category,unit,base_unit,mrp,wholesale_price,purchase_price,current_stock,gst_rate)
    VALUES($1,'Synthetic','piece','piece',100,100,10,100,0) RETURNING id`, [name])).rows[0].id;
  await fixtures.query("INSERT INTO stock_ledger(product_id,date,movement_type,reference_type,qty_in,qty_out,stock_after,notes,created_by) VALUES($1,'2026-01-01','in','opening',100,0,100,'Synthetic opening',$2)", [product, userId]);
  await fixtures.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit,is_purchase_unit) VALUES($1,'box',10,true,true)", [product]);
  const supplier = (await fixtures.query('INSERT INTO suppliers(name) VALUES($1) RETURNING id', [supplierName])).rows[0].id;
  const customer = (await fixtures.query("INSERT INTO customers(name,phone,type) VALUES($1,$2,'retail') RETURNING id", [customerName, String(randomInt(1000000000, 9999999999))])).rows[0].id;
  return { name, supplierName, customerName, product, supplier, customer };
}

async function login(page, identity = email) {
  await page.goto(`${origin}/login`);
  await page.getByLabel('Username / Email').fill(identity);
  await page.getByLabel('Password', { exact: true }).fill(password);
  await page.getByRole('button', { name: /sign in/i }).click();
  await page.waitForURL(`${origin}${identity === cashierEmail ? '/products' : '/dashboard'}`);
  if(identity !== cashierEmail) await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible();
}

const financialMutation = path => ['/api/payments', '/api/finance/customer/commands', '/api/finance/supplier/commands', '/api/finance/days/open', '/api/finance/days/close'].includes(path);

async function session(t) {
  const attempted = new Set();
  const context = await browser.newContext({ serviceWorkers: 'block', extraHTTPHeaders: { 'X-Forwarded-For': `127.0.0.${++sessionNumber}` } });
  const control = { drop: null, requests: [], catalogRequests: [] };
  await context.routeWebSocket('**/*', socket => { attempted.add('websocket'); socket.close(); });
  const guardedRequests = new Set();
  await context.route('**/*', route => {
    const pending = (async () => {
    const request = route.request();
    const url = new URL(request.url());
    if (url.protocol === 'data:' || (url.protocol === 'blob:' && url.origin === origin)) return route.continue();
    if (url.origin !== origin) { attempted.add(url.origin); return route.abort('blockedbyclient'); }
    if (request.method() === 'POST' && financialMutation(url.pathname)) {
      control.requests.push({ path: url.pathname, key: request.headers()['idempotency-key'], actor: request.headers()['idempotency-actor'], payload: request.postDataJSON() });
    }
    if (request.method() === 'PUT' && /^\/api\/products\/\d+$/.test(url.pathname)) control.catalogRequests.push(request.postDataJSON());
    const response = await route.fetch({ maxRedirects: 0, maxRetries: 0 });
    if (control.holdDay && url.pathname === '/api/finance/days' && url.searchParams.get('date') === control.holdDay.date) { control.holdDay.started = true; await control.holdDay.gate; }
    if (control.holdQuote && url.pathname === '/api/finance/customer/quote' && request.postDataJSON().source_id === control.holdQuote.sourceId) { control.holdQuote.started = true; await control.holdQuote.gate; }
    const location = response.headers().location;
    if (location && new URL(location, url).origin !== origin) { attempted.add(new URL(location, url).origin); return route.abort('blockedbyclient'); }
    if (request.method() === 'POST' && url.pathname === control.drop) {
      control.drop = null;
      assert.equal(response.status(), 201, 'Simulate a lost response only after the actual server commit');
      return route.abort('failed');
    }
    return route.fulfill({ response });
    })();
    guardedRequests.add(pending);
    return pending.finally(() => guardedRequests.delete(pending));
  });
  t.after(() => assert.equal(attempted.size, 0, 'No external browser request or WebSocket may be attempted'));
  t.after(async () => { control.holdDay?.release?.(); control.holdQuote?.release?.(); while (guardedRequests.size) await Promise.all([...guardedRequests]); await context.close(); });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  const runtimeErrors = [];
  page.on('pageerror', error => runtimeErrors.push(error.message));
  t.after(() => assert.deepEqual(runtimeErrors, []));
  await login(page);
  return { page, context, control };
}

async function api(context, path, payload, actor = userId) {
  const response = await context.request.post(`${origin}/api${path}`, { data: payload,
    headers: { Origin: origin, 'Idempotency-Key': randomUUID(), 'Idempotency-Actor': String(actor) } });
  assert.equal(response.status(), 201, await response.text());
  return (await response.json()).data;
}

async function sourcePurchase(context, f) {
  return api(context, '/purchases', { supplier_id: f.supplier, date: '2026-01-15',
    items: [{ product_id: f.product, qty: '2.000', unit: 'box', cost_price: '100.00' }] });
}

async function sourceSale(context, f) {
  return api(context, '/invoices', { customer_id: f.customer, bill_type: 'retail', date: '2026-01-15',
    items: [{ product_id: f.product, qty: '2.000', unit: 'box', rate: '100.00' }],
    payment: { amount_paid: '0.00', modes: [], due_date: '2026-02-15' } });
}

async function savedIntent(page, operation, actor = userId) {
  return page.evaluate(({ operation, actor }) => JSON.parse(localStorage.getItem(`hardware-erp-intent-v1:${actor}:${operation}`)), { operation, actor });
}


const settlementDate = '2026-02-01';
const reverseDate = '2026-02-02';
async function read(context, path) {
  const response = await context.request.get(`${origin}/api${path}`); assert.equal(response.status(),200,await response.text()); return (await response.json()).data;
}
async function advance(context,f, amount='100.00') {
  return api(context,'/payments',{customer_id:f.customer,invoice_id:null,payment_date:'2026-01-17',amount,mode:'cash',notes:'Synthetic advance source'});
}
async function recognize(context,f,purchase) {
  return api(context,'/finance/supplier/commands',{kind:'payable_recognition',supplier_id:f.supplier,purchase_id:purchase.purchase.id,amount:'200.00',date:'2026-01-17',due_date:'2026-02-15',document_reference:'Synthetic payable',reason:'Verified synthetic receipt',operator_confirmed:true});
}
async function supplierSources(context,f) {
  const purchase=await sourcePurchase(context,f);
  const payable=await recognize(context,f,purchase);
  await api(context,`/purchases/${purchase.purchase.id}/returns`,{return_date:'2026-01-18',reason:'Synthetic supplier return',items:[{purchase_item_id:purchase.items[0].id,qty_returned:'1.000'}]});
  const account=await read(context,`/finance/suppliers/${f.supplier}`);
  return {purchase,payable:payable.record,debit:account.debits[0]};
}
async function select(page,label,text) {
  const combobox=page.getByRole('combobox',{name:label,exact:true});
  let controls;
  try {
    await combobox.press('ArrowDown');
    await expect(combobox).toHaveAttribute('aria-expanded','true');
    controls=await combobox.getAttribute('aria-controls');assert.ok(controls,'Select identifies its own option list');
    const popup=page.locator('.ant-select-dropdown:visible').filter({has:page.locator(`[id=${JSON.stringify(controls)}]`)});
    await expect(popup).toHaveCount(1);
    const option=popup.locator('.ant-select-item-option-content').filter({hasText:text});
    await expect(option).toHaveCount(1);await expect(option).toHaveText(text);
    const chosenText=(await option.innerText()).trim();
    await option.click();
    await expect(combobox).toHaveAttribute('aria-expanded','false');
    await expect(page.locator('.ant-select').filter({has:combobox}).locator('.ant-select-selection-item')).toHaveText(chosenText);
  } catch(error) {
    console.error('Phase4 select failure',JSON.stringify({label,expected:String(text),controls,combobox:await combobox.evaluate(node=>node.outerHTML).catch(()=>null),popups:await page.locator('.ant-select-dropdown').evaluateAll(nodes=>nodes.map(node=>({visible:!!node.getClientRects().length,html:node.outerHTML}))).catch(()=>[])}));
    await page.screenshot({path:`/private/tmp/phase4-select-failure-${label.replace(/[^a-z0-9]+/gi,'-')}.png`,fullPage:true}).catch(()=>{});
    throw error;
  }
}
async function moneyFields(page,amount='20') {
  await page.getByLabel('Settlement amount',{exact:true}).fill(amount);
  await select(page,'Confirmed money mode','Split across modes');
  await select(page,'Money mode 1','CASH'); await page.getByLabel('Mode amount 1',{exact:true}).fill(String(Number(amount)/2));
  await select(page,'Money mode 2','UPI'); await page.getByLabel('Mode amount 2',{exact:true}).fill(String(Number(amount)/2));
  await page.getByLabel('Mode reference 2',{exact:true}).fill('Synthetic operator reference');
}
async function reviewSettlement(page,date=settlementDate) {
  await page.getByLabel('Settlement business date (Asia/Kolkata)',{exact:true}).fill(date);
  await page.getByLabel('Settlement reason',{exact:true}).fill('Synthetic reviewed settlement');
  await page.getByRole('checkbox',{name:'I confirm this event and any actual money movement.',exact:true}).check();
  await page.getByRole('button',{name:'Review settlement',exact:true}).click();
  await expect(page.getByRole('button',{name:'Confirm settlement',exact:true})).toBeVisible();
}
async function prepare(kind,page,context,f) {
  let domain=kind.startsWith('supplier') || kind.startsWith('payable') ? 'supplier':'customer';
  let route=`/settlements/${domain}/${f[domain]}`;
  let source, button, targets=[];
  let date=settlementDate;
  if(kind==='customer-advance') {
    await page.goto(`${origin}${route}`); await page.getByRole('button',{name:'Record customer advance',exact:true}).click();
    await page.getByLabel('Advance business date (Asia/Kolkata)',{exact:true}).fill(settlementDate);
    await page.getByLabel('Advance received amount',{exact:true}).fill('100'); await select(page,'Confirmed money mode','CASH');
    await page.getByLabel('Advance reason',{exact:true}).fill('Synthetic advance recovery');
    await page.getByRole('checkbox',{name:'I confirm the customer money was received.',exact:true}).check();
    await page.getByRole('button',{name:'Review advance receipt',exact:true}).click();
    return {operation:kind,path:'/api/payments',commit:'Confirm advance receipt',open:'Recover customer advance',route,
      verify:async()=>assert.equal((await fixtures.query('SELECT COUNT(*)::int AS count FROM payments WHERE customer_id=$1',[f.customer])).rows[0].count,1)};
  }
  if(kind==='customer_allocation' || kind==='customer_refund' || kind==='customer_reversal') {
    source=await advance(context,f);
    if(kind==='customer_allocation') {
      targets=[await sourceSale(context,f),await sourceSale(context,f)]; button=`Allocate source #${source.id}`;
    } else if(kind==='customer_refund') button=`Refund source #${source.id}`;
    else {
      const posted=await api(context,'/finance/customer/commands',{kind:'customer_refund',customer_id:f.customer,source_type:'advance',source_id:source.id,date:'2026-01-18',reason:'Synthetic original refund',amount:'20.00',mode:'mixed',modes_detail:[{mode:'cash',amount:'10.00'},{mode:'upi',amount:'10.00'}],operator_confirmed:true});
      button=`Reverse settlement #${posted.record.id}`; source=posted.record; date=reverseDate;
    }
  } else if(kind==='payment_reversal') {
    const sale=await sourceSale(context,f); source=await api(context,'/payments',{customer_id:f.customer,invoice_id:sale.invoice_id,payment_date:'2026-01-17',amount:'30.00',mode:'cash'});
    button=`Reverse receipt #${source.id}`; date=reverseDate;
  } else if(kind==='anonymous_refund' || kind==='anonymous_reversal') {
    const sale=await api(context,'/invoices',{customer_id:null,customer_name_walkin:'Synthetic Walk-in Buyer',bill_type:'quickbill',date:'2026-01-15',items:[{product_id:f.product,qty:'2.000',unit:'box',rate:'100.00'}],payment:{amount_paid:'200.00',modes:[{mode:'cash',amount:'200.00'}]}});
    const line=(await fixtures.query('SELECT id FROM invoice_items WHERE invoice_id=$1',[sale.invoice_id])).rows[0];
    await api(context,`/invoices/${sale.invoice_id}/return`,{return_date:'2026-01-16',reason:'Synthetic walk-in return',disposition:'sellable',items:[{invoice_item_id:line.id,qty_returned:'1.000'}]});
    const list=await read(context,'/finance/anonymous'); source=(list.liabilities||list).find(row=>row.original_invoice_id===sale.invoice_id);
    assert.ok(source); route='/settlements/anonymous'; button=`Refund liability #${source.source_id}`;
    if(kind==='anonymous_reversal') {
      const posted=await api(context,'/finance/customer/commands',{kind:'anonymous_refund',source_type:'anonymous_liability',source_id:source.source_id,date:'2026-01-18',reason:'Synthetic original walk-in refund',amount:'20.00',mode:'cash',operator_confirmed:true});
      button=`Reverse walk-in settlement #${posted.record.id}`; date=reverseDate;
    }
  } else if(kind==='payable_recognition' || kind==='payable_reversal') {
    source=await sourcePurchase(context,f);
    button=`Recognize payable for receipt #${source.purchase.id}`;
    if(kind==='payable_reversal') { source=(await recognize(context,f,source)).record; button=`Reverse payable #${source.id}`;date=reverseDate; }
  } else {
    const sources=await supplierSources(context,f); source=sources;
    if(kind==='supplier_payment') button=`Pay payable #${sources.payable.id}`;
    if(kind==='supplier_debit_application') {button=`Allocate source #${sources.debit.id}`;targets=[sources.payable];}
    if(kind==='supplier_refund') button=`Refund source #${sources.debit.id}`;
    if(kind==='supplier_payment_reversal' || kind==='supplier_refund_reversal') {
      const payment=kind==='supplier_payment_reversal';
      const posted=await api(context,'/finance/supplier/commands',{kind:payment?'supplier_payment':'supplier_refund',supplier_id:f.supplier,source_type:payment?'payable':'debit',source_id:payment?sources.payable.id:sources.debit.id,amount:'20.00',date:'2026-01-19',reason:'Synthetic original supplier event',operator_confirmed:true,mode:'mixed',modes_detail:[{mode:'cash',amount:'10.00'},{mode:'upi',amount:'10.00'}]});
      source=posted.record;button=`Reverse settlement #${source.id}`;date=reverseDate;
    }
  }
  await page.goto(`${origin}${route}`);
  if(kind==='payment_reversal') await page.getByRole('tab',{name:'Original customer receipts',exact:true}).click();
  if(kind==='customer_reversal' || kind.endsWith('_payment_reversal') || kind.endsWith('_refund_reversal')) await page.getByRole('tab',{name:'Settlements and reversals',exact:true}).click();
  if(kind==='anonymous_reversal') {
    await page.getByRole('row').filter({has:page.getByRole('button',{name:`Refund liability #${source.source_id}`,exact:true})}).getByRole('button',{name:'Expand row',exact:true}).click();
  }
  await page.getByRole('button',{name:button,exact:true}).click();
  if(kind==='customer_allocation') {
    for(let i=0;i<targets.length;i++) {
      if(i) await page.getByRole('button',{name:/Add invoice target$/}).click();
      await select(page,`Target invoice ${i+1}`,new RegExp(`^.+ #${targets[i].invoice_id} — due ₹200[.]00$`)); await page.getByLabel(`Allocation amount ${i+1}`,{exact:true}).fill('20');
    }
  }
  if(kind==='supplier_debit_application') {await select(page,'Target payable 1',new RegExp(`^Payable #${targets[0].id} — due ₹200[.]00$`));await page.getByLabel('Allocation amount 1',{exact:true}).fill('20');}
  if(['customer_refund','anonymous_refund','supplier_payment','supplier_refund'].includes(kind)) await moneyFields(page);
  if(kind==='payable_recognition') {await page.getByLabel('Supplier due date',{exact:true}).fill('2026-02-15');await page.getByLabel('Supplier document reference',{exact:true}).fill('Synthetic reviewed payable');}
  await reviewSettlement(page,date);
  return {operation:`${domain}-settlement`,path:`/api/finance/${domain}/commands`,commit:'Confirm settlement',open:'Recover saved settlement',route,source,targets,
    verify:async original=>{
      const payload=original.payload;
      if(payload.kind==='payable_recognition') assert.equal((await fixtures.query('SELECT COUNT(*)::int AS count FROM supplier_payables WHERE purchase_id=$1',[payload.purchase_id])).rows[0].count,1);
      else assert.equal((await fixtures.query('SELECT COUNT(*)::int AS count FROM settlement_events WHERE kind=$1 AND source_type=$2 AND source_id=$3 AND date=$4',[payload.kind,payload.source_type,payload.source_id,payload.date])).rows[0].count,1);
    }};
}
async function switchAccount(page,identity) {
  await page.goto(`${origin}/dashboard`); await expect(page.getByRole('heading',{name:'Dashboard',exact:true})).toBeVisible(); await page.getByRole('button',{name:/Logout$/}).click();await page.waitForURL(`${origin}/login`);await login(page,identity);
}
async function recover(page,context,control,command) {
 let lastResponse = null;
 try {
  control.drop=command.path; await page.getByRole('button',{name:command.commit,exact:true}).click();
  await expect.poll(async()=>(await savedIntent(page,command.operation))?.status).toBe('uncertain');
  const original=control.requests[0]; assert.equal(original.path,command.path);assert.equal(original.actor,String(userId));assert.ok(original.key);
  await command.verify(original);
  await page.reload(); await page.getByRole('button',{name:command.open,exact:true}).first().click();
  assert.equal(control.requests.length,1,'Reload must not replay');
  const other=await context.newPage();other.setDefaultTimeout(12000);await switchAccount(other,otherEmail);
  const [rejected]=await Promise.all([page.waitForResponse(res=>new URL(res.url()).pathname===command.path && res.request().method()==='POST'),page.getByRole('button',{name:'Retry saved operation',exact:true}).click()]);
  lastResponse={status:rejected.status(),code:(await rejected.json()).code};
  assert.equal(lastResponse.status,409);assert.equal(lastResponse.code,'OPERATION_ACTOR_MISMATCH');
  assert.equal((await savedIntent(page,command.operation)).status,'uncertain');assert.equal(await savedIntent(page,command.operation,otherUserId),null);
  assert.deepEqual(control.requests[1],original);
  await switchAccount(other,email);assert.equal(control.requests.length,2,'Account switching must not replay');
  await expect(page.getByRole('button',{name:'Retry saved operation',exact:true})).toHaveAttribute('aria-label','Retry saved operation');
  await page.getByRole('button',{name:'Retry saved operation',exact:true}).click();
  await expect.poll(async()=>(await savedIntent(page,command.operation))?.status).toBe('completed');
  assert.deepEqual(control.requests[2],original);await command.verify(original);return (await savedIntent(page,command.operation)).result;
 } catch(error) { console.log(JSON.stringify({recoveryFailure:{operation:command.operation,path:command.path,lastResponse,requests:control.requests,intent:await savedIntent(page,command.operation),buttons:await page.locator('button').filter({hasText:'Retry saved operation'}).evaluateAll(buttons=>buttons.map(button=>({html:button.outerHTML,busyRendered:button.classList.contains('ant-btn-loading'),disabled:button.disabled})))}}));throw error; }
}
for(const kind of ['customer-advance','customer_allocation','customer_refund','customer_reversal','payment_reversal','anonymous_refund','anonymous_reversal','payable_recognition','supplier_payment','supplier_debit_application','supplier_refund','supplier_payment_reversal','supplier_refund_reversal','payable_reversal']) {
  test(`Phase4 ${kind} lost commit, reload and account-switch recovery preserve original actor/key/payload`,async t=>{
    const f=await seed();const {page,context,control}=await session(t);const command=await prepare(kind,page,context,f);
    const result=await recover(page,context,control,command);
    if(kind.includes('anonymous')) assert.equal(result.record.customer_id,null);
    if(kind==='customer_allocation') {assert.equal(result.targets.length,2);assert.equal(result.cash_direction,null);assert.deepEqual(result.tenders,[]);}
    if(kind==='supplier_payment_reversal' || kind==='supplier_refund_reversal') assert.deepEqual(result.tenders.map(x=>[x.mode,x.amount]),[['cash','10.00'],['upi','10.00']]);
  });
}


test('Phase4 exhausted supplier quote is editable only on original account and preserves draft',async t=>{
 const f=await seed(),other=await seed();const {page,context,control}=await session(t);const command=await prepare('supplier_payment',page,context,f);
 await api(context,'/finance/supplier/commands',{kind:'supplier_payment',supplier_id:f.supplier,source_type:'payable',source_id:command.source.payable.id,date:settlementDate,reason:'Concurrent full settlement',amount:'200.00',mode:'cash',operator_confirmed:true});
 await page.getByRole('button',{name:'Confirm settlement',exact:true}).click();
 await expect.poll(async()=>(await savedIntent(page,'supplier-settlement'))?.status).toBe('rejected');
 const saved=await savedIntent(page,'supplier-settlement');assert.equal(saved.code,'PAYABLE_AMOUNT_EXCEEDED');
 await page.goto(`${origin}/settlements/supplier/${other.supplier}`);await page.getByRole('button',{name:'Recover saved settlement',exact:true}).click();
 await expect(page.getByRole('button',{name:'Edit and review',exact:true})).toHaveCount(0);
 await page.getByRole('link',{name:'Open saved document to edit',exact:true}).click();
 await page.getByRole('button',{name:'Recover saved settlement',exact:true}).click();await page.getByRole('button',{name:'Edit and review',exact:true}).click();
 await expect(page.getByLabel('Settlement reason',{exact:true})).toHaveValue('Synthetic reviewed settlement');await expect(page.getByLabel('Settlement amount',{exact:true})).toHaveValue(/^20(?:\.0+)?$/);
 assert.equal(control.requests.length,1);assert.equal(saved.payload.supplier_id,f.supplier);
});

test('Phase4 changed customer quote keeps entered targets and requires fresh review',async t=>{
 const f=await seed();const {page,context,control}=await session(t);const command=await prepare('customer_allocation',page,context,f);
 await api(context,'/finance/customer/commands',{kind:'customer_refund',customer_id:f.customer,source_type:'advance',source_id:command.source.id,date:settlementDate,reason:'Concurrent refund',amount:'1.00',mode:'cash',operator_confirmed:true});
 await page.getByRole('button',{name:'Confirm settlement',exact:true}).click();
 await expect.poll(async()=>(await savedIntent(page,'customer-settlement'))?.status).toBe('rejected');assert.equal((await savedIntent(page,'customer-settlement')).code,'SETTLEMENT_QUOTE_CHANGED');
 await page.getByRole('button',{name:'Edit and review',exact:true}).click();
 await expect(page.getByLabel('Settlement reason',{exact:true})).toHaveValue('Synthetic reviewed settlement');
 await expect(page.getByLabel('Allocation amount 1',{exact:true})).toHaveValue(/^20(?:\.0+)?$/);await expect(page.getByLabel('Allocation amount 2',{exact:true})).toHaveValue(/^20(?:\.0+)?$/);
 await page.getByRole('button',{name:'Review settlement',exact:true}).click();await expect(page.getByRole('button',{name:'Confirm settlement',exact:true})).toBeVisible();assert.equal(control.requests.length,1);
});

test('Phase4 customer return credit allocation changes due without creating money movement',async t=>{
 const f=await seed();const {page,context}=await session(t);
 const sale=await api(context,'/invoices',{customer_id:f.customer,bill_type:'retail',date:'2026-01-15',items:[{product_id:f.product,qty:'2.000',unit:'box',rate:'100.00'}],payment:{amount_paid:'200.00',modes:[{mode:'cash',amount:'200.00'}]}});
 const line=(await fixtures.query('SELECT id FROM invoice_items WHERE invoice_id=$1',[sale.invoice_id])).rows[0];
 await api(context,`/invoices/${sale.invoice_id}/return`,{return_date:'2026-01-16',reason:'Synthetic paid customer return',disposition:'sellable',items:[{invoice_item_id:line.id,qty_returned:'1.000'}]});
 const target=await sourceSale(context,f);const account=await read(context,`/finance/customers/${f.customer}`);const credit=account.sources.find(x=>x.source_type==='return_credit');assert.equal(credit.available_amount,'100.00');
 const before=await read(context,'/finance/reports');
 await page.goto(`${origin}/settlements/customer/${f.customer}`);await page.getByRole('button',{name:`Allocate source #${credit.source_id}`,exact:true}).click();await select(page,'Target invoice 1',new RegExp(`^.+ #${target.invoice_id} — due ₹200[.]00$`));await page.getByLabel('Allocation amount 1',{exact:true}).fill('20');await reviewSettlement(page);
 await page.getByRole('button',{name:'Confirm settlement',exact:true}).click();await expect.poll(async()=>(await savedIntent(page,'customer-settlement'))?.status).toBe('completed');
 const after=await read(context,'/finance/reports');assert.deepEqual(after.cash,before.cash);assert.deepEqual(after.sales,before.sales);
 const updated=await read(context,`/finance/customers/${f.customer}`);assert.equal(updated.sources.find(x=>x.source_id===credit.source_id && x.source_type==='return_credit').available_amount,'80.00');assert.equal(updated.invoices.find(x=>x.id===target.invoice_id).balance_due,'180.00');
});

test('Phase4 anonymous paid sale exposes return liability review without a customer',async t=>{
 const f=await seed();const {page,context}=await session(t);
 const sale=await api(context,'/invoices',{customer_id:null,customer_name_walkin:'Synthetic anonymous UI sale',bill_type:'quickbill',date:'2026-01-15',items:[{product_id:f.product,qty:'2.000',unit:'box',rate:'100.00'}],payment:{amount_paid:'200.00',modes:[{mode:'cash',amount:'200.00'}]}});
 await page.goto(`${origin}/invoices/${sale.invoice_id}`);await page.getByRole('button',{name:/Process Return$/}).click();await page.getByLabel(`Return quantity ${f.name}`,{exact:true}).fill('1');await page.getByLabel('Return reason',{exact:true}).fill('Synthetic anonymous UI return');await page.getByRole('button',{name:'Review return',exact:true}).click();
 await expect(page.getByRole('dialog')).toContainText('Walk-in liability');await page.getByRole('button',{name:'Confirm return',exact:true}).click();await expect.poll(async()=>(await savedIntent(page,'sales-return'))?.status).toBe('completed');
 assert.equal((await savedIntent(page,'sales-return')).result.customer_id,null);await page.goto(`${origin}/settlements/anonymous`);await expect(page.getByText('Synthetic anonymous UI sale',{exact:true})).toBeVisible();
});

test('Phase4 statements retain full-history balances across filters/pages and CSV; original receipts stay scoped',async t=>{
 const f=await seed(),other=await seed();const {page,context}=await session(t);await sourceSale(context,f);await advance(context,other,'7.00');
 for(let i=0;i<23;i++) await advance(context,f,'1.00');
 await page.goto(`${origin}/settlements/customer/${f.customer}`);await page.getByRole('tab',{name:'Original customer receipts',exact:true}).click();
 await expect(page.getByRole('button',{name:/Reverse receipt #/})).toHaveCount(20);await page.locator('.ant-tabs-tabpane-active').getByTitle('2',{exact:true}).click();await expect(page.getByRole('button',{name:/Reverse receipt #/})).toHaveCount(3);
 await page.getByRole('tab',{name:'Statement',exact:true}).click();await page.getByLabel('Statement from',{exact:true}).fill('2026-01-17');await page.getByLabel('Statement through',{exact:true}).fill('2026-01-17');await page.getByLabel('Statement as of',{exact:true}).fill('2026-01-17');await page.getByRole('button',{name:'Apply statement filters',exact:true}).click();
 const data=await read(context,`/finance/statements/customer/${f.customer}?from=2026-01-17&to=2026-01-17&as_of=2026-01-17&page=2&limit=20`);
 assert.equal(data.opening_balance,'200.00');assert.equal(data.closing_balance,'177.00');assert.equal(data.summary.count,23);assert.equal(data.rows.length,3);assert.equal(data.rows.at(-1).running_balance,'177.00');
 await expect(page.locator('.ant-descriptions-item-content').filter({hasText:'₹177.00'})).toBeVisible();
 await page.locator('.ant-tabs-tabpane-active').getByTitle('2',{exact:true}).click();await expect(page.locator('.ant-tabs-tabpane-active .ant-table-tbody > tr.ant-table-row')).toHaveCount(3);
 const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:'Export filtered statement CSV',exact:true}).click();const download=await downloaded;const path=`/private/tmp/phase4-statement-${run}.csv`;await download.saveAs(path);const csv=await readFile(path,'utf8');assert.equal(csv.trim().split('\n').length,24);assert.match(csv,/177\.00/);
 await page.goto(`${origin}/customers/${f.customer}`);
 const originalLedger=page.locator('#customer-ledger');await expect(originalLedger.getByRole('columnheader',{name:'Balance at posting',exact:true})).toBeVisible();
 await originalLedger.locator('.ant-picker').hover();
 const ledgerLoaded=page.waitForResponse(response=>new URL(response.url()).pathname===`/api/customers/${f.customer}/ledger` && !new URL(response.url()).searchParams.has('from'));
 await originalLedger.locator('.ant-picker-clear').click();
 const ledgerData=(await (await ledgerLoaded).json()).data;assert.equal(ledgerData.entries[0].balance,'177.00');assert.equal(ledgerData.entries[0].running_balance,undefined);
 await expect(originalLedger.locator('tr.ant-table-row').first().locator('td').last()).toHaveText('₹177.00');
 // Unknown posting evidence must remain visibly unknown; a verified zero remains zero.
 const unknownEntries=ledgerData.entries.slice(0,4).map((entry,index)=>({...entry,balance:[undefined,null,'not-a-number','0.00'][index]}));
 await context.route(`${origin}/api/customers/${f.customer}/ledger*`,route=>route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data:{...ledgerData,entries:unknownEntries,pagination:{page:1,limit:20,total:4,totalPages:1}}})}));
 await page.reload();await expect(originalLedger.locator('tr.ant-table-row')).toHaveCount(4);
 for(let i=0;i<3;i++) await expect(originalLedger.locator('tr.ant-table-row').nth(i).locator('td').last()).toHaveText('—');
 await expect(originalLedger.locator('tr.ant-table-row').nth(3).locator('td').last()).toHaveText('₹0.00');
});

test('Phase4 cashier has no settlement navigation and direct routes/API are denied',async t=>{
 const {page,context}=await session(t);await switchAccount(page,cashierEmail);await expect(page.getByRole('menuitem',{name:'Settlements',exact:true})).toHaveCount(0);
 for(const path of ['/settlements','/settlements/customer/1','/settlements/supplier/1','/settlements/anonymous','/settlements/day','/settlements/reports']) {await page.goto(`${origin}${path}`);await expect(page.getByText('This page is unavailable for your account',{exact:true})).toBeVisible();}
 const response=await context.request.get(`${origin}/api/finance/reports`);assert.equal(response.status(),403);assert.ok(cashierId);
});

test('Phase4 financial report cards and dues filters use full server summaries',async t=>{
 const {page,context}=await session(t);const f=await seed();const today=(await read(context,'/finance/days')).today;
 const sale=await api(context,'/invoices',{customer_id:f.customer,bill_type:'retail',date:today,items:[{product_id:f.product,qty:'2.000',unit:'box',rate:'100.00'}],payment:{amount_paid:'100.00',modes:[{mode:'cash',amount:'100.00'}],due_date:today}});
 const payment=await api(context,'/payments',{customer_id:f.customer,invoice_id:null,payment_date:today,amount:'20.00',mode:'cash',notes:'Synthetic report evidence'});
 const downloadSheet=async()=>{const downloaded=page.waitForEvent('download');await page.getByRole('button',{name:/Export Excel$/}).click();const download=await downloaded;const file=`/private/tmp/phase4-report-${randomUUID()}.xlsx`;await download.saveAs(file);const ExcelJS=requireBackend('exceljs');const workbook=new ExcelJS.Workbook();await workbook.xlsx.load(await readFile(file));return workbook.worksheets[0];};
 await page.goto(`${origin}/settlements/reports`);const summary=await read(context,'/finance/reports');await expect(page.getByText('Actual recorded money movements',{exact:true})).toBeVisible();
 for(const [label,key] of [['All money received','incoming'],['All money paid out','outgoing'],['Net money movement','net']]) {
  const cell=page.locator('tr').filter({has:page.getByText(label,{exact:true})});await expect(cell).toContainText(new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(summary.cash[key]));
 }
 const loaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reports/customer-dues');await page.goto(`${origin}/reports/dues`);const data=(await (await loaded).json()).data;
 for(const [label,key] of [['Invoice due','total_due'],['Overdue amount','overdue'],['Available customer funds','available_credit']]) await expect(page.locator('.ant-statistic').filter({has:page.getByText(label,{exact:true})})).toContainText(new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(data.summary[key]));
 const duesSheet=await downloadSheet();const duesRows=[];duesSheet.eachRow(row=>duesRows.push(row.values));const exportedCustomer=duesRows.find(row=>row[1]===f.customerName);assert.ok(exportedCustomer);assert.equal(exportedCustomer[5],100);assert.equal(exportedCustomer[6],20);assert.equal(exportedCustomer[11],1);
 const filtered=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reports/customer-dues' && new URL(response.url()).searchParams.get('customerType')==='wholesale');await page.getByRole('combobox').press('ArrowDown');await page.locator('.ant-select-item-option-content').filter({hasText:'Wholesale'}).click();assert.ok((await (await filtered).json()).data.customers.every(row=>row.type==='wholesale'));
 const overdue=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reports/customer-dues' && new URL(response.url()).searchParams.get('overdueOnly')==='true');await page.getByRole('switch').click();assert.equal((await overdue).status(),200);
 const salesLoaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reports/sales');await page.goto(`${origin}/reports/sales`);const sales=(await (await salesLoaded).json()).data;
 await expect(page.locator('.ant-statistic').filter({has:page.getByText('Receipts in date range',{exact:true})})).toContainText(new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(sales.summary.total_collected));
 const salesSheet=await downloadSheet();let exportedSale;salesSheet.eachRow(row=>{if(row.getCell(1).value===sale.invoice_no)exportedSale=row;});assert.ok(exportedSale);assert.equal(exportedSale.getCell(10).value,100);assert.equal(exportedSale.getCell(11).value,100);
 const collectionsLoaded=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/reports/collections');await page.goto(`${origin}/reports/collections`);const collections=(await (await collectionsLoaded).json()).data;
 for(const [label,key] of [['Money received','total_collected'],['Money paid out','total_refunded'],['Net money movement','net_collected']]) await expect(page.locator('.ant-statistic').filter({has:page.getByText(label,{exact:true})})).toContainText(new Intl.NumberFormat('en-IN',{style:'currency',currency:'INR'}).format(collections.summary[key]));
 const collectionsSheet=await downloadSheet();const collectionCells=[];collectionsSheet.eachRow(row=>collectionCells.push(row.values));assert.ok(collectionCells.some(row=>JSON.stringify(row).includes(f.customerName)));assert.ok(payment.id);
});

test('Phase4 dashboard identifies incomplete evidence and clears failed financial sections',async t=>{
 const {page,context}=await session(t);let state='clean';
 const summary={today_sales:970,today_collections:70,total_outstanding:970,low_stock_count:0,outstanding_debit_notes_total:20};
 for(const name of ['summary','overdue-invoices','payment-modes','recent-activity']) await context.route(`${origin}/api/dashboard/${name}*`,async route=>{
  if(state==='unavailable' && name!=='recent-activity') return route.fulfill({status:422,contentType:'application/json',body:JSON.stringify({success:false,error:'Synthetic reconciliation required',code:'CASH_RECONCILIATION_REQUIRED'})});
  const data=name==='summary'?{...summary,reconciliation_required:state==='summary'}:name==='overdue-invoices'?{invoices:[],reconciliation_required:state==='overdue-invoices'}:name==='payment-modes'?[{mode:'cash',total:70,count:2,reconciliation_required:state==='payment-modes'}]:[{id:1,activity_type:'payment',reference:'Synthetic original receipt',customer_name:'Synthetic issued buyer',amount:70,date:'2026-02-01'}];
  return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify({success:true,data})});
 });
 await page.goto(`${origin}/dashboard`);await expect(page.getByText('Synthetic original receipt',{exact:true})).toBeVisible();await expect(page.getByText('Payment',{exact:true})).toBeVisible();await expect(page.getByText('(2 incoming tender portions)',{exact:true})).toBeVisible();
 await expect(page.locator('.ant-statistic').filter({has:page.getByText('Total Outstanding',{exact:true})})).toContainText('₹970.00');
 for(const flag of ['summary','overdue-invoices','payment-modes']) {state=flag;await page.goto(`${origin}/dashboard`);await expect(page.getByText('Financial totals are incomplete or unverified',{exact:true})).toBeVisible();}
 state='unavailable';await page.getByRole('button',{name:/Refresh$/}).click();await expect(page.getByText('Some financial sections are unavailable',{exact:true})).toBeVisible();await expect(page.getByRole('alert').filter({hasText:'Some financial sections'})).toContainText('422: CASH_RECONCILIATION_REQUIRED');
 await expect(page.getByText('Total Outstanding',{exact:true})).toHaveCount(0);await expect(page.getByText('Payment mode totals unavailable',{exact:true})).toBeVisible();await expect(page.getByText('Overdue invoices unavailable',{exact:true})).toBeVisible();await expect(page.getByText('No overdue invoices',{exact:true})).toHaveCount(0);
});

test('Phase4 delayed source quote cannot overwrite a different reviewed refund',async t=>{
 const f=await seed();const {page,context,control}=await session(t);const first=await advance(context,f,'40.00'),second=await advance(context,f,'50.00');
 let release;const gate=new Promise(resolve=>{release=resolve;});control.holdQuote={sourceId:first.id,gate,release,started:false};
 await page.goto(`${origin}/settlements/customer/${f.customer}`);await page.getByRole('button',{name:`Refund source #${first.id}`,exact:true}).click();await moneyFields(page);
 await page.getByLabel('Settlement business date (Asia/Kolkata)',{exact:true}).fill(settlementDate);await page.getByLabel('Settlement reason',{exact:true}).fill('First delayed quote');await page.getByRole('checkbox',{name:'I confirm this event and any actual money movement.',exact:true}).check();await page.getByRole('button',{name:'Review settlement',exact:true}).click();await expect.poll(()=>control.holdQuote.started).toBe(true);
 await page.getByRole('dialog').getByRole('button',{name:'Close',exact:true}).click();await page.getByRole('button',{name:`Refund source #${second.id}`,exact:true}).click();await moneyFields(page);await reviewSettlement(page);
 const oldResponse=page.waitForResponse(response=>new URL(response.url()).pathname==='/api/finance/customer/quote' && response.request().postDataJSON().source_id===first.id);release();await oldResponse;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));
 await expect(page.getByRole('dialog')).toContainText(`Advance receipt #${second.id}`);await expect(page.getByRole('dialog')).not.toContainText(`Advance receipt #${first.id}`);
 await page.getByRole('button',{name:'Confirm settlement',exact:true}).click();await expect.poll(async()=>(await savedIntent(page,'customer-settlement'))?.status).toBe('completed');assert.equal((await savedIntent(page,'customer-settlement')).payload.source_id,second.id);
 const account=await read(context,`/finance/customers/${f.customer}`);assert.equal(account.sources.find(row=>row.source_id===first.id).available_amount,'40.00');assert.equal(account.sources.find(row=>row.source_id===second.id).available_amount,'30.00');control.holdQuote=null;
});

test('Phase4 delayed prior business-date response cannot overwrite selected day',async t=>{
 const {page,context,control}=await session(t);await api(context,'/finance/days/open',{date:'2026-02-10',opening_float:'20.00',reason:'Synthetic day opening',operator_confirmed:true});
 let release;const gate=new Promise(resolve=>{release=resolve;});control.holdDay={date:'2026-02-09',gate,release,started:false};
 await page.goto(`${origin}/settlements/day?date=2026-02-09`);await expect.poll(()=>control.holdDay.started).toBe(true);await page.getByLabel('Business date (Asia/Kolkata)',{exact:true}).fill('2026-02-10');await expect(page.getByText('Open business day 2026-02-10',{exact:true})).toBeVisible();const oldResponse=page.waitForResponse(response=>response.url().includes('/api/finance/days?date=2026-02-09'));release();await oldResponse;await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await expect(page.getByText('Open business day 2026-02-10',{exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Close shop day',exact:true})).toBeVisible();control.holdDay=null;
});

test('Phase4 day close stale quote, discrepancy, lost commit/replay and closed-date guard',async t=>{
 const f=await seed();const {page,context,control}=await session(t);
 await api(context,'/payments',{customer_id:f.customer,invoice_id:null,payment_date:'2026-02-10',amount:'100.00',mode:'mixed',modes_detail:[{mode:'cash',amount:'80.00'},{mode:'upi',amount:'20.00'}]});
 await page.goto(`${origin}/settlements/day?date=2026-02-10`);await page.getByRole('button',{name:'Close shop day',exact:true}).click();await page.getByLabel('Counted closing cash',{exact:true}).fill('95');await page.getByLabel('Close reason',{exact:true}).fill('Synthetic counted discrepancy');await page.getByRole('checkbox',{name:'I confirm the cash was physically counted.',exact:true}).check();await page.getByRole('button',{name:'Review daily close',exact:true}).click();
 await expect(page.getByRole('button',{name:'Confirm daily close',exact:true})).toBeVisible();
 await api(context,'/payments',{customer_id:f.customer,invoice_id:null,payment_date:'2026-02-10',amount:'10.00',mode:'cash'});
 await page.getByRole('button',{name:'Confirm daily close',exact:true}).click();await expect.poll(async()=>(await savedIntent(page,'day-close'))?.status).toBe('rejected');assert.equal((await savedIntent(page,'day-close')).code,'DAY_QUOTE_CHANGED');
 await page.getByRole('button',{name:'Edit and review',exact:true}).click();await expect(page.getByLabel('Counted closing cash',{exact:true})).toHaveValue(/^95(?:\.0+)?$/);await page.getByRole('button',{name:'Review daily close',exact:true}).click();control.requests=[];
 const receipt=await recover(page,context,control,{operation:'day-close',path:'/api/finance/days/close',commit:'Confirm daily close',open:'Recover daily close',verify:async()=>{const day=await read(context,'/finance/days?date=2026-02-10');assert.equal(day.closed.expected_cash,'110.00');assert.equal(day.closed.discrepancy,'-15.00');}});
 assert.equal(receipt.record.counted_cash,'95.00');await page.getByRole('button',{name:'Done',exact:true}).click();await expect(page.getByText('Closed business day 2026-02-10',{exact:true})).toBeVisible();
 const response=await context.request.post(`${origin}/api/payments`,{data:{customer_id:f.customer,invoice_id:null,payment_date:'2026-02-10',amount:'1.00',mode:'cash'},headers:{Origin:origin,'Idempotency-Key':randomUUID(),'Idempotency-Actor':String(userId)}});assert.equal(response.status(),409);assert.equal((await response.json()).code,'FINANCIAL_PERIOD_CLOSED');
});

test('Phase4 next-day opening explicit float survives lost response and original-actor recovery',async t=>{
 const {page,context,control}=await session(t);await page.goto(`${origin}/settlements/day?date=2026-02-11`);await page.getByRole('button',{name:'Open shop day',exact:true}).click();await page.getByLabel('Explicit opening float',{exact:true}).fill('95');await page.getByLabel('Opening reason',{exact:true}).fill('Synthetic next day physical float');await page.getByRole('checkbox',{name:'I confirm the explicit opening float.',exact:true}).check();await page.getByRole('button',{name:'Review day opening',exact:true}).click();
 const receipt=await recover(page,context,control,{operation:'day-open',path:'/api/finance/days/open',commit:'Confirm day opening',open:'Recover day opening',verify:async()=>assert.equal((await read(context,'/finance/days?date=2026-02-11')).opening.opening_float,'95.00')});assert.equal(receipt.record.opening_float,'95.00');
});
