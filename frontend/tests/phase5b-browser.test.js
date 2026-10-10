import {test,observe,downloadFile} from './helpers/browserEvidence.js';
import {before,after} from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID,randomInt} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {mkdtemp,readFile,rename,realpath} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {chromium,expect} from '@playwright/test';
assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__,true);
assert.equal(process.env.NODE_ENV,'test');assert.match(process.env.DB_NAME,/_test$/);
assert.ok(['127.0.0.1','localhost','::1'].includes(process.env.DB_HOST));
assert.notEqual(process.env.DB_USER,process.env.FIXTURE_DB_USER);
assert.ok(process.env.TEST_DOCUMENT_WORKER_USER);assert.notEqual(process.env.TEST_DOCUMENT_WORKER_USER,process.env.FIXTURE_DB_USER);
const artifacts=await realpath(await mkdtemp(path.join(tmpdir(),'hardware-doc-browser-')));
Object.assign(process.env,{DOCUMENT_RUNTIME_MODE:'synthetic-local',DOCUMENT_SELLER_CONFIRMED:'true',DOCUMENT_ARTIFACT_ROOT:artifacts,
 DOCUMENT_RENDERER_DRIVER:process.platform==='darwin'?'macos-sandbox':'docker',STORE_NAME:'Synthetic Hardware Store',STORE_ADDRESS:'Synthetic Local Test Address',STORE_PHONE:'0000000000',STORE_GSTIN:'SYNTHETIC-UNVERIFIED'});
