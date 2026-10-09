const { pool } = require('../../config/db');
const { decimal, format, positiveId, date, fail } = require('../../utils/financial');
const { getCashMovements } = require('./cashMovements');
const money = value => decimal(value, 2);
function signed(value) { const s = String(value); return s.startsWith('-') ? -money(s.slice(1)) : money(s); }
function today() { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date()); }
function normalize(query = {}) {
  const asOf = date(query.as_of || query.to || today());
  const to = date(query.to || asOf), from = query.from ? date(query.from) : null;
  if ((from && from > to) || to > asOf) fail('INVALID_REPORT_RANGE');
  const page = query.page === undefined ? 1 : positiveId(query.page), limit = query.limit === undefined ? 50 : positiveId(query.limit);
  if (limit > 100) fail('INVALID_REPORT_LIMIT');
  if (query.kind !== undefined && (typeof query.kind !== 'string' || query.kind.length > 100)) fail('INVALID_REPORT_KIND');
  return { from, to, as_of: asOf, kind: query.kind || null, page, limit };
}
async function readTransaction(action) {
  const client = await pool.connect();
  try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const result = await action(client); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
function aging(documents, sources, asOf) {
  const buckets = { current: 0n, days_1_30: 0n, days_31_60: 0n, days_61_90: 0n, over_90: 0n, unknown_due_date: 0n, total_due: 0n, overdue: 0n, available_credit: 0n };
  let unknown = 0;
  for (const row of documents) {
    const value = row.due ?? row.balance_due;
    if (row.eligible === false || value === null || value === undefined || signed(value) < 0n) { unknown++; continue; }
    const due = money(value); buckets.total_due += due;
    if (due === 0n) continue;
    if (!row.due_date) { buckets.unknown_due_date += due; unknown++; continue; }
    const days = Math.floor((Date.parse(asOf) - Date.parse(row.due_date)) / 86400000);
    const key = days <= 0 ? 'current' : days <= 30 ? 'days_1_30' : days <= 60 ? 'days_31_60' : days <= 90 ? 'days_61_90' : 'over_90';
    buckets[key] += due; if (days > 0) buckets.overdue += due;
  }
  for (const source of sources) {
    const value = source.available ?? source.available_amount;
    if (source.eligible === false || value === null || value === undefined) { unknown++; continue; }
    buckets.available_credit += money(value);
  }
  return { ...Object.fromEntries(Object.entries(buckets).map(([k,v]) => [k,format(v)])), unknown_count: unknown, reconciliation_required: unknown > 0 };
}
function statementResult(party, rows, options, age, reconciliation, allRows = false) {
  rows.sort((a,b) => a.date.localeCompare(b.date) || new Date(a.created_at).getTime() - new Date(b.created_at).getTime() || a.order - b.order || a.id - b.id);
  let balance = 0n, opening = 0n, closing = 0n;
  for (const row of rows) {
    balance += money(row.debit) - money(row.credit); row.running_balance = format(balance);
    if (options.from && row.date < options.from) opening = balance;
    if (row.date <= options.to) closing = balance;
    row.party_name = row.party_snapshot?.name || 'Unknown issued party';
    row.snapshot_unknown = !row.party_snapshot;
    delete row.order;
  }
  const filtered = rows.filter(r => (!options.from || r.date >= options.from) && r.date <= options.to && (!options.kind || r.kind === options.kind));
  const total = filtered.length;
  const sum = key => format(filtered.reduce((a,r) => a + money(r[key]), 0n));
  return { party, ...options, opening_balance: format(opening), closing_balance: format(closing),
    rows: allRows ? filtered : filtered.slice((options.page - 1) * options.limit, options.page * options.limit),
    summary: { count: total, debit: sum('debit'), credit: sum('credit'), net: format(signed(sum('debit')) - signed(sum('credit'))) },
    pagination: { total, page: options.page, limit: options.limit, totalPages: Math.ceil(total/options.limit) }, aging: age,
    reconciliation_required: reconciliation || age.reconciliation_required || rows.some(r => r.snapshot_unknown || r.reconciliation_code) };
}
async function supplierDataset(client, id, options, allRows = false) {
  const state = await require('./supplier').accountData(client, id, { as_of: options.as_of });
  const rows = state.payables.map(p => ({ id: p.id, kind: 'payable_recognition', source_type: 'payable', source_id: p.id, date: p.date, created_at: p.created_at, order: 0,
    debit: p.amount, credit: '0.00', party_snapshot: p.party_snapshot, description: p.document_reference, reconciliation_code: p.reconciliation_code }));
  for (const d of state.debits) rows.push({ id: d.id, kind: 'supplier_debit', source_type: 'debit', source_id: d.id, date: d.date, created_at: d.created_at, order: 1,
    debit: '0.00', credit: d.amount, party_snapshot: d.party_snapshot, description: d.debit_note_no || d.reason, reconciliation_code: d.reconciliation_code });
  for (const event of state.events) {
    const original = event.kind === 'reversal' ? state.events.find(e => e.id === event.reverses_event_id) : event;
    let delta = ['supplier_payment','payable_reversal'].includes(original?.kind) ? -money(event.amount) : original?.kind === 'supplier_refund' ? money(event.amount) : 0n;
    if (event.kind === 'reversal') delta = -delta;
    rows.push({ ...event, order: 2, debit: format(delta > 0n ? delta : 0n), credit: format(delta < 0n ? -delta : 0n), description: event.reason });
  }
  return statementResult({ ...state.supplier, party_type: 'supplier' }, rows, options, aging(state.payables,state.debits,options.as_of), state.reconciliation_required, allRows);
}
async function customerDataset(client, id, options, allRows = false) {
  const state = await require('./customer').accountData(client, id, { as_of: options.as_of });
  const { rows } = await client.query(`SELECT l.id,l.date::text AS date,l.created_at,l.debit,l.credit,l.description,l.reference_type AS source_type,l.reference_id AS source_id,
    CASE WHEN l.reference_type='settlement' THEN e.kind WHEN l.reference_type='invoice' THEN CASE WHEN i.document_kind='sales_return' THEN 'sales_return' ELSE 'invoice' END ELSE l.entry_type END AS kind,
    CASE WHEN l.reference_type='invoice' THEN i.customer_snapshot WHEN l.reference_type='payment' THEN p.customer_snapshot WHEN l.reference_type='settlement' THEN e.party_snapshot ELSE NULL END AS party_snapshot
    FROM customer_ledger l LEFT JOIN invoices i ON l.reference_type='invoice' AND i.id=l.reference_id
    LEFT JOIN payments p ON l.reference_type='payment' AND p.id=l.reference_id
    LEFT JOIN settlement_events e ON l.reference_type='settlement' AND e.id=l.reference_id
    WHERE l.customer_id=$1 AND l.date<=$2`, [id,options.as_of]);
  rows.forEach(r => { r.order = 0; });
  for (const event of state.events) {
    const original = event.kind === 'reversal' ? state.events.find(e => e.id === event.reverses_event_id) : event;
    if (original?.kind === 'customer_allocation') rows.push({ ...event, source_type: 'event', source_id: event.id, debit: '0.00', credit: '0.00', description: event.reason, order: 1 });
  }
  return statementResult({ ...state.customer, party_type: 'customer' }, rows, options, aging(state.invoices,state.sources,options.as_of), state.sources.some(s => !s.eligible), allRows);
}
async function supplierStatement(id, query = {}) { const options = normalize(query); return readTransaction(client => supplierDataset(client,positiveId(id),options)); }
async function customerStatement(id, query = {}) { const options = normalize(query); return readTransaction(client => customerDataset(client,positiveId(id),options)); }
async function cashDataset(client, range = {}) {
  const movements = await getCashMovements(client, range);
  const payments = (await client.query('SELECT p.id,p.customer_snapshot AS party_snapshot,p.notes,i.invoice_no FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.id=ANY($1::integer[])', [movements.filter(m => m.source_type === 'payment').map(m => m.source_id)])).rows;
  const events = (await client.query('SELECT id,party_snapshot,reason AS notes FROM settlement_events WHERE id=ANY($1::integer[])', [movements.filter(m => m.source_type === 'settlement').map(m => m.source_id)])).rows;
  return movements.map(m => {
    const source = (m.source_type === 'payment' ? payments : events).find(r => r.id === m.source_id);
    return { ...m, id: `${m.source_type}-${m.source_id}-${m.tender_id}`, payment_date: m.date, party_snapshot: source?.party_snapshot || null,
      customer_name: source?.party_snapshot?.name || 'Unknown issued party', customer_phone: source?.party_snapshot?.phone || null,
      invoice_no: source?.invoice_no || null, notes: source?.notes || null };
  });
}
function cashSummary(rows) {
  const totals = { incoming: 0n, outgoing: 0n, customer_collections: 0n, customer_refunds: 0n, supplier_payments: 0n, supplier_refunds: 0n };
  const modes = Object.fromEntries(['cash','upi','bank','cheque'].map(mode => [mode,{ incoming: 0n, outgoing: 0n }]));
  for (const row of rows) {
    const amount = money(row.amount), dir = row.direction === 'in' ? 'incoming' : 'outgoing';
    totals[dir] += amount; modes[row.mode][dir] += amount;
    const partyKey = row.supplier_id !== null ? (row.direction === 'in' ? 'supplier_refunds' : 'supplier_payments') : (row.direction === 'in' ? 'customer_collections' : 'customer_refunds');
    totals[partyKey] += amount;
  }
  return { ...Object.fromEntries(Object.entries(totals).map(([k,v]) => [k,format(v)])), net: format(totals.incoming - totals.outgoing),
    by_mode: Object.fromEntries(Object.entries(modes).map(([mode,v]) => [mode,{ incoming: format(v.incoming), outgoing: format(v.outgoing), net: format(v.incoming-v.outgoing) }])) };
}
async function summary(query = {}) {
  const options = normalize(query);
  if (query.party_type || query.party_id) {
    if (!['customer','supplier'].includes(query.party_type) || !query.party_id) fail('INVALID_REPORT_PARTY');
    return readTransaction(client => (query.party_type === 'supplier' ? supplierDataset : customerDataset)(client, positiveId(query.party_id),options));
  }
  return readTransaction(async client => {
    const { rows: [sales] } = await client.query(`SELECT COALESCE(SUM(grand_total) FILTER(WHERE document_kind IS DISTINCT FROM 'sales_return'),0)::text AS gross_sales,
      COALESCE(-SUM(grand_total) FILTER(WHERE document_kind='sales_return'),0)::text AS returns,
      COALESCE(SUM(grand_total),0)::text AS net_sales,COALESCE(SUM(profit_amount),0)::text AS profit
      FROM invoices WHERE ($1::date IS NULL OR date>=$1) AND date<=$2`, [options.from,options.to]);
    const { rows: invoices } = await client.query(`SELECT id,original_invoice_id,customer_snapshot FROM invoices
      WHERE ($1::date IS NULL OR date>=$1) AND date<=$2 ORDER BY id`, [options.from,options.to]);
    const unverified = [];
    const verifiedSources = new Map();
    for (const invoice of invoices) {
      const sourceId = invoice.original_invoice_id || invoice.id;
      if (!verifiedSources.has(sourceId)) {
        try {
          await require('../../utils/invoiceReconciliation').requireReconciledInvoice(client,sourceId);
          verifiedSources.set(sourceId,null);
        } catch (error) {
          if (!error.errorCode) throw error;
          verifiedSources.set(sourceId,error.errorCode);
        }
      }
      const code = verifiedSources.get(sourceId) || (!invoice.customer_snapshot ? 'ISSUED_PARTY_UNKNOWN' : null);
      if (code) unverified.push({ invoice_id: invoice.id, code });
    }
    sales.reconciliation_required = unverified.length > 0;
    sales.evidence_status = unverified.length ? 'unverified' : 'verified';
    sales.unverified_invoice_count = unverified.length;
    sales.unverified_invoices = unverified;
    const rows = await cashDataset(client,options);
    return { ...options, sales, cash: cashSummary(rows), reconciliation_required: sales.reconciliation_required || rows.some(r => !r.party_snapshot) };
  });
}
function csvCell(value) {
  let s = value === null || value === undefined ? '' : String(value);
  if (/^[\s]*[=+\-@\t\r]/.test(s)) s = "'" + s;
  return '"' + s.replaceAll('"','""') + '"';
}
async function exportRows(query = {}) {
  const options = normalize(query);
  if (!['customer','supplier'].includes(query.party_type) || !query.party_id) fail('INVALID_REPORT_PARTY');
  const dataset = await readTransaction(client => (query.party_type === 'supplier' ? supplierDataset : customerDataset)(client,positiveId(query.party_id),options,true));
  const headers = ['date','kind','party_name','source_type','source_id','description','debit','credit','running_balance'];
  return { filename: `${query.party_type}-statement-${positiveId(query.party_id)}-${options.to}.csv`, content_type: 'text/csv; charset=utf-8',
    content: [headers.map(csvCell).join(','), ...dataset.rows.map(row => headers.map(k => csvCell(row[k])).join(','))].join('\n') + '\n' };
}
module.exports = { supplierStatement, customerStatement, summary, exportRows, normalize, readTransaction, aging, customerDataset, supplierDataset, cashDataset, cashSummary, today };
