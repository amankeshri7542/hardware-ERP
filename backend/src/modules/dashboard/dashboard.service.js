const { pool } = require('../../config/db');
const { decimal, format, date } = require('../../utils/financial');
const reporting = require('../settlements/reporting');
const money = value => decimal(value,2);
const number = value => Number(value);
function pageOptions({page=1,limit=20}={}) { return { page:Math.max(1,parseInt(page,10)||1),limit:Math.min(100,Math.max(1,parseInt(limit,10)||20)) }; }
function paginate(rows,options) { return {rows:rows.slice((options.page-1)*options.limit,options.page*options.limit),pagination:{...options,total:rows.length,totalPages:Math.ceil(rows.length/options.limit)}}; }
function range({from,to}={},month=false) {
  const end=date(to||reporting.today());
  return reporting.normalize({from:from||(month?end.slice(0,7)+'-01':new Date(Date.parse(end)-30*86400000).toISOString().slice(0,10)),to:end});
}
async function customerAccounts(client,asOf) {
  const {rows:customers}=await client.query(`SELECT c.id FROM customers c WHERE
    EXISTS(SELECT 1 FROM invoices i WHERE i.customer_id=c.id AND i.date<=$1) OR
    EXISTS(SELECT 1 FROM payments p WHERE p.customer_id=c.id AND p.payment_date<=$1) ORDER BY c.id`,[asOf]);
  const accounts=[];
  for(const customer of customers) accounts.push(await require('../settlements/customer').accountData(client,customer.id,{as_of:asOf}));
  return accounts;
}
function customerFacts(accounts,asOf) {
  let due=0n,credits=0n,unknown=false;
  for(const account of accounts) {
    const age=reporting.aging(account.invoices,account.sources,asOf);
    due+=money(age.total_due);credits+=money(age.available_credit);
    unknown ||= age.reconciliation_required || account.invoices.some(i=>!i.party_snapshot);
  }
  return {total_outstanding:number(format(due)),customer_available_credit:number(format(credits)),reconciliation_required:unknown};
}
async function customerMoney(client,dates) { return (await reporting.cashDataset(client,dates)).filter(row=>row.supplier_id===null); }

async function unverifiedInvoiceDates(client,from,to) {
  const {rows}=await client.query('SELECT id,original_invoice_id,date::text AS date,customer_snapshot FROM invoices WHERE date BETWEEN $1 AND $2',[from,to]);
  const sources=new Map(),unknown=new Set();
  for(const row of rows) {
    const id=row.original_invoice_id||row.id;
    if(!sources.has(id)) {
      try {await require('../../utils/invoiceReconciliation').requireReconciledInvoice(client,id);sources.set(id,true);}
      catch(error){if(!error.errorCode)throw error;sources.set(id,false);}
    }
    if(!sources.get(id)||!row.customer_snapshot)unknown.add(row.date);
  }
  return unknown;
}

