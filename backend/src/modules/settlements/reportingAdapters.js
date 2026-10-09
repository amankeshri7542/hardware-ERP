const { decimal, format, date, fail } = require('../../utils/financial');
const reporting = require('./reporting');
const money = v => { const s = String(v); return s.startsWith('-') ? -decimal(s.slice(1),2) : decimal(s,2); };
function range(query) {
  const to = query.to || reporting.today();
  const from = query.from || new Date(Date.parse(to) - 30*86400000).toISOString().slice(0,10);
  return reporting.normalize({ ...query, from, to });
}
function pageRows(rows, options, allRows) { return allRows ? rows : rows.slice((options.page-1)*options.limit,options.page*options.limit); }
function pagination(total, options) { return { total, page: options.page, limit: options.limit, totalPages: Math.ceil(total/options.limit) }; }
async function collections(query = {}, allRows = false) {
  const options = range(query);
  if (query.mode && !['cash','upi','bank','cheque'].includes(query.mode)) fail('INVALID_PAYMENT_MODE');
  return reporting.readTransaction(async client => {
    const rows = (await reporting.cashDataset(client, options)).filter(r => r.supplier_id === null && (!query.mode || r.mode === query.mode));
    rows.sort((a,b) => b.date.localeCompare(a.date) || new Date(b.created_at)-new Date(a.created_at) || b.source_id-a.source_id || b.tender_id-a.tender_id);
    const cash = reporting.cashSummary(rows);
    return { payments: pageRows(rows,options,allRows), summary: { ...cash, total_collected: cash.incoming, total_refunded: cash.outgoing, net_collected: cash.net,
      total_payments: new Set(rows.map(r => `${r.source_type}:${r.source_id}`)).size, total_tender_portions: rows.length,
      ...Object.fromEntries(Object.entries(cash.by_mode).map(([k,v]) => [`${k}_total`,v.net])) }, pagination: pagination(rows.length,options),
      reconciliation_required: rows.some(r => !r.party_snapshot), collection_basis: 'Dated customer money movements, one row per concrete tender portion' };
  });
}
async function dues(query = {}, allRows = false) {
  const asOf = date(query.as_of || reporting.today());
  const options = reporting.normalize({ as_of: asOf, page: query.page, limit: query.limit });
  return reporting.readTransaction(async client => {
    const customers = (await client.query('SELECT id,name,business_name,phone,type,credit_limit FROM customers WHERE is_active=true AND ($1::text IS NULL OR type=$1) ORDER BY id', [query.customerType || null])).rows;
    const rows = [];
    for (const customer of customers) {
      const state = await require('./customer').accountData(client,customer.id,{ as_of: asOf });
      const age = reporting.aging(state.invoices,state.sources,asOf);
      if (query.overdueOnly && money(age.overdue) === 0n) continue;
      const outstanding = state.invoices.filter(i => i.balance_due !== null && money(i.balance_due) > 0n);
      rows.push({ ...customer, as_of: asOf, outstanding_balance: age.total_due, available_credit: age.available_credit, overdue_amount: age.overdue,
        aging: age, unpaid_invoice_count: outstanding.length, last_invoice_date: outstanding.map(i => i.date).sort().at(-1) || null,
        oldest_unpaid_date: outstanding.map(i => i.date).sort()[0] || null, reconciliation_required: age.reconciliation_required || state.invoices.some(i => !i.party_snapshot) });
    }
    rows.sort((a,b) => money(b.outstanding_balance) > money(a.outstanding_balance) ? 1 : money(b.outstanding_balance) < money(a.outstanding_balance) ? -1 : a.id-b.id);
    const sum = key => format(rows.reduce((a,r) => a + money(r[key]),0n));
    return { customers: pageRows(rows,options,allRows), as_of: asOf, summary: { count: rows.length, total_due: sum('outstanding_balance'), available_credit: sum('available_credit'), overdue: sum('overdue_amount') },
      pagination: pagination(rows.length,options), reconciliation_required: rows.some(r => r.reconciliation_required) };
  });
}
async function sales(query = {}, allRows = false) {
  const options = range(query);
  return reporting.readTransaction(async client => {
    const { rows } = await client.query(`WITH projection AS (
      SELECT i.*,
        COALESCE(i.customer_snapshot->>'name','Unknown issued party') AS customer_name,i.customer_snapshot->>'phone' AS customer_phone,
        (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id AND p.payment_date<=$2)
          - (SELECT COALESCE(SUM(e.amount),0) FROM settlement_events e JOIN payments p ON p.id=e.source_id WHERE e.kind='payment_reversal' AND e.source_type='payment' AND p.invoice_id=i.id AND e.date<=$2) AS paid_asof,
        (SELECT COALESCE(SUM(a.applied_amount),0) FROM sales_return_applications a WHERE a.original_invoice_id=i.id AND a.date<=$2)
          + (SELECT COALESCE(SUM(CASE WHEN e.kind='reversal' THEN -l.amount ELSE l.amount END),0) FROM settlement_lines l JOIN settlement_events e ON e.id=l.event_id WHERE l.target_type='invoice' AND l.target_id=i.id AND e.date<=$2) AS applied_asof
      FROM invoices i WHERE i.date >= $1 AND i.date <= $2 AND ($3::text IS NULL OR i.bill_type=$3) AND ($4::integer IS NULL OR i.customer_id=$4))
      SELECT *,date::text AS date,due_date::text AS due_date,paid_asof::numeric(12,2)::text AS amount_paid,
        (CASE WHEN document_kind='sales_return' THEN 0 ELSE grand_total-paid_asof-applied_asof END)::numeric(12,2)::text AS balance_due,
        applied_asof::numeric(12,2)::text AS applied_credit FROM projection ORDER BY projection.date DESC,id DESC`, [options.from,options.to,query.billType || null,query.customerId || null]);
    for (const row of rows) {
      try {
        await require('../../utils/invoiceReconciliation').requireReconciledInvoice(client,row.original_invoice_id || row.id);
        row.eligible = true;
        row.status = row.document_kind === 'sales_return' || row.balance_due === '0.00' ? 'paid' : money(row.balance_due) < money(row.grand_total) ? 'partial' : 'unpaid';
      } catch (error) {
        if (!error.errorCode) throw error;
        row.eligible = false; row.reconciliation_code = error.errorCode; row.balance_due = null; row.status = 'reconciliation_required';
      }
    }
    const sum = (key, predicate = () => true) => format(rows.filter(predicate).reduce((a,r) => a + (r[key] === null ? 0n : money(r[key])),0n));
    const ids = rows.map(r => r.id);
    const { rows: [receipts] } = await client.query(`SELECT COALESCE(SUM(amount),0)::text AS collected FROM payments WHERE invoice_id=ANY($1::integer[]) AND payment_date BETWEEN $2 AND $3`, [ids,options.from,options.to]);
    const { rows: [reversals] } = await client.query(`SELECT COALESCE(SUM(e.amount),0)::text AS reversed FROM settlement_events e JOIN payments p ON e.source_type='payment' AND p.id=e.source_id WHERE e.kind='payment_reversal' AND p.invoice_id=ANY($1::integer[]) AND e.date BETWEEN $2 AND $3`, [ids,options.from,options.to]);
    const taxable = money(sum('taxable_total')), profit = money(sum('profit_amount'));
    const summary = { total_invoices: rows.length, total_sales: sum('grand_total'), gross_sales: sum('grand_total',r => r.document_kind !== 'sales_return'),
      returns: format(-money(sum('grand_total',r => r.document_kind === 'sales_return'))), net_sales: sum('grand_total'), total_gst: sum('gst_total'), total_profit: format(profit),
      total_collected: format(money(receipts.collected)), total_receipt_reversals: format(money(reversals.reversed)), net_collected: format(money(receipts.collected)-money(reversals.reversed)),
      total_paid: sum('amount_paid'), total_outstanding: sum('balance_due'), avg_profit_pct: taxable === 0n ? '0.00' : format(profit*10000n/taxable) };
    return { invoices: pageRows(rows,options,allRows), summary, ...pagination(rows.length,options), as_of: options.to,
      collection_basis: 'Receipts dated within this range for the displayed invoice cohort; paid totals are net direct receipts as of the end date',
      reconciliation_required: rows.some(r => !r.customer_snapshot || !r.eligible) };
  });
}
module.exports = { sales, collections, dues };