const root=fileURLToPath(new URL('../../',import.meta.url)),dist=path.join(root,'frontend/dist'),origin='http://localhost:5173';
assert.equal(process.env.CORS_ORIGIN,origin);
const req=createRequire(new URL('../../backend/package.json',import.meta.url));
const express=req('express'),bcrypt=req('bcrypt'),{Pool}=req('pg'),app=req('./src/app'),{pool}=req('./src/config/db');
const fixtures=new Pool({host:process.env.DB_HOST,port:Number(process.env.DB_PORT),database:process.env.DB_NAME,user:process.env.FIXTURE_DB_USER,password:process.env.FIXTURE_DB_PASSWORD});
const nonce=randomUUID(),password=`Synthetic-doc-${nonce}`,email=`documents-${nonce}@example.invalid`,otherEmail=`documents-other-${nonce}@example.invalid`,cashierEmail=`documents-cashier-${nonce}@example.invalid`;
let actor,otherActor,browser,server,sessionNo=170;
before(async()=>{
 for(const [identity,name] of [[email,'Synthetic documents admin'],[otherEmail,'Synthetic other admin']]){
  const row=(await fixtures.query("INSERT INTO users(name,email,password_hash,role) VALUES($1,$2,$3,'admin') RETURNING id",[name,identity,await bcrypt.hash(password,4)])).rows[0];if(identity===email)actor=row.id;else otherActor=row.id;
 }
 await fixtures.query("INSERT INTO users(name,email,password_hash,role) VALUES('Synthetic document cashier',$1,$2,'cashier')",[cashierEmail,await bcrypt.hash(password,4)]);
 const web=express();web.use(app);web.use(express.static(dist));web.get(/^(?!\/api).*/,(_req,res)=>res.sendFile(path.join(dist,'index.html')));
 server=await new Promise((resolve,reject)=>{const s=web.listen(5173,'127.0.0.1',()=>resolve(s));s.once('error',reject);});browser=await chromium.launch({headless:true});
});
after(async()=>{await browser?.close();if(server)await new Promise(resolve=>server.close(resolve));await pool.end();await fixtures.end();});
async function login(page,identity=email){await page.goto(`${origin}/login`);await page.getByLabel('Username / Email').fill(identity);await page.getByLabel('Password',{exact:true}).fill(password);await page.getByRole('button',{name:/sign in/i}).click();await page.waitForURL(`${origin}/dashboard`);}
async function session(t){
 const context=await browser.newContext({serviceWorkers:'block',extraHTTPHeaders:{'X-Forwarded-For':`127.0.0.${++sessionNo}`}});
 const control={requests:[],drop:false},attempts=[],inFlight=new Set(),errors=[];const evidence=await observe(t,context,{fixtures,control,secrets:[password]});
 await context.routeWebSocket('**/*',socket=>{attempts.push('WebSocket');socket.close();});
 await context.route('**/*',route=>{
  const action=(async()=>{const request=route.request(),url=new URL(request.url());
   if(url.protocol==='data:' || (url.protocol==='blob:' && url.origin===origin))return route.continue();
   if(url.origin!==origin){attempts.push(url.origin);return route.abort('blockedbyclient');}
   if(request.method()==='POST' && url.pathname.startsWith('/api/documents'))control.requests.push({path:url.pathname,key:request.headers()['idempotency-key'],actor:request.headers()['idempotency-actor'],payload:request.postDataJSON()});
   const response=await route.fetch({maxRedirects:0,maxRetries:0});
   if(control.hold && request.method()==='POST' && request.headers()['idempotency-key']===control.hold.key && response.status()===201){const held=control.hold;held.started=true;await held.gate;if(control.hold===held)control.hold=null;}
   if(response.headers().location && new URL(response.headers().location,url).origin!==origin){attempts.push('redirect');return route.abort('blockedbyclient');}
   if(control.drop && request.method()==='POST' && url.pathname==='/api/documents'){control.drop=false;assert.equal(response.status(),201);return route.abort('failed');}
   return route.fulfill({response});
  })();inFlight.add(action);return action.finally(()=>inFlight.delete(action));
 });
 t.after(async()=>{await evidence.finish(async()=>{control.hold?.release();while(inFlight.size)await Promise.all([...inFlight]);assert.deepEqual(attempts,[]);assert.deepEqual(errors,[]);});});
 const page=await context.newPage();page.setDefaultTimeout(12000);page.on('pageerror',error=>errors.push(error.message));await login(page);return {page,context,control};
}
async function post(context,url,data,identity=actor){const response=await context.request.post(`${origin}/api${url}`,{data,maxRedirects:0,headers:{Origin:origin,'Idempotency-Key':randomUUID(),'Idempotency-Actor':String(identity)}});assert.equal(response.status(),201,await response.text());return (await response.json()).data;}
async function get(context,url){const response=await context.request.get(`${origin}/api${url}`,{maxRedirects:0});assert.equal(response.status(),200,await response.text());return (await response.json()).data;}
async function seed(context){
 const product=(await fixtures.query("INSERT INTO products(name,category,unit,base_unit,mrp,wholesale_price,purchase_price,current_stock,gst_rate,hsn_code) VALUES($1,'Synthetic','piece','piece',100,100,7,100,0,'1234') RETURNING id",[`Synthetic दस्तावेज़ ₹ bolts ${randomUUID()}`])).rows[0].id;
 await fixtures.query("INSERT INTO stock_ledger(product_id,date,movement_type,reference_type,qty_in,qty_out,stock_after,notes,created_by) VALUES($1,'2026-01-01','in','opening',100,0,100,'Synthetic opening',$2)",[product,actor]);
 const customer=(await fixtures.query("INSERT INTO customers(name,phone,type) VALUES($1,$2,'retail') RETURNING id",[`Synthetic document buyer ${randomUUID()}`,String(randomInt(1000000000,9999999999))])).rows[0].id;
 const sale=await post(context,'/invoices',{customer_id:customer,bill_type:'retail',date:'2026-01-15',items:[{product_id:product,qty:'2.000',unit:'piece',rate:'100.00'}],payment:{amount_paid:'100.00',modes:[{mode:'cash',amount:'100.00'}],due_date:'2026-02-15'}});
 const payment=(await fixtures.query('SELECT id FROM payments WHERE invoice_id=$1',[sale.invoice_id])).rows[0].id;
 return {product,customer,sale,payment};
}
async function effect(f){return (await fixtures.query(`SELECT (SELECT COUNT(*)::int FROM invoices WHERE customer_id=$1) invoices,(SELECT COUNT(*)::int FROM payments WHERE customer_id=$1) payments,(SELECT COUNT(*)::int FROM customer_ledger WHERE customer_id=$1) ledger,(SELECT current_stock FROM products WHERE id=$2) stock`,[f.customer,f.product])).rows[0];}
async function worker(){
 const env={...process.env,DOCUMENT_DB_USER:process.env.TEST_DOCUMENT_WORKER_USER,DOCUMENT_DB_PASSWORD:process.env.TEST_DOCUMENT_WORKER_PASSWORD};delete env.NODE_TEST_CONTEXT;
 const result=await new Promise((resolve,reject)=>{let out='',err='';const child=spawn(process.execPath,['backend/document-worker.js','--once'],{cwd:root,env,stdio:['ignore','pipe','pipe']});child.stdout.on('data',chunk=>out+=chunk);child.stderr.on('data',chunk=>err+=chunk);child.once('error',reject);child.once('close',code=>resolve({code,out,err}));});
 for(const secret of [password,process.env.SESSION_SECRET,process.env.DB_PASSWORD,process.env.FIXTURE_DB_PASSWORD,process.env.TEST_DOCUMENT_WORKER_PASSWORD].filter(Boolean)){result.out=result.out.replaceAll(secret,'[REDACTED]');result.err=result.err.replaceAll(secret,'[REDACTED]');}
 assert.equal(result.code,0,result.out+result.err);
}
async function publish(context,id){
 for(let attempt=0;attempt<30;attempt++){const row=await get(context,`/documents/${id}`);if(row.status==='ready')return row;assert.notEqual(row.status,'permanent_failure',row.error_code);assert.notEqual(row.status,'retryable_failure',row.error_code);
  if(row.status==='pending' && row.attempts>0) await expect.poll(async()=>{
   const {rows:[eligibility]}=await fixtures.query('SELECT updated_at+make_interval(secs=>attempts*2)<=clock_timestamp() AS due FROM document_jobs WHERE id=$1',[id]);
   return eligibility.due;
  },{message:'Wait for the recorded database retry backoff before claiming',timeout:6000}).toBe(true);
  await worker();}
 assert.fail('The bounded worker drain did not publish the requested document');
}
async function dismiss(page){
 await page.getByRole('button',{name:'Dismiss document request',exact:true}).click();
 // Navigation must wait for the Web Lock callback to persist the user's dismissal.
 await expect.poll(()=>page.evaluate(actor=>localStorage.getItem(`hardware-erp-document-intent-v1:${actor}`),actor)).toBeNull();
 await expect(page.getByRole('button',{name:'Dismiss document request',exact:true})).toHaveCount(0);
}
async function request(page){await page.getByRole('button',{name:'Request document',exact:true}).click();await expect(page.getByText('Document request recorded',{exact:true})).toBeVisible();return page.evaluate(actor=>JSON.parse(localStorage.getItem(`hardware-erp-document-intent-v1:${actor}`)),actor);}
async function download(t,page,id){const [event]=await Promise.all([page.waitForEvent('download'),page.getByRole('row').filter({hasText:id}).getByRole('button',{name:'Download / reprint PDF',exact:true}).click()]);const file=await downloadFile(t,event,'sample.pdf');assert.equal((await readFile(file)).subarray(0,5).toString(),'%PDF-');}

