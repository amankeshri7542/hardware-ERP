const { decimal, format, fail } = require('../../utils/financial');
const { preparePayment } = require('../payments/paymentPosting');

const CUSTOMER_KINDS = ['customer_allocation', 'customer_refund', 'anonymous_refund', 'payment_reversal'];
const money = value => decimal(value, 2);
function reconciliation() { fail('SOURCE_RECONCILIATION_REQUIRED'); }
async function loadSource(client, type, id, lock = false) {
  const tables = { advance: 'payments', payment: 'payments', return_credit: 'sales_return_applications', anonymous_liability: 'anonymous_return_liabilities' };
  if (!tables[type]) fail('UNSUPPORTED_CUSTOMER_SOURCE');
  const { rows: [row] } = await client.query(`SELECT *, ${type === 'advance' || type === 'payment' ? 'payment_date' : 'date'}::text AS source_date FROM ${tables[type]} WHERE id=$1${lock ? ' FOR UPDATE' : ''}`, [id]);
  if (!row) fail('SETTLEMENT_SOURCE_NOT_FOUND', 404);
  const amount = type === 'return_credit' ? row.unapplied_amount : row.amount;
  return { source_type: type, source_id: id, customer_id: row.customer_id ?? null, recognized_amount: amount,
    date: row.source_date, original_invoice_id: row.original_invoice_id ?? row.invoice_id ?? null, row };
}
async function verifyReceipt(client, payment) {
  const { rows: tenders } = await client.query('SELECT mode,amount,reference_no FROM payment_modes_detail WHERE payment_id=$1 ORDER BY id', [payment.id]);
  try {
    const prepared = preparePayment({ amount: payment.amount, modes: tenders });
    if (prepared.mode !== payment.mode || (payment.mode !== 'mixed' && prepared.reference_no !== payment.reference_no)) reconciliation();
  } catch (error) { if (error.errorCode) reconciliation(); throw error; }
  const { rows: ledger } = await client.query("SELECT customer_id,entry_type,debit,credit,date::text AS date FROM customer_ledger WHERE reference_type='payment' AND reference_id=$1", [payment.id]);
  if (payment.customer_id === null ? ledger.length !== 0 : ledger.length !== 1 || ledger[0].customer_id !== payment.customer_id ||
      ledger[0].entry_type !== (payment.invoice_id === null ? 'advance' : 'payment') || money(ledger[0].debit) !== 0n || money(ledger[0].credit) !== money(payment.amount)) reconciliation();
  const { rows: evidence } = await client.query(`SELECT operation,response_body FROM idempotency_keys WHERE actor_id=$1 AND status_code=201 AND
    ((operation='payment.create' AND response_body->'data'->>'id'=$2) OR
     (operation='invoice.create' AND response_body->'data'->>'invoice_id'=$3))`, [payment.created_by, String(payment.id), String(payment.invoice_id)]);
  const { rows: [issued] } = await client.query(`SELECT p.payment_date::text AS date,p.created_at=i.created_at AND p.created_by=i.created_by AND p.payment_date=i.date AS initial
    FROM payments p LEFT JOIN invoices i ON i.id=p.invoice_id WHERE p.id=$1`, [payment.id]);
  if (payment.customer_id !== null && ledger[0].date !== issued.date) reconciliation();
  const proven = evidence.some(entry => {
    const receipt = entry.response_body?.data;
    return receipt && receipt.customer_id === payment.customer_id && (entry.operation === 'payment.create'
      ? receipt.invoice_id === payment.invoice_id && receipt.amount === payment.amount && receipt.mode === payment.mode && receipt.payment_date === issued.date
      : issued?.initial === true && receipt.amount_paid === payment.amount);
  });
  if (!proven || money(payment.amount) <= 0n) reconciliation();
  return tenders;
}
async function verifySource(client, source) {
  const { row, source_type: type } = source;
  if (type === 'advance' || type === 'payment') {
    if (type === 'advance' && (row.invoice_id !== null || row.customer_id === null)) reconciliation();
    source.tenders = await verifyReceipt(client, row);
  } else {
    const { rows: [credit] } = await client.query('SELECT *,date::text AS issued_date FROM invoices WHERE id=$1', [row.credit_invoice_id]);
    if (!credit || credit.document_kind !== 'sales_return' || credit.contract_version !== 'phase3-v1' ||
        credit.original_invoice_id !== row.original_invoice_id || credit.customer_id !== source.customer_id ||
        credit.amount_paid !== '0.00' || credit.balance_due !== '0.00' || credit.status !== 'paid' || credit.issued_date !== source.date || credit.created_by !== row.created_by) reconciliation();
    const { rows: issued } = await client.query(`SELECT response_body->'data' AS receipt FROM idempotency_keys WHERE operation='invoice.return'
      AND actor_id=$1 AND status_code=201 AND response_body->'data'->>'credit_note_id'=$2`, [credit.created_by,String(credit.id)]);
    if (issued.length !== 1 || issued[0].receipt?.original_invoice_id !== row.original_invoice_id || issued[0].receipt?.customer_id !== source.customer_id ||
        issued[0].receipt?.grand_total !== credit.grand_total) reconciliation();
    if (type === 'return_credit') {
      if (issued[0].receipt.applied_amount !== row.applied_amount || issued[0].receipt.unapplied_amount !== row.unapplied_amount) reconciliation();
      if (source.customer_id === null || credit.grand_total !== format(-money(row.total_credit)) ||
          money(row.total_credit) !== money(row.applied_amount) + money(row.unapplied_amount)) reconciliation();
      const { rows: ledger } = await client.query("SELECT customer_id,entry_type,debit,credit FROM customer_ledger WHERE reference_type='invoice' AND reference_id=$1", [credit.id]);
      if (ledger.length !== 1 || ledger[0].customer_id !== source.customer_id || ledger[0].entry_type !== 'return' || ledger[0].debit !== '0.00' || ledger[0].credit !== row.total_credit) reconciliation();
    } else if (credit.customer_id !== null || credit.grand_total !== format(-money(row.amount))) reconciliation();
  }
  return source;
}
async function eventDetails(client, event) {
  const { rows: lines } = await client.query('SELECT target_type,target_id,amount FROM settlement_lines WHERE event_id=$1 ORDER BY target_id', [event.id]);
  const { rows: tenders } = await client.query('SELECT mode,amount,reference_no FROM settlement_tenders WHERE event_id=$1 ORDER BY id', [event.id]);
  return { lines, tenders };
}
async function verifyEvent(client, event, seen = new Set()) {
  if (seen.has(event.id)) reconciliation();
  seen.add(event.id);
  const details = await eventDetails(client, event);
  let effect = event;
  if (event.kind === 'reversal') {
    const { rows: [original] } = await client.query('SELECT *,date::text AS date FROM settlement_events WHERE id=$1', [event.reverses_event_id]);
    if (!original || !['customer_allocation', 'customer_refund', 'anonymous_refund'].includes(original.kind) ||
        event.source_type !== 'event' || event.source_id !== original.id || event.customer_id !== original.customer_id ||
        event.amount !== original.amount || event.date < original.date) reconciliation();
    const originalDetails = await verifyEvent(client, original, seen);
    if (JSON.stringify(details) !== JSON.stringify(originalDetails)) reconciliation();
    effect = original;
  } else if (!CUSTOMER_KINDS.includes(event.kind) || event.reverses_event_id !== null) reconciliation();
  if (event.supplier_id !== null || money(event.amount) <= 0n) reconciliation();
  if (effect.kind === 'customer_allocation') {
    if (details.tenders.length || !details.lines.length || details.lines.some(line => line.target_type !== 'invoice' || money(line.amount) <= 0n) ||
        details.lines.reduce((sum, line) => sum + money(line.amount), 0n) !== money(event.amount)) reconciliation();
    for (const line of details.lines) {
      const { rows: [target] } = await client.query('SELECT customer_id,document_kind FROM invoices WHERE id=$1', [line.target_id]);
      if (!target || target.customer_id !== event.customer_id || target.document_kind === 'sales_return') reconciliation();
    }
  } else {
    if (details.lines.length || !event.operator_confirmed) reconciliation();
    try { preparePayment({ amount: event.amount, modes: details.tenders }); }
    catch (error) { if (error.errorCode) reconciliation(); throw error; }
  }
  const { rows: ledger } = await client.query("SELECT customer_id,entry_type,debit,credit FROM customer_ledger WHERE reference_type='settlement' AND reference_id=$1", [event.id]);
  if (effect.kind === 'customer_allocation' || event.customer_id === null) {
    if (ledger.length) reconciliation();
  } else {
    const debit = event.kind === 'reversal' ? '0.00' : event.amount;
    const credit = event.kind === 'reversal' ? event.amount : '0.00';
    if (ledger.length !== 1 || ledger[0].customer_id !== event.customer_id || ledger[0].entry_type !== 'adjustment' || ledger[0].debit !== debit || ledger[0].credit !== credit) reconciliation();
  }
  const { rows: saved } = await client.query(`SELECT response_body->'data'->'record' AS record FROM idempotency_keys
    WHERE operation=$1 AND actor_id=$2 AND status_code=201 AND response_body->'data'->'record'->>'id'=$3`,
  [`finance.customer.${event.kind}`, event.created_by, String(event.id)]);
  if (saved.length !== 1 || !saved[0].record || ['id', 'kind', 'source_type', 'source_id', 'customer_id', 'amount', 'date', 'reverses_event_id'].some(key => saved[0].record[key] !== event[key])) reconciliation();
  return details;
}
async function sourceHistory(client, source, asOf = '9999-12-31') {
  const { rows: events } = await client.query(`SELECT e.*,e.date::text AS date FROM settlement_events e WHERE
    (e.source_type=$1 AND e.source_id=$2) OR
    ($1='advance' AND e.kind='payment_reversal' AND e.source_type='payment' AND e.source_id=$2) OR
    e.reverses_event_id IN (SELECT id FROM settlement_events WHERE source_type=$1 AND source_id=$2)
    ORDER BY e.date,e.id`, [source.source_type, source.source_id]);
  let available = money(source.recognized_amount); let current = available; let latest = source.date;
  for (const event of events) {
    await verifyEvent(client, event);
    if (event.customer_id !== source.customer_id || (event.kind !== 'reversal' && event.date < source.date)) reconciliation();
    const delta = event.kind === 'reversal' ? money(event.amount) : -money(event.amount);
    current += delta;
    if (current < 0n || current > money(source.recognized_amount)) reconciliation();
    if (event.date <= asOf) available += delta;
    if (event.date > latest) latest = event.date;
  }
  return { available_amount: format(available), current_available_amount: format(current), latest_date: latest, events };
}
async function invoiceEffects(client, invoiceId) {
  const { rows: events } = await client.query(`SELECT DISTINCT e.*,e.date::text AS date FROM settlement_events e
    LEFT JOIN settlement_lines l ON l.event_id=e.id LEFT JOIN payments p ON e.source_type='payment' AND p.id=e.source_id
    WHERE (l.target_type='invoice' AND l.target_id=$1) OR (e.kind='payment_reversal' AND p.invoice_id=$1) ORDER BY e.id`, [invoiceId]);
  let allocated = 0n; let reversedPayments = 0n;
  for (const event of events) {
    const details = await verifyEvent(client, event);
    if (event.kind === 'payment_reversal') {
      const source = await loadSource(client, 'payment', event.source_id); await verifySource(client, source);
      if (source.customer_id !== event.customer_id || source.recognized_amount !== event.amount) reconciliation();
      reversedPayments += money(event.amount);
    } else {
      const original = event.kind === 'reversal'
        ? (await client.query('SELECT * FROM settlement_events WHERE id=$1', [event.reverses_event_id])).rows[0] : event;
      const source = await loadSource(client, original.source_type, original.source_id); await verifySource(client, source);
      if (source.customer_id !== original.customer_id) reconciliation();
      await sourceHistory(client, source);
      for (const line of details.lines) if (line.target_id === invoiceId) allocated += (event.kind === 'reversal' ? -1n : 1n) * money(line.amount);
    }
  }
  return { allocated: format(allocated), reversedPayments: format(reversedPayments) };
}

module.exports = { loadSource, verifySource, verifyReceipt, eventDetails, verifyEvent, sourceHistory, invoiceEffects };
