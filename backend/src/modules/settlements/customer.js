const { createHash } = require('node:crypto');
const { pool } = require('../../config/db');
const { decimal, format, positiveId, date, fail } = require('../../utils/financial');
const { withIdempotency } = require('../../utils/idempotency');
const { requireOpenDate } = require('../../utils/financialPeriod');
const { requireReconciledInvoice } = require('../../utils/invoiceReconciliation');
const { normalize } = require('./customerIntent');
const evidence = require('./customerEvidence');

const money = value => decimal(value, 2);
const sourceView = source => ({ source_type: source.source_type, source_id: source.source_id,
  recognized_amount: source.recognized_amount, available_amount: source.available_amount, date: source.date });
async function latestInvoiceDate(client, invoiceId) {
  const { rows: [row] } = await client.query(`SELECT MAX(date)::text AS date FROM (
    SELECT date FROM invoices WHERE id=$1 OR original_invoice_id=$1
    UNION ALL SELECT payment_date FROM payments WHERE invoice_id=$1
    UNION ALL SELECT e.date FROM settlement_events e JOIN settlement_lines l ON l.event_id=e.id WHERE l.target_type='invoice' AND l.target_id=$1
    UNION ALL SELECT e.date FROM settlement_events e JOIN payments p ON e.source_type='payment' AND p.id=e.source_id WHERE p.invoice_id=$1
    ) history`, [invoiceId]);
  return row.date;
}
async function requireInvoiceDate(client, invoiceId, postingDate) {
  if (postingDate < await latestInvoiceDate(client, invoiceId)) fail('BACKDATED_SETTLEMENT_UNSUPPORTED');
}
async function calculate(client, intent) {
  let original = null;
  let sourceType = intent.source_type; let sourceId = intent.source_id;
  let targets = intent.targets || []; let tenders = intent.tenders || [];
  let amount = intent.amount;
  if (intent.kind === 'reversal') {
    original = (await client.query('SELECT *,date::text AS date FROM settlement_events WHERE id=$1 FOR UPDATE', [intent.source_id])).rows[0];
    if (!original) fail('SETTLEMENT_SOURCE_NOT_FOUND', 404);
    if (!['customer_allocation', 'customer_refund', 'anonymous_refund'].includes(original.kind)) fail('UNSUPPORTED_SETTLEMENT_REVERSAL');
    if ((await client.query('SELECT id FROM settlement_events WHERE reverses_event_id=$1', [original.id])).rowCount) fail('SETTLEMENT_ALREADY_REVERSED');
    if (intent.date <= original.date) fail('REVERSAL_DATE_REQUIRED');
    const details = await evidence.verifyEvent(client, original);
    sourceType = original.source_type; sourceId = original.source_id;
    amount = original.amount;
    targets = details.lines.map(line => ({ invoice_id: line.target_id, amount: line.amount })); tenders = details.tenders;
  }
  const source = await evidence.loadSource(client, sourceType, sourceId, true);
  if (source.customer_id !== intent.customer_id) fail('CUSTOMER_SOURCE_MISMATCH');
  if (intent.date < source.date) fail('BACKDATED_SETTLEMENT_UNSUPPORTED');
  const documentIds = [...new Set([source.original_invoice_id, ...targets.map(target => target.invoice_id)].filter(Boolean))].sort((a, b) => a - b);
  const { rows: invoices } = await client.query('SELECT *,date::text AS date,due_date::text AS due_date FROM invoices WHERE id=ANY($1::int[]) ORDER BY id FOR UPDATE', [documentIds]);
  if (invoices.length !== documentIds.length) fail('INVOICE_NOT_FOUND', 404);
  const byId = new Map(invoices.map(invoice => [invoice.id, invoice]));
  await evidence.verifySource(client, source);
  for (const invoice of invoices) await requireReconciledInvoice(client, invoice.id);
  let party = { registered: false, original_invoice_id: source.original_invoice_id,
    issued_party_snapshot: byId.get(source.original_invoice_id)?.customer_snapshot ?? null };
  if (source.customer_id !== null) {
    party = (await client.query('SELECT id,name,phone,address,is_active FROM customers WHERE id=$1 FOR UPDATE', [source.customer_id])).rows[0];
    if (!party?.is_active) fail('CUSTOMER_NOT_FOUND', 404);
  }
  if (intent.kind === 'payment_reversal') {
    if ((await client.query("SELECT id FROM settlement_events WHERE kind='payment_reversal' AND source_type='payment' AND source_id=$1", [sourceId])).rowCount) fail('SETTLEMENT_ALREADY_REVERSED');
    if (source.row.invoice_id === null) {
      const advance = { ...source, source_type: 'advance' };
      const history = await evidence.sourceHistory(client, advance);
      if (history.current_available_amount !== source.recognized_amount) fail('SOURCE_HAS_DEPENDENCIES');
      if (intent.date < history.latest_date) fail('BACKDATED_SETTLEMENT_UNSUPPORTED');
    } else {
      const { rows: [dependencies] } = await client.query(`SELECT EXISTS(SELECT 1 FROM sales_return_applications WHERE original_invoice_id=$1 AND unapplied_amount>0)
        OR EXISTS(SELECT 1 FROM anonymous_return_liabilities WHERE original_invoice_id=$1) AS present`, [source.row.invoice_id]);
      if (dependencies.present) fail('SOURCE_HAS_DEPENDENCIES');
      await requireInvoiceDate(client, source.row.invoice_id, intent.date);
    }
    amount = source.recognized_amount; tenders = source.tenders;
  }
  if (intent.amount !== undefined && money(intent.amount) !== money(amount)) fail('SETTLEMENT_AMOUNT_MISMATCH');
  const history = await evidence.sourceHistory(client, source, intent.date);
  if (intent.date < history.latest_date) fail('BACKDATED_SETTLEMENT_UNSUPPORTED');
  source.available_amount = history.current_available_amount;
  const reversing = intent.kind === 'reversal';
  if (!reversing && money(amount) > money(source.available_amount)) fail('SOURCE_INSUFFICIENT');
  const after = money(source.available_amount) + (reversing ? 1n : -1n) * money(amount);
  if (after < 0n || after > money(source.recognized_amount)) fail('SOURCE_INSUFFICIENT');
  const projected = [];
  for (const target of targets) {
    const invoice = byId.get(target.invoice_id);
    if (invoice.customer_id !== source.customer_id || invoice.customer_id === null) fail('INVOICE_CUSTOMER_MISMATCH');
    if (invoice.document_kind === 'sales_return' || money(invoice.grand_total) <= 0n) fail('INVOICE_NOT_PAYABLE');
    await requireInvoiceDate(client, invoice.id, intent.date);
    const due = money(invoice.balance_due) + (reversing ? 1n : -1n) * money(target.amount);
    if (due < 0n || due > money(invoice.grand_total)) fail('ALLOCATION_EXCEEDS_BALANCE');
    projected.push({ invoice_id: invoice.id, invoice_no: invoice.invoice_no, amount: target.amount,
      balance_due: format(due), amount_paid: invoice.amount_paid });
  }
  if (intent.kind === 'payment_reversal' && source.row.invoice_id !== null) {
    const invoice = byId.get(source.row.invoice_id);
    if (money(invoice.amount_paid) < money(amount)) fail('SOURCE_RECONCILIATION_REQUIRED');
    projected.push({ invoice_id: invoice.id, invoice_no: invoice.invoice_no, amount,
      balance_due: format(money(invoice.balance_due) + money(amount)), amount_paid: format(money(invoice.amount_paid) - money(amount)) });
  }
  const record = { kind: intent.kind, source_type: intent.source_type, source_id: intent.source_id,
    customer_id: source.customer_id, supplier_id: null, amount, date: intent.date, reason: intent.reason,
    operator_confirmed: intent.operator_confirmed, reference_no: intent.reference_no, party_snapshot: party,
    reverses_event_id: original?.id || null };
  const quote = { ...record, record, source: { ...sourceView(source), available_after: format(after) }, targets: projected, tenders,
    cash_direction: tenders.length ? reversing ? 'in' : 'out' : null };
  quote.quote_hash = createHash('sha256').update(JSON.stringify(quote)).digest('hex');
  return { quote, source, targets, invoices, original };
}
async function quote(input) {
  const intent = normalize(input); const client = await pool.connect();
  try {
    await client.query('BEGIN'); await requireOpenDate(client, intent.date);
    const result = await calculate(client, intent); await client.query('ROLLBACK'); return result.quote;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function execute(input, userId, key) {
  const intent = normalize(input);
  return withIdempotency({ actorId: userId, operation: `finance.customer.${intent.kind}`, key, intent }, async client => {
    const state = await calculate(client, intent); const reviewed = state.quote;
    if (intent.quote_hash && intent.quote_hash !== reviewed.quote_hash) fail('SETTLEMENT_QUOTE_CHANGED', 409);
    const r = reviewed.record;
    const { rows: [record] } = await client.query(`INSERT INTO settlement_events(kind,source_type,source_id,customer_id,supplier_id,amount,date,reason,
      operator_confirmed,reference_no,party_snapshot,created_by,reverses_event_id) VALUES($1,$2,$3,$4,NULL,$5,$6,$7,$8,$9,$10,$11,$12)
      RETURNING *,date::text AS date`, [r.kind,r.source_type,r.source_id,r.customer_id,r.amount,r.date,r.reason,r.operator_confirmed,r.reference_no,r.party_snapshot,userId,r.reverses_event_id]);
    for (const target of state.targets) await client.query("INSERT INTO settlement_lines(event_id,target_type,target_id,amount) VALUES($1,'invoice',$2,$3)", [record.id,target.invoice_id,target.amount]);
    for (const tender of reviewed.tenders) await client.query('INSERT INTO settlement_tenders(event_id,mode,amount,reference_no) VALUES($1,$2,$3,$4)', [record.id,tender.mode,tender.amount,tender.reference_no]);
    for (const target of reviewed.targets) {
      const invoice = state.invoices.find(item => item.id === target.invoice_id);
      const status = target.balance_due === '0.00' ? 'paid' : money(target.balance_due) < money(invoice.grand_total) ? 'partial' : 'unpaid';
      await client.query('UPDATE invoices SET amount_paid=$1,balance_due=$2,status=$3 WHERE id=$4', [target.amount_paid,target.balance_due,status,target.invoice_id]);
    }
    const underlyingKind = state.original?.kind || record.kind;
    if (record.customer_id !== null && underlyingKind !== 'customer_allocation') {
      await client.query(`INSERT INTO customer_ledger(customer_id,date,entry_type,reference_type,reference_id,debit,credit,balance,description)
        VALUES($1,$2,'adjustment','settlement',$3,$4,$5,0,$6)`, [record.customer_id,record.date,record.id,
        record.kind === 'reversal' ? '0.00' : record.amount,record.kind === 'reversal' ? record.amount : '0.00',record.reason]);
    }
    return { status: 201, body: { success: true, data: { record, source: { ...reviewed.source, available_amount: reviewed.source.available_after },
      targets: reviewed.targets, tenders: reviewed.tenders, cash_direction: reviewed.cash_direction } } };
  });
}
async function accountData(client, customerId, query = {}) {
  const asOf = query.as_of ? date(query.as_of) : '9999-12-31';
  const customer = (await client.query(`SELECT id,name,phone,address,is_active,
    (SELECT COALESCE(SUM(debit-credit),0)::text FROM customer_ledger WHERE customer_id=$1 AND date<=$2) AS outstanding_balance
    FROM customers WHERE id=$1`, [customerId,asOf])).rows[0];
  if (!customer) fail('CUSTOMER_NOT_FOUND', 404);
  const { rows: references } = await client.query(`SELECT 'advance' AS source_type,id AS source_id FROM payments WHERE customer_id=$1 AND invoice_id IS NULL AND payment_date<=$2
    UNION ALL SELECT 'return_credit',id FROM sales_return_applications WHERE customer_id=$1 AND date<=$2 ORDER BY source_type,source_id`, [customerId,asOf]);
  const sources = [];
  for (const reference of references) {
    const source = await evidence.loadSource(client, reference.source_type, reference.source_id);
    try {
      await evidence.verifySource(client, source);
      if (source.source_type === 'return_credit') await requireReconciledInvoice(client, source.original_invoice_id);
      const history = await evidence.sourceHistory(client, source, asOf);
      sources.push({ ...sourceView({ ...source, available_amount: history.available_amount }), reference_no: source.row.reference_no || null, eligible: true });
    } catch (error) {
      if (!error.errorCode) throw error;
      sources.push({ ...sourceView({ ...source, available_amount: null }), eligible: false, reconciliation_code: error.errorCode });
    }
  }
  const { rows: invoices } = await client.query(`WITH projection AS (
    SELECT i.id,i.invoice_no,i.date,i.due_date,i.grand_total,i.customer_snapshot,
      (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id AND p.payment_date<=$2)
        - (SELECT COALESCE(SUM(e.amount),0) FROM settlement_events e JOIN payments p ON p.id=e.source_id
          WHERE e.kind='payment_reversal' AND e.source_type='payment' AND p.invoice_id=i.id AND e.date<=$2) AS paid,
      (SELECT COALESCE(SUM(a.applied_amount),0) FROM sales_return_applications a WHERE a.original_invoice_id=i.id AND a.date<=$2)
        + (SELECT COALESCE(SUM(CASE WHEN e.kind='reversal' THEN -l.amount ELSE l.amount END),0) FROM settlement_lines l JOIN settlement_events e ON e.id=l.event_id
          WHERE l.target_type='invoice' AND l.target_id=i.id AND e.date<=$2) AS applied
    FROM invoices i WHERE i.customer_id=$1 AND i.document_kind IS DISTINCT FROM 'sales_return' AND i.date<=$2)
    SELECT id,invoice_no,date::text,due_date::text,grand_total,customer_snapshot AS party_snapshot,
      paid::numeric(12,2)::text AS amount_paid,(grand_total-paid-applied)::numeric(12,2)::text AS balance_due,
      applied::numeric(12,2)::text AS applied_credit FROM projection ORDER BY date,id`, [customerId,asOf]);
  for (const invoice of invoices) {
    invoice.identity_status = invoice.party_snapshot ? 'issued_snapshot' : 'unknown';
    invoice.due_date_status = invoice.due_date ? 'known' : 'unknown';
    try { await requireReconciledInvoice(client,invoice.id); invoice.eligible = true; }
    catch (error) { if (!error.errorCode) throw error; invoice.eligible = false; invoice.balance_due = null; invoice.reconciliation_code = error.errorCode; }
  }
  const { rows: events } = await client.query('SELECT e.*,e.date::text AS date FROM settlement_events e WHERE e.customer_id=$1 AND e.date<=$2 ORDER BY e.date,e.id', [customerId,asOf]);
  return { customer, sources, invoices, events, as_of: asOf };
}
async function getAccount(customerId, query) {
  const client = await pool.connect();
  try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const result = await accountData(client,positiveId(customerId),query); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function listAnonymous(query = {}) {
  const asOf = query.as_of ? date(query.as_of) : '9999-12-31';
  const client = await pool.connect();
  try {
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
    const { rows } = await client.query(`SELECT a.id AS source_id,a.credit_invoice_id,a.original_invoice_id,a.amount AS recognized_amount,a.date::text,
      i.invoice_no,i.customer_name_walkin FROM anonymous_return_liabilities a JOIN invoices i ON i.id=a.original_invoice_id WHERE a.date<=$1 ORDER BY a.date,a.id`, [asOf]);
    for (const row of rows) {
      row.source_type = 'anonymous_liability';
      try {
        const source = await evidence.loadSource(client,row.source_type,row.source_id); await evidence.verifySource(client,source);
        await requireReconciledInvoice(client,source.original_invoice_id);
        const history = await evidence.sourceHistory(client,source,asOf);
        row.available_amount = history.available_amount; row.events = history.events.filter(event => event.date <= asOf); row.eligible = true;
      } catch (error) { if (!error.errorCode) throw error; row.available_amount = null; row.eligible = false; row.reconciliation_code = error.errorCode; }
    }
    await client.query('COMMIT'); return rows;
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}

module.exports = { quote, execute, getAccount, listAnonymous, requireInvoiceDate, accountData };