test('Phase5B lost document response reloads and recovers one original request without another sale or payment',async t=>{
 const {page,context,control}=await session(t),f=await seed(context),before=await effect(f);
 await page.goto(`${origin}/invoices/${f.sale.invoice_id}`);await expect(page.getByText('Financial record posted',{exact:true})).toBeVisible();
 await page.evaluate(()=>localStorage.setItem('hardware-erp-intent-v1:sentinel:invoice',JSON.stringify({status:'uncertain',key:'synthetic-financial-draft'})));
 control.drop=true;await page.getByRole('button',{name:'Request document',exact:true}).click();await expect(page.getByText('Document request needs recovery',{exact:true})).toBeVisible();
 const first=control.requests[0];assert.ok(first.key);await page.reload();await page.getByRole('button',{name:'Recover document request',exact:true}).click();await expect(page.getByText('Document request recorded',{exact:true})).toBeVisible();
 assert.equal(control.requests.length,2);assert.equal(control.requests[1].key,first.key);assert.deepEqual(control.requests[1].payload,first.payload);assert.equal(control.requests[1].actor,String(actor));
 assert.deepEqual(await effect(f),before);assert.equal((await fixtures.query('SELECT COUNT(*)::int n FROM document_requests WHERE actor_id=$1 AND key=$2',[actor,first.key])).rows[0].n,1);
 assert.equal(await page.evaluate(()=>localStorage.getItem('hardware-erp-intent-v1:sentinel:invoice')),JSON.stringify({status:'uncertain',key:'synthetic-financial-draft'}));
 await expect(page.getByText('Document pending',{exact:true})).toBeVisible();
});

