const { decimal, format, positiveId, date, fail } = require('../../utils/financial');
const TENDERS = new Set(['cash', 'upi', 'bank', 'cheque']);

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some((key) => !allowed.includes(key))) fail('UNSUPPORTED_PAYMENT_FIELD');
}

function text(value, maximum) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > maximum) fail('INVALID_PAYMENT_TEXT');
  return value;
}

function preparePayment({ amount, modes = [] }) {
  const cents = decimal(amount, 2, 'payment amount');
  if (!Array.isArray(modes) || modes.length > 100) fail('INVALID_PAYMENT_MODES');
  const normalized = modes.map((detail) => {
    fields(detail, ['mode', 'amount', 'reference_no']);
    if (!TENDERS.has(detail.mode)) fail('INVALID_PAYMENT_MODE');
    return { mode: detail.mode, amount: format(decimal(detail.amount, 2, 'tender amount', { min: 1n })),
      reference_no: text(detail.reference_no, 100) };
  });
  const total = normalized.reduce((sum, detail) => sum + decimal(detail.amount, 2, 'tender amount'), 0n);
  if (total !== cents || (cents > 0n && !normalized.length) || (cents === 0n && normalized.length)) fail('PAYMENT_SPLIT_MISMATCH');
  return { amount: format(cents), mode: normalized.length > 1 ? 'mixed' : normalized[0]?.mode || null,
    reference_no: normalized.length === 1 ? normalized[0].reference_no : null, modes: normalized };
}

function normalizePaymentIntent(data) {
  fields(data, ['customer_id', 'invoice_id', 'amount', 'mode', 'payment_date', 'reference_no', 'notes', 'modes_detail']);
  const amount = format(decimal(data.amount, 2, 'payment amount', { min: 1n }));
  const reference = text(data.reference_no, 100);
  let modes;
  if (data.mode === 'mixed') {
    if (!Array.isArray(data.modes_detail) || data.modes_detail.length < 2) fail('INVALID_PAYMENT_MODES');
    modes = data.modes_detail;
  } else {
    if (!TENDERS.has(data.mode)) fail('INVALID_PAYMENT_MODE');
    if (data.modes_detail !== undefined && (!Array.isArray(data.modes_detail) || data.modes_detail.length)) fail('CONTRADICTORY_PAYMENT_MODES');
    modes = [{ mode: data.mode, amount, reference_no: reference }];
  }
  const payment = preparePayment({ amount, modes });
  if (data.mode === 'mixed') payment.reference_no = reference;
  return {
    customer_id: positiveId(data.customer_id, 'customer'),
    invoice_id: data.invoice_id === undefined || data.invoice_id === null ? null : positiveId(data.invoice_id, 'invoice'),
    payment, payment_date: date(data.payment_date, 'payment date'), notes: text(data.notes, 500),
  };
}

// The caller owns the transaction and locks the invoice (if any), then customer, before posting.
async function postPayment(client, { customerId, invoiceId, payment, paymentDate, notes = null, userId }) {
  if (payment.amount === '0.00') return null;
  const { rows } = await client.query(
    `INSERT INTO payments(customer_id,invoice_id,amount,mode,payment_date,reference_no,notes,created_by)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8)
     RETURNING id,customer_id,invoice_id,amount,mode,payment_date::text AS payment_date,reference_no,notes,created_at`,
    [customerId, invoiceId, payment.amount, payment.mode, paymentDate, payment.reference_no, notes, userId]);
  const receipt = rows[0];
  for (const tender of payment.modes) {
    await client.query('INSERT INTO payment_modes_detail(payment_id,mode,amount,reference_no) VALUES($1,$2,$3,$4)',
      [receipt.id, tender.mode, tender.amount, tender.reference_no]);
  }
  if (customerId !== null && customerId !== undefined) {
    await client.query(
      `INSERT INTO customer_ledger(customer_id,date,entry_type,reference_id,reference_type,debit,credit,balance,description)
       VALUES($1,$2,$3,$4,'payment',0,$5,0,$6)`,
      [customerId, paymentDate, invoiceId ? 'payment' : 'advance', receipt.id, payment.amount,
        invoiceId ? 'Invoice payment received' : 'Advance payment received']);
    const customer = await client.query('SELECT outstanding_balance FROM customers WHERE id=$1', [customerId]);
    receipt.outstanding_balance = customer.rows[0].outstanding_balance;
  }
  return receipt;
}

module.exports = { preparePayment, normalizePaymentIntent, postPayment };