// Keep receivables, refundable customer sources and supplier claims separate.
async function getDashboardSummary() {
  const asOf=reporting.today();
  return reporting.readTransaction(async client=>{
    const accounts=await customerAccounts(client,asOf);
    const facts=customerFacts(accounts,asOf);
    const unknownSales=await unverifiedInvoiceDates(client,asOf,asOf);
    const cashRows=await customerMoney(client,{from:asOf,to:asOf});const cash=reporting.cashSummary(cashRows);
    const {rows:[counts]}=await client.query(`SELECT
      (SELECT COUNT(*)::int FROM customers WHERE is_active=true) AS total_customers,
      (SELECT COUNT(*)::int FROM products WHERE is_active=true) AS total_products,
      (SELECT COUNT(*)::int FROM products WHERE is_active=true AND current_stock<=min_stock AND current_stock>0) AS low_stock_count,
      (SELECT COUNT(*)::int FROM products WHERE is_active=true AND current_stock=0) AS out_of_stock_count`);
    const {rows:[sales]}=await client.query(`SELECT COALESCE(SUM(grand_total),0)::text AS net,
      COALESCE(SUM(grand_total) FILTER(WHERE document_kind IS DISTINCT FROM 'sales_return'),0)::text AS gross,
      COALESCE(-SUM(grand_total) FILTER(WHERE document_kind='sales_return'),0)::text AS returns,
      COALESCE(BOOL_OR(customer_snapshot IS NULL),false) AS unknown FROM invoices WHERE date=$1`,[asOf]);
    const {rows:suppliers}=await client.query(`SELECT DISTINCT supplier_id FROM supplier_debit_notes
      UNION SELECT supplier_id FROM supplier_payables ORDER BY supplier_id`);
    let claim=0n,payable=0n,claimCount=0,unknown=facts.reconciliation_required||unknownSales.size>0||sales.unknown||cashRows.some(r=>!r.party_snapshot);
    for(const supplier of suppliers) {
      const account=await require('../settlements/supplier').accountData(client,supplier.supplier_id,{as_of:asOf});
      unknown ||= account.reconciliation_required;
      for(const source of account.debits) if(source.eligible) {claim+=money(source.available);if(money(source.available)>0n)claimCount++;}
      for(const source of account.payables) if(source.eligible) payable+=money(source.due);
    }
    return {...counts,...facts,as_of:asOf,timezone:'Asia/Kolkata',today_sales:number(sales.net),today_gross_sales:number(sales.gross),today_sales_returns:number(sales.returns),
      today_collections:number(cash.incoming),today_refunds:number(cash.outgoing),today_net_collections:number(cash.net),
      outstanding_debit_notes_total:number(format(claim)),outstanding_debit_notes_count:claimCount,total_supplier_payables:number(format(payable)),reconciliation_required:unknown};
  });
}
async function getSalesOverview(query={}) {
  const dates=range(query);
  return reporting.readTransaction(async client=>{
    const {rows}=await client.query(`SELECT d.day::date::text AS date,COALESCE(SUM(i.grand_total),0)::text AS total_sales,COUNT(i.id)::int AS invoice_count,
      COALESCE(BOOL_OR(i.id IS NOT NULL AND i.customer_snapshot IS NULL),false) AS reconciliation_required
      FROM generate_series($1::date,$2::date,'1 day') d(day) LEFT JOIN invoices i ON i.date=d.day::date GROUP BY d.day ORDER BY d.day`,[dates.from,dates.to]);
    const moneyRows=await customerMoney(client,dates);const unknownSales=await unverifiedInvoiceDates(client,dates.from,dates.to);
    return rows.map(row=>{const cash=reporting.cashSummary(moneyRows.filter(m=>m.date===row.date));return {...row,reconciliation_required:row.reconciliation_required||unknownSales.has(row.date)||moneyRows.some(m=>m.date===row.date&&!m.party_snapshot),total_sales:number(row.total_sales),
      total_collections:number(cash.incoming),total_refunds:number(cash.outgoing),net_collections:number(cash.net)};});
  });
}
async function overdueData(client,asOf) {
  const accounts=await customerAccounts(client,asOf);const invoices=[];
  for(const account of accounts) for(const invoice of account.invoices) {
    if(invoice.eligible===false||invoice.balance_due===null||money(invoice.balance_due)===0n||!invoice.due_date||invoice.due_date>=asOf)continue;
    invoices.push({...invoice,customer_id:account.customer.id,customer_name:invoice.party_snapshot?.name||'Unknown issued party',customer_phone:invoice.party_snapshot?.phone||null,
      grand_total:number(invoice.grand_total),balance_due:number(invoice.balance_due),days_overdue:Math.floor((Date.parse(asOf)-Date.parse(invoice.due_date))/86400000)});
  }
  invoices.sort((a,b)=>b.days_overdue-a.days_overdue||a.id-b.id);
  return {accounts,invoices,reconciliation_required:customerFacts(accounts,asOf).reconciliation_required};
}
async function getOverdueInvoices(query={}) {
  const options=pageOptions(query),asOf=reporting.today();
  return reporting.readTransaction(async client=>{
    const data=await overdueData(client,asOf);const days=query.days_overdue?Math.max(0,parseInt(query.days_overdue,10)||0):0;
    const result=paginate(data.invoices.filter(i=>i.days_overdue>=days),options);
    return {invoices:result.rows,pagination:result.pagination,as_of:asOf,reconciliation_required:data.reconciliation_required};
  });
}
async function getOverdueCustomers(query={}) {
  const options=pageOptions(query),asOf=reporting.today();
  return reporting.readTransaction(async client=>{
    const data=await overdueData(client,asOf);const rows=[];
    for(const account of data.accounts) {
      const invoices=data.invoices.filter(i=>i.customer_id===account.customer.id);if(!invoices.length)continue;
      const age=reporting.aging(account.invoices,account.sources,asOf);
      rows.push({...account.customer,outstanding_balance:number(age.total_due),available_credit:number(age.available_credit),oldest_overdue_date:invoices.map(i=>i.due_date).sort()[0],
        total_overdue_amount:number(age.overdue),overdue_invoice_count:invoices.length});
    }
    rows.sort((a,b)=>b.outstanding_balance-a.outstanding_balance||a.id-b.id);const result=paginate(rows,options);
    return {customers:result.rows,pagination:result.pagination,as_of:asOf,reconciliation_required:data.reconciliation_required};
  });
}
// This feed deliberately describes issued invoices and original receipts, not net cash.
async function getRecentActivity({limit=10}={}) {
  const parsedLimit=Math.min(50,Math.max(1,parseInt(limit,10)||10));
  const {rows}=await pool.query(`SELECT * FROM (
    SELECT 'invoice' AS activity_type,id,invoice_no AS reference,grand_total AS amount,date,COALESCE(customer_snapshot->>'name','Unknown issued party') AS customer_name,created_at FROM invoices
    UNION ALL SELECT 'payment',id,reference_no,amount,payment_date,COALESCE(customer_snapshot->>'name','Unknown issued party'),created_at FROM payments
    ) activity ORDER BY date DESC,created_at DESC LIMIT $1`,[parsedLimit]);
  return rows.map(r=>({...r,amount:number(r.amount)}));
}
async function getPaymentModeBreakdown(query={}) {
  const dates=range(query,true);
  return reporting.readTransaction(async client=>{
    const rows=await customerMoney(client,dates);const totals=reporting.cashSummary(rows);
    return Object.entries(totals.by_mode).filter(([mode])=>rows.some(r=>r.mode===mode)).map(([mode,values])=>({mode,total:number(values.incoming),count:rows.filter(r=>r.mode===mode&&r.direction==='in').length,
      incoming:number(values.incoming),outgoing:number(values.outgoing),net:number(values.net),tender_portions:rows.filter(r=>r.mode===mode).length,
      from:dates.from,to:dates.to,reconciliation_required:rows.some(r=>r.mode===mode&&!r.party_snapshot)})).sort((a,b)=>b.total-a.total||a.mode.localeCompare(b.mode));
  });
}
module.exports={getDashboardSummary,getSalesOverview,getOverdueInvoices,getOverdueCustomers,getRecentActivity,getPaymentModeBreakdown};