test('Phase5B actual sale, credit note, receipt and as-of statement downloads retain financial effects',async t=>{
 const {page,context}=await session(t),f=await seed(context);
 const item=(await fixtures.query('SELECT id FROM invoice_items WHERE invoice_id=$1',[f.sale.invoice_id])).rows[0].id;
 const credit=await post(context,`/invoices/${f.sale.invoice_id}/return`,{return_date:'2026-01-16',reason:'Synthetic return for document',disposition:'sellable',items:[{invoice_item_id:item,qty_returned:'1.000'}]});
 const before=await effect(f);
 for(const [url,sourceType] of [[`/invoices/${f.sale.invoice_id}`,'invoice'],[`/invoices/${credit.credit_note_id}`,'invoice'],[`/payments?receipt=${f.payment}`,'payment'],[`/customers/${f.customer}`,'customer_statement']]){
  await page.goto(origin+url);if(sourceType==='customer_statement')await page.getByLabel('Statement document as of',{exact:true}).fill('2026-02-01');
  const intent=await request(page);await publish(context,intent.result.id);await page.getByRole('button',{name:'Refresh document status',exact:true}).click();await expect(page.getByText('Document ready',{exact:true})).toBeVisible();await download(t,page,intent.result.id);await dismiss(page);
 }
 assert.deepEqual(await effect(f),before);
});

test('Phase5B account change and wrong-target recovery retain the original source and key',async t=>{
 const {page,context,control}=await session(t),f=await seed(context),other=await seed(context);
 await page.goto(`${origin}/invoices/${f.sale.invoice_id}`);control.drop=true;await page.getByRole('button',{name:'Request document',exact:true}).click();await expect(page.getByText('Document request needs recovery',{exact:true})).toBeVisible();
 const original=control.requests[0];await page.goto(`${origin}/invoices/${other.sale.invoice_id}`);await expect(page.getByRole('link',{name:'Open original document source'})).toHaveAttribute('href',`/invoices/${f.sale.invoice_id}`);
 await page.getByRole('link',{name:'Open original document source'}).click();
 const switched=await context.request.post(`${origin}/api/auth/login`,{data:{email:otherEmail,password},maxRedirects:0,headers:{Origin:origin}});assert.equal(switched.status(),200);
 await page.getByRole('button',{name:'Recover document request',exact:true}).click();await expect(page.getByText('The signed-in account changed. Sign in as the original account and recover this document request.',{exact:true})).toBeVisible();
 assert.equal(control.requests.at(-1).key,original.key);assert.equal(control.requests.at(-1).actor,String(actor));
 const restored=await context.request.post(`${origin}/api/auth/login`,{data:{email,password},maxRedirects:0,headers:{Origin:origin}});assert.equal(restored.status(),200);await page.goto(`${origin}/invoices/${f.sale.invoice_id}`);await page.getByRole('button',{name:'Recover document request',exact:true}).click();await expect(page.getByText('Document request recorded',{exact:true})).toBeVisible();
 assert.equal((await fixtures.query('SELECT COUNT(*)::int n FROM document_requests WHERE key=$1',[original.key])).rows[0].n,1);assert.notEqual(actor,otherActor);
});

test('Phase5B a missing private file shows a recoverable delivery failure without changing the financial record',async t=>{
 const {page,context}=await session(t),f=await seed(context);await page.goto(`${origin}/invoices/${f.sale.invoice_id}`);const intent=await request(page);await publish(context,intent.result.id);
 await dismiss(page);await page.getByRole('button',{name:'Refresh document status',exact:true}).click();await expect(page.getByText('Document ready',{exact:true})).toBeVisible();const before=await effect(f);
 const moved=artifacts+'-missing';await rename(artifacts,moved);
 try{await page.getByRole('button',{name:'Download / reprint PDF',exact:true}).click();await expect(page.getByText('The published file is missing. Retry document delivery after storage recovery; do not repeat the financial transaction.',{exact:true})).toBeVisible();}
 finally{await rename(moved,artifacts);}
 await page.getByRole('button',{name:'Refresh document status',exact:true}).click();await page.getByRole('button',{name:'Retry document delivery',exact:true}).click();await expect(page.getByText('Document request recorded',{exact:true})).toBeVisible();await publish(context,intent.result.id);
 await page.getByRole('button',{name:'Refresh document status',exact:true}).click();await download(t,page,intent.result.id);assert.deepEqual(await effect(f),before);
 const denied=await context.request.post(`${origin}/api/auth/login`,{data:{email:cashierEmail,password},maxRedirects:0,headers:{Origin:origin}});assert.equal(denied.status(),200);
 const downloads=[];page.on('download',event=>downloads.push(event));await page.getByRole('row').filter({hasText:intent.result.id}).getByRole('button',{name:'Download / reprint PDF',exact:true}).click();await expect(page.getByText('This account cannot access this document.',{exact:true})).toBeVisible();assert.equal(downloads.length,0);assert.deepEqual(await effect(f),before);
});

