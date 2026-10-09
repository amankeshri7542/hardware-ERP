const { createHash } = require('node:crypto');
const { pool } = require('../../config/db');
const { decimal, format, positiveId, date, fail } = require('../../utils/financial');
const { withIdempotency } = require('../../utils/idempotency');
const { requireOpenDate } = require('../../utils/financialPeriod');
const { preparePayment } = require('../payments/paymentPosting');
const { verifyPurchase } = require('../purchases/purchasePosting');
const money = value => decimal(value, 2);
const cashKinds = ['supplier_payment', 'supplier_refund'];
const kinds = ['payable_recognition', ...cashKinds, 'supplier_debit_application', 'reversal', 'payable_reversal'];
function text(value, max, required = false) {
  if (!required && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > max) fail('INVALID_SETTLEMENT_TEXT');
  return value.trim();
}
function normalize(input) {
  const allowed = ['kind','supplier_id','purchase_id','source_type','source_id','amount','date','due_date','document_reference','reason','operator_confirmed','mode','modes_detail','reference_no','targets','quote_hash'];
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(k => !allowed.includes(k))) fail('UNSUPPORTED_SETTLEMENT_FIELD');
  if (!kinds.includes(input.kind)) fail('UNSUPPORTED_SUPPLIER_COMMAND');
  const out = { kind: input.kind, supplier_id: positiveId(input.supplier_id), date: date(input.date), reason: text(input.reason, 500, true) };
  if (input.amount !== undefined || !['reversal','payable_reversal'].includes(input.kind)) out.amount = format(decimal(input.amount, 2, '', { min: 1n }));
  if (input.quote_hash !== undefined) {
    if (typeof input.quote_hash !== 'string' || !/^[a-f0-9]{64}$/.test(input.quote_hash)) fail('INVALID_QUOTE');
    out.quote_hash = input.quote_hash;
  }
  if (input.kind === 'payable_recognition') {
    if (['source_type','source_id','targets','mode','modes_detail','reference_no'].some(k => input[k] !== undefined)) fail('UNSUPPORTED_SETTLEMENT_FIELD');
    out.purchase_id = positiveId(input.purchase_id); out.due_date = date(input.due_date); out.document_reference = text(input.document_reference, 200, true);
    if (out.due_date < out.date) fail('INVALID_DUE_DATE');
  } else {
    if (['purchase_id','due_date','document_reference'].some(k => input[k] !== undefined)) fail('UNSUPPORTED_SETTLEMENT_FIELD');
    out.source_type = { supplier_payment: 'payable', payable_reversal: 'payable', supplier_debit_application: 'debit', supplier_refund: 'debit', reversal: 'event' }[input.kind];
    if (input.source_type !== out.source_type) fail('INVALID_SUPPLIER_SOURCE');
    out.source_id = positiveId(input.source_id);
  }
  if (input.kind === 'supplier_debit_application') {
    if (!Array.isArray(input.targets) || input.targets.length !== 1) fail('INVALID_SUPPLIER_TARGETS');
    const target = input.targets[0];
    if (!target || Object.keys(target).some(k => !['payable_id','amount'].includes(k))) fail('INVALID_SUPPLIER_TARGETS');
    out.targets = [{ payable_id: positiveId(target.payable_id), amount: format(decimal(target.amount, 2, '', { min: 1n })) }];
    if (out.targets[0].amount !== out.amount) fail('SETTLEMENT_TARGET_MISMATCH');
  } else if (input.targets !== undefined) fail('UNSUPPORTED_SETTLEMENT_FIELD');
  const isCash = cashKinds.includes(input.kind);
  if (isCash || (input.kind === 'reversal' && input.mode !== undefined)) {
    if (input.operator_confirmed !== true) fail('OPERATOR_CONFIRMATION_REQUIRED');
    let modes;
    if (input.mode === 'mixed') {
      if (!Array.isArray(input.modes_detail) || input.modes_detail.length < 2) fail('INVALID_PAYMENT_MODES');
      modes = input.modes_detail;
    } else {
      if (input.modes_detail !== undefined && (!Array.isArray(input.modes_detail) || input.modes_detail.length)) fail('CONTRADICTORY_PAYMENT_MODES');
      modes = [{ mode: input.mode, amount: out.amount, reference_no: input.reference_no }];
    }
    if (input.kind === 'reversal' && out.amount === undefined && input.mode !== 'mixed') {
      if (!['cash','upi','bank','cheque'].includes(input.mode)) fail('INVALID_PAYMENT_MODE');
      out.tenders = [{ mode: input.mode, amount: null, reference_no: text(input.reference_no, 100) }];
    } else {
      const tenderAmount = out.amount ?? format(modes.reduce((sum, part) => sum + decimal(part.amount, 2, '', { min: 1n }), 0n));
      out.tenders = preparePayment({ amount: tenderAmount, modes }).modes;
    }
    out.reference_no = text(input.reference_no, 100);
  } else if (['mode','modes_detail','reference_no'].some(k => input[k] !== undefined)) fail('UNSUPPORTED_SETTLEMENT_FIELD');
  if (input.operator_confirmed !== undefined && input.operator_confirmed !== true) fail('OPERATOR_CONFIRMATION_REQUIRED');
  out.operator_confirmed = input.kind === 'reversal' ? input.operator_confirmed === true : true;
  return out;
}
function reconciliation() { fail('SUPPLIER_RECONCILIATION_REQUIRED'); }
function sameParty(row, supplierId) { if (row.supplier_id !== supplierId) fail('SUPPLIER_MISMATCH'); }
function snapshot(supplier) { return { id: supplier.id, name: supplier.name, phone: supplier.phone, address: supplier.address, gstin: supplier.gstin }; }
async function purchaseProof(client, purchase) {
  if (!purchase) fail('PURCHASE_NOT_FOUND', 404);
  const { rows: lines } = await client.query('SELECT * FROM purchase_items WHERE purchase_id=$1 ORDER BY id', [purchase.id]);
  await verifyPurchase(client, purchase, lines);
  if (!purchase.supplier_snapshot) reconciliation();
}
// Derive projections from dated immutable facts. Future reversals never alter an earlier balance.
async function accountData(client, supplierId, query = {}) {
  const asOf = query.as_of ? date(query.as_of) : '9999-12-31';
  const supplier = (await client.query('SELECT id,name,phone,address,gstin,is_active FROM suppliers WHERE id=$1', [supplierId])).rows[0];
  if (!supplier) fail('SUPPLIER_NOT_FOUND', 404);
  const { rows: purchases } = await client.query('SELECT *,date::text AS date FROM purchases WHERE supplier_id=$1 ORDER BY purchases.date,id', [supplierId]);
  const { rows: payables } = await client.query('SELECT *,date::text AS date,due_date::text AS due_date FROM supplier_payables WHERE supplier_id=$1 ORDER BY supplier_payables.date,id', [supplierId]);
  const { rows: debits } = await client.query(`SELECT d.*,r.purchase_id,r.return_date::text AS date,p.supplier_snapshot AS party_snapshot
    FROM supplier_debit_notes d JOIN purchase_returns r ON r.id=d.purchase_return_id JOIN purchases p ON p.id=r.purchase_id WHERE d.supplier_id=$1 ORDER BY r.return_date,d.id`, [supplierId]);
  const { rows: events } = await client.query('SELECT *,date::text AS date FROM settlement_events WHERE supplier_id=$1 ORDER BY settlement_events.date,created_at,id', [supplierId]);
  const { rows: lines } = await client.query('SELECT l.* FROM settlement_lines l JOIN settlement_events e ON e.id=l.event_id WHERE e.supplier_id=$1 ORDER BY l.event_id,l.target_id', [supplierId]);
  const { rows: tenders } = await client.query('SELECT t.* FROM settlement_tenders t JOIN settlement_events e ON e.id=t.event_id WHERE e.supplier_id=$1 ORDER BY t.id', [supplierId]);
  const receipts = [];
  for (const purchase of purchases) {
    let reason = null;
    try { await purchaseProof(client, purchase); } catch (error) { if (!error.errorCode) throw error; reason = error.errorCode; }
    receipts.push({ purchase_id: purchase.id, po_number: purchase.po_number, date: purchase.date, total_amount: purchase.total_amount, party_snapshot: purchase.supplier_snapshot,
      eligible: !reason && !payables.some(p => p.purchase_id === purchase.id) && supplier.is_active, reconciliation_code: reason,
      reason: reason || (payables.some(p => p.purchase_id === purchase.id) ? 'PAYABLE_ALREADY_RECOGNIZED' : supplier.is_active ? null : 'SUPPLIER_UNAVAILABLE') });
  }
  const payableMap = new Map(payables.map(p => [p.id, { ...p, due: p.amount, current_due: p.amount, latest_date: p.date, eligible: true, reversed: false }]));
  const debitMap = new Map(debits.map(d => [d.id, { ...d, available: d.amount, current_available: d.amount, latest_date: d.date, eligible: true }]));
  for (const p of payableMap.values()) {
    const receipt = receipts.find(r => r.purchase_id === p.purchase_id);
    if (!receipt || receipt.reconciliation_code || receipt.total_amount !== p.amount || p.date < receipt.date || !p.party_snapshot) { p.eligible = false; p.reconciliation_code = 'SUPPLIER_RECONCILIATION_REQUIRED'; }
  }
  for (const d of debitMap.values()) {
    const receipt = receipts.find(r => r.purchase_id === d.purchase_id);
    if (!receipt || receipt.reconciliation_code || d.contract_version !== 'phase3-v1' || d.status !== 'outstanding' || money(d.amount) <= 0n) { d.eligible = false; d.reconciliation_code = 'SUPPLIER_RECONCILIATION_REQUIRED'; }
  }
  const eventMap = new Map(events.map(e => [e.id, e]));
  let invalidEvents = false;
  for (const event of events) {
    event.targets = lines.filter(l => l.event_id === event.id).map(l => ({ payable_id: l.target_id, amount: l.amount, target_type: l.target_type }));
    event.tenders = tenders.filter(t => t.event_id === event.id).map(t => ({ mode: t.mode, amount: t.amount, reference_no: t.reference_no }));
    const original = event.kind === 'reversal' ? eventMap.get(event.reverses_event_id) : event;
    const p = original && (original.source_type === 'payable' ? payableMap.get(original.source_id) : payableMap.get(event.targets[0]?.payable_id));
    const d = original?.source_type === 'debit' ? debitMap.get(original.source_id) : null;
    try {
      if (!original || !['supplier_payment','supplier_debit_application','supplier_refund','payable_reversal'].includes(original.kind) || event.customer_id !== null || !event.operator_confirmed || money(event.amount) <= 0n) reconciliation();
      if (event.kind === 'reversal' && (original.kind === 'payable_reversal' || event.source_type !== 'event' || event.source_id !== original.id || event.amount !== original.amount || event.date < original.date ||
        JSON.stringify(event.targets) !== JSON.stringify(original.targets))) reconciliation();
      if (event.kind !== 'reversal' && event.reverses_event_id !== null) reconciliation();
      const usesPayable = ['supplier_payment','supplier_debit_application'].includes(original.kind);
      if (usesPayable ? !p || event.targets.length !== 1 || event.targets[0].target_type !== 'payable' || event.targets[0].payable_id !== p.id || event.targets[0].amount !== event.amount : event.targets.length !== 0) reconciliation();
      if (['supplier_payment','payable_reversal'].includes(original.kind) && (!p || original.source_type !== 'payable' || (usesPayable && p.id !== original.source_id))) reconciliation();
      if (['supplier_debit_application','supplier_refund'].includes(original.kind) && (!d || original.source_type !== 'debit')) reconciliation();
      if ((p && (event.date < p.date || !p.eligible || p.reversed)) || (d && (event.date < d.date || !d.eligible))) reconciliation();
      if (cashKinds.includes(original.kind)) preparePayment({ amount: event.amount, modes: event.tenders }); else if (event.tenders.length) reconciliation();
      const sign = event.kind === 'reversal' ? -1n : 1n;
      if (original.kind === 'payable_reversal') {
        if (event.amount !== p.amount || p.current_due !== p.amount) reconciliation();
        p.current_due = '0.00'; if (event.date <= asOf) { p.due = '0.00'; p.reversed = true; }
      } else if (usesPayable) {
        const current = money(p.current_due) - sign * money(event.amount);
        if (current < 0n || current > money(p.amount)) reconciliation();
        p.current_due = format(current);
        if (event.date <= asOf) p.due = format(money(p.due) - sign * money(event.amount));
      }
      if (d) {
        const current = money(d.current_available) - sign * money(event.amount);
        if (current < 0n || current > money(d.amount)) reconciliation();
        d.current_available = format(current); if (event.date <= asOf) d.available = format(money(d.available) - sign * money(event.amount));
      }
      if (p && event.date > p.latest_date) p.latest_date = event.date;
      if (d && event.date > d.latest_date) d.latest_date = event.date;
      event.cash_direction = event.tenders.length ? (original.kind === 'supplier_refund') !== (event.kind === 'reversal') ? 'in' : 'out' : null;
    } catch (error) {
      if (!error.errorCode) throw error;
      event.reconciliation_code = 'SUPPLIER_RECONCILIATION_REQUIRED'; invalidEvents = true;
      if (p) { p.eligible = false; p.reconciliation_code = event.reconciliation_code; }
      if (d) { d.eligible = false; d.reconciliation_code = event.reconciliation_code; }
    }
  }
  const visiblePayables = [...payableMap.values()].filter(p => p.date <= asOf).map(p => ({ ...p, due: p.eligible ? p.due : null, status: !p.eligible ? 'reconciliation_required' : p.reversed ? 'reversed' : p.due === '0.00' ? 'settled' : 'outstanding' }));
  const visibleDebits = [...debitMap.values()].filter(d => d.date <= asOf).map(d => ({ ...d, available: d.eligible ? d.available : null, effective_status: !d.eligible ? 'reconciliation_required' : d.available === '0.00' ? 'settled' : 'available' }));
  return { supplier, as_of: asOf, receipts: receipts.filter(r => r.date <= asOf), payables: visiblePayables, debits: visibleDebits, events: events.filter(e => e.date <= asOf),
    reconciliation_required: invalidEvents || receipts.some(r => r.reconciliation_code) || visiblePayables.some(p => !p.eligible) || visibleDebits.some(d => !d.eligible) };
}
async function calculate(client, intent) {
  let original = null, debitId = null, payableIds = [], purchaseIds = [];
  let amountText = intent.amount, tenders = intent.tenders || [];
  if (intent.kind === 'reversal') {
    original = (await client.query('SELECT *,date::text AS date FROM settlement_events WHERE id=$1 FOR UPDATE', [intent.source_id])).rows[0];
    if (!original) fail('SETTLEMENT_NOT_FOUND', 404); sameParty(original, intent.supplier_id);
    if (!['supplier_payment','supplier_debit_application','supplier_refund'].includes(original.kind)) fail('UNSUPPORTED_REVERSAL');
    if (intent.amount !== undefined && original.amount !== intent.amount) fail('FULL_REVERSAL_REQUIRED');
    amountText = original.amount;
    if (intent.date <= original.date) fail('REVERSAL_DATE_REQUIRED');
    if ((await client.query('SELECT id FROM settlement_events WHERE reverses_event_id=$1', [original.id])).rowCount) fail('ALREADY_REVERSED', 409);
    if (cashKinds.includes(original.kind)) {
      if (!intent.operator_confirmed) fail('OPERATOR_CONFIRMATION_REQUIRED');
      const originalTenders = (await client.query('SELECT mode,amount,reference_no FROM settlement_tenders WHERE event_id=$1 ORDER BY id', [original.id])).rows;
      preparePayment({ amount: original.amount, modes: originalTenders });
      if (intent.tenders) {
        const explicit = intent.tenders.map(t => ({ ...t, amount: t.amount ?? original.amount }));
        if (JSON.stringify(explicit) !== JSON.stringify(originalTenders)) fail('REVERSAL_TENDER_MISMATCH');
      }
      tenders = originalTenders;
    } else if (intent.tenders) fail('UNEXPECTED_CASH_MOVEMENT');
    const originalLines = (await client.query('SELECT target_id FROM settlement_lines WHERE event_id=$1 ORDER BY target_id', [original.id])).rows;
    payableIds = originalLines.map(l => l.target_id);
    if (original.source_type === 'debit') debitId = original.source_id;
  } else if (intent.source_type === 'debit') debitId = intent.source_id;
  else if (intent.source_type === 'payable') payableIds = [intent.source_id];
  if (intent.targets) payableIds = intent.targets.map(t => t.payable_id);
  if (debitId) {
    const d = (await client.query('SELECT * FROM supplier_debit_notes WHERE id=$1 FOR UPDATE', [debitId])).rows[0];
    if (!d) fail('DEBIT_NOT_FOUND', 404); sameParty(d, intent.supplier_id);
    const r = (await client.query('SELECT purchase_id FROM purchase_returns WHERE id=$1', [d.purchase_return_id])).rows[0];
    if (!r) reconciliation(); purchaseIds.push(r.purchase_id);
  }
  if (payableIds.length) {
    const { rows } = await client.query('SELECT * FROM supplier_payables WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE', [payableIds]);
    if (rows.length !== payableIds.length) fail('PAYABLE_NOT_FOUND', 404);
    for (const p of rows) {
      sameParty(p, intent.supplier_id); purchaseIds.push(p.purchase_id);
      if (intent.kind === 'payable_reversal') {
        if (intent.amount !== undefined && intent.amount !== p.amount) fail('FULL_REVERSAL_REQUIRED');
        amountText = p.amount;
      }
    }
  }
  if (intent.kind === 'payable_recognition') purchaseIds.push(intent.purchase_id);
  purchaseIds = [...new Set(purchaseIds)].sort((a,b) => a-b);
  const { rows: purchases } = await client.query('SELECT *,date::text AS date FROM purchases WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE', [purchaseIds]);
  if (purchases.length !== purchaseIds.length) fail('PURCHASE_NOT_FOUND', 404);
  await client.query('SELECT id FROM purchase_items WHERE purchase_id=ANY($1::integer[]) ORDER BY id FOR UPDATE', [purchaseIds]);
  for (const p of purchases) { sameParty(p, intent.supplier_id); await purchaseProof(client, p); }
  const supplier = (await client.query('SELECT * FROM suppliers WHERE id=$1 FOR UPDATE', [intent.supplier_id])).rows[0];
  if (!supplier?.is_active) fail('SUPPLIER_UNAVAILABLE');
  const state = await accountData(client, supplier.id);
  const record = { kind: intent.kind, source_type: intent.source_type || 'purchase', source_id: intent.source_id || intent.purchase_id, supplier_id: supplier.id, amount: amountText,
    date: intent.date, reason: intent.reason, operator_confirmed: true, reference_no: intent.reference_no || null, party_snapshot: snapshot(supplier), reverses_event_id: original?.id || null };
  const projected = [], amount = money(amountText); let source;
  if (intent.kind === 'payable_recognition') {
    if (state.payables.some(p => p.purchase_id === intent.purchase_id)) fail('PAYABLE_ALREADY_RECOGNIZED', 409);
    const purchase = purchases.find(p => p.id === intent.purchase_id);
    if (purchase.total_amount !== intent.amount) fail('PAYABLE_AMOUNT_MISMATCH');
    if (intent.date < purchase.date) fail('BACKDATED_SETTLEMENT_UNSUPPORTED', 409);
    Object.assign(record, { purchase_id: purchase.id, due_date: intent.due_date, document_reference: intent.document_reference });
    source = { purchase_id: purchase.id, amount: purchase.total_amount, party_snapshot: purchase.supplier_snapshot };
  } else {
    const relevant = [...state.payables.filter(p => payableIds.includes(p.id)), ...state.debits.filter(d => d.id === debitId)];
    if (relevant.some(r => !r.eligible)) reconciliation();
    if (relevant.some(r => intent.date < r.latest_date) || (original && intent.date < original.date)) fail('BACKDATED_SETTLEMENT_UNSUPPORTED', 409);
    const p = state.payables.find(p => payableIds.includes(p.id));
    const d = state.debits.find(d => d.id === debitId);
    if (p?.reversed) fail('PAYABLE_REVERSED');
    if (original && state.events.find(e => e.id === original.id)?.reconciliation_code) reconciliation();
    if (intent.kind === 'payable_reversal') {
      if (intent.date <= p.date) fail('REVERSAL_DATE_REQUIRED');
      if (p.current_due !== p.amount) fail('PAYABLE_HAS_SETTLEMENTS');
      source = { ...p, due_after: '0.00' };
    } else {
      const delta = original ? amount : -amount;
      if (p) {
        const after = money(p.current_due) + delta;
        if (after < 0n || after > money(p.amount)) fail('PAYABLE_AMOUNT_EXCEEDED');
        projected.push({ payable_id: p.id, amount: amountText, due_before: p.current_due, due: format(after), due_after: format(after), document_reference: p.document_reference });
      }
      if (d) {
        const after = money(d.current_available) + delta;
        if (after < 0n || after > money(d.amount)) fail('DEBIT_AMOUNT_EXCEEDED');
        source = { ...d, available_after: format(after) };
      } else source = p;
    }
  }
  const effectKind = original?.kind || intent.kind;
  const quote = { ...record, record, source, targets: projected, tenders, cash_direction: tenders.length ? ((effectKind === 'supplier_refund') !== !!original ? 'in' : 'out') : null };
  quote.quote_hash = createHash('sha256').update(JSON.stringify(quote)).digest('hex');
  return quote;
}
async function quote(input) {
  const intent = normalize(input), client = await pool.connect();
  try { await client.query('BEGIN'); await requireOpenDate(client, intent.date); const result = await calculate(client, intent); await client.query('ROLLBACK'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
async function execute(input, userId, key) {
  const intent = normalize(input);
  return withIdempotency({ actorId: userId, operation: `finance.supplier.${intent.kind}`, key, intent }, async client => {
    const reviewed = await calculate(client, intent);
    if (intent.quote_hash && intent.quote_hash !== reviewed.quote_hash) fail('SETTLEMENT_QUOTE_CHANGED', 409);
    const r = reviewed.record; let record;
    if (intent.kind === 'payable_recognition') {
      const result = await client.query(`INSERT INTO supplier_payables(purchase_id,supplier_id,amount,date,due_date,document_reference,party_snapshot,created_by,reason)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING *,date::text AS date,due_date::text AS due_date`, [r.purchase_id,r.supplier_id,r.amount,r.date,r.due_date,r.document_reference,r.party_snapshot,userId,r.reason]);
      record = { ...result.rows[0], kind: r.kind, source_type: 'purchase', source_id: r.purchase_id };
    } else {
      const result = await client.query(`INSERT INTO settlement_events(kind,source_type,source_id,supplier_id,amount,date,reason,operator_confirmed,reference_no,party_snapshot,created_by,reverses_event_id)
        VALUES($1,$2,$3,$4,$5,$6,$7,true,$8,$9,$10,$11) RETURNING *,date::text AS date`, [r.kind,r.source_type,r.source_id,r.supplier_id,r.amount,r.date,r.reason,r.reference_no,r.party_snapshot,userId,r.reverses_event_id]);
      record = result.rows[0];
      for (const target of reviewed.targets) await client.query("INSERT INTO settlement_lines(event_id,target_type,target_id,amount) VALUES($1,'payable',$2,$3)", [record.id,target.payable_id,target.amount]);
      for (const tender of reviewed.tenders) await client.query('INSERT INTO settlement_tenders(event_id,mode,amount,reference_no) VALUES($1,$2,$3,$4)', [record.id,tender.mode,tender.amount,tender.reference_no]);
    }
    return { status: 201, body: { success: true, data: { record, source: reviewed.source, targets: reviewed.targets, tenders: reviewed.tenders, cash_direction: reviewed.cash_direction } } };
  });
}
async function getAccount(id, query = {}) {
  const client = await pool.connect();
  try { await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); const result = await accountData(client, positiveId(id), query); await client.query('COMMIT'); return result; }
  catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
module.exports = { quote, execute, getAccount, accountData };
