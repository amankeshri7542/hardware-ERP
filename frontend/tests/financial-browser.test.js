import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { randomUUID, randomInt } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { access } from 'node:fs/promises';
import { chromium, expect } from '@playwright/test';
assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__,true,'Install the loopback-only Node preload before imports');
assert.equal(process.env.NODE_ENV,'test');
assert.match(process.env.DB_NAME || '',/_test$/);
assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST));
const origin='http://localhost:5173';
assert.equal(process.env.CORS_ORIGIN,origin);
const requireBackend=createRequire(new URL('../../backend/package.json',import.meta.url));
const express=requireBackend('express');
const bcrypt=requireBackend('bcrypt');
const {Pool}=requireBackend('pg');
const app=requireBackend('./src/app');
const {pool}=requireBackend('./src/config/db');
const fixtures=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.FIXTURE_DB_USER,password:process.env.FIXTURE_DB_PASSWORD});
const run=randomUUID(); const password=`Synthetic-financial-${run}`;
const email=`financial-${run}@example.invalid`;
const otherEmail=`financial-other-${run}@example.invalid`;
let otherUserId;
let userId,browser,server,sessionNumber=1;
before(async()=>{
 const dist=fileURLToPath(new URL('../dist/',import.meta.url));await access(`${dist}/index.html`);
 userId=(await fixtures.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",['Synthetic financial browser',email,await bcrypt.hash(password,4)])).rows[0].id;
 otherUserId=(await fixtures.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",['Synthetic other administrator',otherEmail,await bcrypt.hash(password,4)])).rows[0].id;
 const web=express();web.use(app);web.use(express.static(dist));web.get(/^(?!\/api).*/,(_req,res)=>res.sendFile(`${dist}/index.html`));
 server=await new Promise((resolve,reject)=>{const candidate=web.listen(5173,'127.0.0.1',()=>resolve(candidate));candidate.once('error',reject);});
 browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();if(server) await new Promise(resolve=>server.close(resolve));await pool.end();await fixtures.end();});
async function seed(gst='0.00',rate='10.01') {
 const suffix=randomUUID(); const name=`Synthetic item ${suffix}`;const customerName=`Synthetic customer ${suffix}`;
 const product=(await fixtures.query("INSERT INTO products(name,category,unit,base_unit,mrp,wholesale_price,purchase_price,current_stock,gst_rate) VALUES($1,'Test','piece','piece',$2,$2,1,100,$3) RETURNING id",[name,rate,gst])).rows[0].id;
 await fixtures.query("INSERT INTO product_unit_conversions(product_id,unit_name,conversion_value,is_sales_unit) VALUES($1,'box',8,true)",[product]);
 const customer=(await fixtures.query("INSERT INTO customers(name,phone,type) VALUES($1,$2,'retail') RETURNING id",[customerName,String(randomInt(1000000000,9999999999))])).rows[0].id;
 return {product,customer,name,customerName};
}
async function loginPage(page,identity=email){
 await page.goto(`${origin}/login`);await page.getByLabel('Username / Email').fill(identity);await page.getByLabel('Password',{exact:true}).fill(password);
 await page.getByRole('button',{name:/sign in/i}).click();await page.waitForURL(`${origin}/dashboard`);
}
async function session(t){
 const context=await browser.newContext({serviceWorkers:'block',extraHTTPHeaders:{'X-Forwarded-For':`127.0.0.${++sessionNumber}`}});const attempted=new Set();
 const control={drop:null,requests:[],quoteGate:null,quoteReached:null,paymentGate:null,paymentReached:null};
 await context.routeWebSocket('**/*',socket=>{attempted.add('websocket');socket.close();});
 await context.route('**/*',async route=>{
  const request=route.request();const url=new URL(request.url());
  if(url.protocol==='data:' || (url.protocol==='blob:' && url.origin===origin)) return route.continue();
  if(url.origin!==origin){attempted.add(url.origin);return route.abort('blockedbyclient');}
  if(request.method()==='POST' && ['/api/invoices','/api/payments'].includes(url.pathname)) control.requests.push({path:url.pathname,key:request.headers()['idempotency-key'],actor:request.headers()['idempotency-actor'],payload:request.postDataJSON()});
  const response=await route.fetch({maxRedirects:0,maxRetries:0});
  if(response.status()>=400) console.error('Local test HTTP status',request.method(),url.pathname,response.status());
  const location=response.headers().location;
  if(location && new URL(location,url).origin!==origin){attempted.add(new URL(location,url).origin);return route.abort('blockedbyclient');}
  if(url.pathname==='/api/invoices/quote' && control.quoteGate){control.quoteReached?.();await control.quoteGate;}
  if(request.method()==='POST' && url.pathname==='/api/payments' && control.paymentGate){control.paymentReached?.();await control.paymentGate;}
  if(request.method()==='POST' && url.pathname===control.drop){control.drop=null;assert.equal(response.status(),201,'Drop only a real successful committed response');return route.abort('failed');}
  return route.fulfill({response});
 });
 t.after(()=>assert.equal(attempted.size,0,'No nonlocal browser request or WebSocket may be attempted'));t.after(()=>context.close());
 const page=await context.newPage();page.setDefaultTimeout(12000);
 const runtime=[];page.on('pageerror',error=>runtime.push(error.message));t.after(()=>assert.deepEqual(runtime,[]));
 await loginPage(page);return {context,page,control};
}
async function addProduct(page,fixture,quick=false){
 await page.getByPlaceholder(quick ? 'Search products...' : 'Search product by name, code, or barcode...').fill(fixture.name);
 try {await page.locator('.product-search-item').filter({hasText:fixture.name}).click();} catch(error){console.error('Synthetic product search state:',await page.locator('body').innerText());throw error;}
 await expect(page.locator('.billing-qty-input input')).toBeFocused();
}
async function chooseCustomer(page,fixture){await page.getByPlaceholder('Search customers by name, phone, or business...').fill(fixture.customerName);await page.locator('.customer-search-item').filter({hasText:fixture.customerName}).click();}
async function clickQuick(page){try {await page.getByRole('button',{name:/Quick Bill \(F9\)$/}).click();} catch(error){ console.error('Synthetic UI state:',await page.locator('body').innerText(),await page.locator('button').filter({hasText:'Quick Bill (F9)'}).evaluateAll(nodes=>nodes.map(node=>({text:node.textContent,html:node.outerHTML,parents:[...function*(item){while(item){yield `${item.tagName}:${item.getAttribute('aria-hidden')}`;item=item.parentElement;}}(node)]}))));throw error;}}
async function confirm(page){
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/invoices' && r.request().method()==='POST');
 await page.getByRole('button',{name:'Confirm invoice',exact:true}).click();
 const received=await response;assert.equal(received.status(),201,JSON.stringify(await received.json()));return (await received.json()).data;
}
async function reviewQuick(page,fixture){await page.goto(`${origin}/billing/quick`);await addProduct(page,fixture,true);await clickQuick(page);await expect(page.getByRole('dialog',{name:'Review invoice totals'})).toBeVisible();}

test('decimal selected-unit sale and exact mixed tenders reconcile to authoritative invoice, stock and ledger',async t=>{
 const fixture=await seed('18.00');const {page,control}=await session(t);await page.goto(`${origin}/billing`);await chooseCustomer(page,fixture);await addProduct(page,fixture);
 const row=page.locator('.billing-table tbody tr[data-row-key]').first();await row.locator('.ant-select-selector').first().click();await page.getByText('box',{exact:true}).last().click();
 await expect(page.locator('.billing-rate-input input')).toHaveValue('');await page.locator('.billing-rate-input input').fill('10.01');
 await page.locator('.billing-qty-input input').fill('0.125');await page.locator('.billing-disc-input input').fill('12.50');
 const payment=page.locator('.payment-card');await payment.getByPlaceholder('Amount',{exact:true}).fill('0.10');await payment.locator('button').filter({has:page.locator('.anticon-plus')}).click();
 await payment.getByRole('button',{name:/UPI$/}).click();await payment.getByPlaceholder('Amount',{exact:true}).fill('1.20');await payment.locator('button').filter({has:page.locator('.anticon-plus')}).click();
 await page.getByRole('button',{name:/Finalise Bill \(F9\)$/}).click();await expect(page.getByRole('dialog',{name:'Review invoice totals'})).toContainText('0.125 box');
 const receipt=await confirm(page);assert.equal(receipt.grand_total,'1.30');assert.equal(receipt.balance_due,'0.00');assert.equal(receipt.items[0].base_qty,'1.000');
 const payload=control.requests[0].payload;assert.deepEqual(Object.keys(payload.items[0]).sort(),['discount_pct','product_id','qty','rate','unit']);assert.equal(payload.items[0].rate,'10.01');assert.equal(payload.payment.amount_paid,'1.30');
 const stock=(await fixtures.query('SELECT current_stock,mrp FROM products WHERE id=$1',[fixture.product])).rows[0];assert.equal(stock.current_stock,'99.000');assert.equal(stock.mrp,'10.01');
 assert.equal((await fixtures.query('SELECT outstanding_balance FROM customers WHERE id=$1',[fixture.customer])).rows[0].outstanding_balance,'0.00');
 assert.equal((await fixtures.query('SELECT COUNT(*)::int AS n FROM payment_modes_detail d JOIN payments p ON p.id=d.payment_id WHERE p.invoice_id=$1',[receipt.invoice_id])).rows[0].n,2);
 await expect(page.getByRole('heading',{name:'Invoice Created!'})).toBeVisible();await expect(page.getByRole('button',{name:/PDF unavailable$/})).toBeDisabled();
});

test('lost invoice response survives reload and explicit retry records one paid anonymous Quick Bill',async t=>{
 const fixture=await seed('18.00');const {page,control}=await session(t);await reviewQuick(page,fixture);control.drop='/api/invoices';
 await page.getByRole('button',{name:'Confirm invoice',exact:true}).dblclick();await expect(page.getByText('Invoice outcome needs confirmation')).toBeVisible();
 assert.equal(control.requests.length,1);const first=control.requests[0];await page.reload();await expect(page.getByRole('button',{name:'Retry original invoice'})).toBeVisible();assert.equal(control.requests.length,1);
 await page.getByRole('button',{name:'Retry original invoice'}).click();await expect(page.getByRole('button',{name:'New Quick Bill'})).toBeVisible();assert.equal(control.requests.length,2);assert.deepEqual(control.requests[1],first);
 const rows=(await fixtures.query('SELECT i.id,i.grand_total,i.amount_paid,i.balance_due FROM invoices i JOIN invoice_items li ON li.invoice_id=i.id WHERE li.product_id=$1',[fixture.product])).rows;assert.equal(rows.length,1);assert.equal(rows[0].grand_total,rows[0].amount_paid);assert.equal(rows[0].balance_due,'0.00');
 assert.equal((await fixtures.query("SELECT COUNT(*)::int n FROM customer_ledger WHERE reference_id=$1 AND reference_type='invoice'",[rows[0].id])).rows[0].n,0);
 await page.getByRole('button',{name:'New Quick Bill'}).click();await addProduct(page,fixture,true);await clickQuick(page);await confirm(page);assert.notEqual(control.requests[2].key,first.key);
});

test('expired authentication preserves exact invoice intent without replay on login',async t=>{
 const fixture=await seed();const {page,control}=await session(t);await reviewQuick(page,fixture);
 await fixtures.query("UPDATE auth_sessions SET created_at=NOW()-INTERVAL '9 hours',expires_at=NOW()-INTERVAL '1 minute' WHERE user_id=$1",[userId]);
 await page.getByRole('button',{name:'Confirm invoice',exact:true}).click();await page.waitForURL(`${origin}/login`);assert.equal(control.requests.length,1);
 await loginPage(page);assert.equal(control.requests.length,1);await page.goto(`${origin}/billing/quick`);await expect(page.getByRole('button',{name:'Retry original invoice'})).toBeVisible();assert.equal(control.requests.length,1);
 await page.getByRole('button',{name:'Retry original invoice'}).click();await expect(page.getByRole('button',{name:'New Quick Bill'})).toBeVisible();assert.deepEqual(control.requests[1],control.requests[0]);
});

test('catalog changes require a fresh explicit quote review and rejected intent gets a new key',async t=>{
 const fixture=await seed('0.00','10.00');const {page,control}=await session(t);await reviewQuick(page,fixture);
 await fixtures.query('UPDATE products SET gst_rate=18 WHERE id=$1',[fixture.product]);await page.getByRole('button',{name:'Confirm invoice',exact:true}).click();
 await expect(page.getByText('Invoice was not recorded')).toBeVisible();assert.equal((await fixtures.query('SELECT COUNT(*)::int n FROM invoice_items WHERE product_id=$1',[fixture.product])).rows[0].n,0);
 await page.getByRole('button',{name:'Edit and review again'}).click();await clickQuick(page);
 await expect(page.getByText('Server totals differ from the draft. Review the updated amounts before confirming.')).toBeVisible();const receipt=await confirm(page);assert.equal(receipt.grand_total,'11.80');assert.notEqual(control.requests[0].key,control.requests[1].key);
});

test('draft edits during an outstanding quote invalidate review before any financial post',async t=>{
 const fixture=await seed();const {page,control}=await session(t);await page.goto(`${origin}/billing/quick`);await addProduct(page,fixture,true);
 let release;control.quoteGate=new Promise(resolve=>{release=resolve;});const reached=new Promise(resolve=>{control.quoteReached=resolve;});
 await clickQuick(page);await reached;await page.locator('.billing-rate-input input').fill('20.00');release();
 await expect(page.getByText('The draft changed while totals were checked. Review it again.')).toBeVisible();await expect(page.getByRole('button',{name:'Confirm invoice',exact:true})).toHaveCount(0);assert.equal(control.requests.length,0);
});

test('registered Quick Bill debt and lost payment response use authoritative balances and one receipt',async t=>{
 const fixture=await seed('0.00','10.00');const {page,control}=await session(t);await page.goto(`${origin}/billing`);await chooseCustomer(page,fixture);await addProduct(page,fixture);
 await page.locator('.ant-radio-button-wrapper').filter({hasText:'Quick'}).click();
 const date=new Date();date.setDate(date.getDate()+1);const dateText=`${String(date.getDate()).padStart(2,'0')}-${String(date.getMonth()+1).padStart(2,'0')}-${date.getFullYear()}`;
 await page.getByPlaceholder('Select date').fill(dateText);await page.getByPlaceholder('Select date').press('Enter');
 await page.getByRole('button',{name:/Finalise Bill \(F9\)$/}).click();const invoice=await confirm(page);assert.equal(invoice.bill_type,'quickbill');assert.equal(invoice.balance_due,'10.00');
 assert.equal((await fixtures.query('SELECT outstanding_balance FROM customers WHERE id=$1',[fixture.customer])).rows[0].outstanding_balance,'10.00');
 await page.goto(`${origin}/invoices/${invoice.invoice_id}`);await page.getByRole('button',{name:/Record Payment$/}).click();
 const dialog=page.getByRole('dialog',{name:'Record Payment'});await dialog.getByRole('spinbutton').fill('0.30');control.drop='/api/payments';await dialog.getByRole('button',{name:'Record Payment',exact:true}).click();
 await expect(page.getByText('Payment outcome needs confirmation')).toBeVisible();await page.reload();await page.getByRole('button',{name:'Recover saved payment'}).click();
 // Keep the actual committed replay response pending to exercise the loading icon's accessible name.
 let releasePayment;control.paymentGate=new Promise(resolve=>{releasePayment=resolve;});const paymentReached=new Promise(resolve=>{control.paymentReached=resolve;});
 await page.getByRole('button',{name:'Retry original payment'}).click();await paymentReached;
 const retryButton=page.getByRole('dialog').locator('button').filter({hasText:'Retry original payment'});
 try {await expect(retryButton.getByRole('img',{name:'loading',exact:true})).toBeVisible();await expect(retryButton).toHaveAccessibleName('Retry original payment');await expect(retryButton).toBeDisabled();await expect(retryButton).toHaveAttribute('aria-busy','true');}
 finally {releasePayment();}

 await expect(page.getByText('Payment recorded',{exact:true})).toBeVisible();await expect(page.getByRole('dialog')).toContainText('9.70');
 const payments=control.requests.filter(item=>item.path==='/api/payments');assert.equal(payments.length,2);assert.deepEqual(payments[0],payments[1]);
 assert.equal((await fixtures.query('SELECT COUNT(*)::int n FROM payments WHERE invoice_id=$1',[invoice.invoice_id])).rows[0].n,1);
 assert.equal((await fixtures.query('SELECT balance_due FROM invoices WHERE id=$1',[invoice.invoice_id])).rows[0].balance_due,'9.70');
 const done=page.getByRole('button',{name:'Done',exact:true});await expect(done).toHaveAttribute('aria-busy','false');
 await done.click();await expect(page.getByRole('dialog')).toHaveCount(0);
 const summary=page.locator('.ant-card').filter({has:page.getByText('Payment Summary',{exact:true})});
 await expect(summary).toContainText('₹9.70');await expect(summary).toContainText('₹0.30');
 const history=page.locator('.ant-card').filter({has:page.getByText('Payment History',{exact:true})});
 await expect(history.locator('tbody tr[data-row-key]')).toHaveCount(1);await expect(history).toContainText('₹0.30');
});

test('two tabs finalizing together share one persisted invoice operation',async t=>{
 const fixture=await seed();const {page,context,control}=await session(t);await reviewQuick(page,fixture);
 const second=await context.newPage();second.setDefaultTimeout(12000);await reviewQuick(second,fixture);
 const clickConfirm=()=>{const button=[...document.querySelectorAll('button')].find(node=>node.textContent.trim()==='Confirm invoice');button?.click();};
 await Promise.all([page.evaluate(clickConfirm),second.evaluate(clickConfirm)]);
 await expect(page.getByRole('button',{name:'New Quick Bill'})).toBeVisible();await expect(second.getByRole('button',{name:'New Quick Bill'})).toBeVisible();
 assert.equal(control.requests.length,1,'Concurrent tabs must share the original operation, never overwrite its key');
 assert.equal((await fixtures.query('SELECT COUNT(*)::int n FROM invoice_items WHERE product_id=$1',[fixture.product])).rows[0].n,1);
});

test('a named walk-in cannot create Quick Bill debt and explicit full tender uses server totals',async t=>{
 const fixture=await seed('0.00','10.00');const {page,control}=await session(t);await page.goto(`${origin}/billing`);
 await page.locator('.ant-radio-button-wrapper').filter({hasText:'Quick'}).click();await page.getByPlaceholder('Walk-in customer name (optional)').fill('Synthetic named walk-in');await addProduct(page,fixture);
 await page.getByRole('button',{name:/Finalise Bill \(F9\)$/}).click();await expect(page.getByText('Walk-in customers must pay the quoted total in full. Select a registered customer to allow dues.')).toBeVisible();assert.equal(control.requests.length,0);
 await page.getByRole('button',{name:'Full',exact:true}).click();await page.getByRole('button',{name:/Finalise Bill \(F9\)$/}).click();const invoice=await confirm(page);assert.equal(invoice.customer_id,null);assert.equal(invoice.status,'paid');assert.equal(invoice.balance_due,'0.00');assert.equal(control.requests[0].payload.customer_name_walkin,'Synthetic named walk-in');
});

test('a shared-cookie account switch cannot replay an uncertain invoice as another administrator',async t=>{
 const fixture=await seed();const {page,context,control}=await session(t);await reviewQuick(page,fixture);control.drop='/api/invoices';
 await page.getByRole('button',{name:'Confirm invoice',exact:true}).click();await expect(page.getByText('Invoice outcome needs confirmation')).toBeVisible();
 const original=control.requests[0];
 const other=await context.newPage();other.setDefaultTimeout(12000);await other.goto(`${origin}/dashboard`);
 await other.getByRole('button',{name:/Logout$/}).click();await other.waitForURL(`${origin}/login`);await loginPage(other,otherEmail);
 const response=page.waitForResponse(r=>new URL(r.url()).pathname==='/api/invoices' && r.request().method()==='POST');
 await page.getByRole('button',{name:'Retry original invoice'}).click();const rejected=await response;
 assert.equal(rejected.status(),409,'The old actor must be rejected before a second financial effect');assert.equal((await rejected.json()).code,'OPERATION_ACTOR_MISMATCH');
 assert.equal(original.actor,String(userId));assert.notEqual(original.actor,String(otherUserId));assert.deepEqual(control.requests[1],original);
 await expect(page.getByText('Invoice outcome needs confirmation')).toBeVisible();await expect(page.getByRole('button',{name:'Retry original invoice'})).toBeVisible();
 assert.equal((await fixtures.query('SELECT COUNT(*)::int n FROM invoice_items WHERE product_id=$1',[fixture.product])).rows[0].n,1);
 await other.getByRole('button',{name:/Logout$/}).click();await other.waitForURL(`${origin}/login`);await loginPage(other,email);
 await page.getByRole('button',{name:'Retry original invoice'}).click();await expect(page.getByRole('button',{name:'New Quick Bill'})).toBeVisible();
 assert.deepEqual(control.requests[2],original);assert.equal((await fixtures.query('SELECT COUNT(*)::int n FROM invoice_items WHERE product_id=$1',[fixture.product])).rows[0].n,1);
});