test('Phase5B session expiry preserves document recovery and requires explicit original-key retry',async t=>{
 const {page,context,control}=await session(t),f=await seed(context);await page.goto(`${origin}/invoices/${f.sale.invoice_id}`);
 await expect(page.getByRole('button',{name:'Request document',exact:true})).toBeVisible();
 await fixtures.query("UPDATE auth_sessions SET created_at=NOW()-INTERVAL '9 hours',expires_at=NOW()-INTERVAL '1 minute' WHERE user_id=$1",[actor]);
 await page.getByRole('button',{name:'Request document',exact:true}).click();await page.waitForURL(`${origin}/login`);assert.equal(control.requests.length,1);const original=control.requests[0];
 await login(page);await page.goto(`${origin}/invoices/${f.sale.invoice_id}`);await expect(page.getByText('Document request needs recovery',{exact:true})).toBeVisible();assert.equal(control.requests.length,1);
 await page.getByRole('button',{name:'Recover document request',exact:true}).click();await expect(page.getByText('Document request recorded',{exact:true})).toBeVisible();assert.equal(control.requests[1].key,original.key);
});


test('Phase5B thermal sale and receipt select the requested layout without new financial effects',async t=>{
 const {page,context}=await session(t),f=await seed(context),before=await effect(f);
 for(const url of [`/invoices/${f.sale.invoice_id}`,`/payments?receipt=${f.payment}`]){
  await page.goto(origin+url);await page.getByRole('combobox',{name:'Document layout',exact:true}).press('ArrowDown');await page.getByText('Thermal 80 mm',{exact:true}).click();
  const intent=await request(page);assert.equal(intent.payload.layout,'thermal80');assert.equal(intent.result.layout,'thermal80');await publish(context,intent.result.id);
  await page.getByRole('button',{name:'Refresh document status',exact:true}).click();await expect(page.getByRole('row').filter({hasText:intent.result.id}).getByText('Document ready',{exact:true})).toBeVisible();await download(t,page,intent.result.id);await dismiss(page);
 }
 assert.deepEqual(await effect(f),before);
});

test('Phase5B simultaneous tabs recover one document dispatch and one durable result',async t=>{
 const {page,context,control}=await session(t),f=await seed(context),before=await effect(f);await page.goto(`${origin}/invoices/${f.sale.invoice_id}`);control.drop=true;
 await page.getByRole('button',{name:'Request document',exact:true}).click();await expect(page.getByText('Document request needs recovery',{exact:true})).toBeVisible();const original=control.requests[0];
 const second=await context.newPage();await second.goto(`${origin}/invoices/${f.sale.invoice_id}`);await expect(second.getByRole('button',{name:'Recover document request',exact:true})).toBeVisible();
 let release;const gate=new Promise(resolve=>{release=resolve;});control.hold={key:original.key,gate,release,started:false};
 await Promise.all([page.getByRole('button',{name:'Recover document request',exact:true}).click(),second.getByRole('button',{name:'Recover document request',exact:true}).click()]);
 await expect.poll(()=>control.hold.started).toBe(true);await expect(page.getByRole('button',{name:'Recover document request',exact:true})).toHaveAttribute('aria-busy','true');await expect(second.getByRole('button',{name:'Recover document request',exact:true})).toHaveAttribute('aria-busy','true');release();
 await expect(page.getByText('Document request recorded',{exact:true})).toBeVisible();await expect(second.getByText('Document request recorded',{exact:true})).toBeVisible();
 assert.equal(control.requests.length,2);assert.equal(control.requests[1].key,original.key);assert.deepEqual(await effect(f),before);assert.equal((await fixtures.query('SELECT COUNT(*)::int n FROM document_requests WHERE actor_id=$1 AND key=$2',[actor,original.key])).rows[0].n,1);
});
