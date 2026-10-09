const { decimal, format, positiveId, date, fail } = require('../../utils/financial');
const { normalizePaymentIntent } = require('../payments/paymentPosting');

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('UNSUPPORTED_SETTLEMENT_FIELD');
}
function normalize(input) {
  fields(input, ['kind', 'customer_id', 'source_type', 'source_id', 'date', 'reason', 'operator_confirmed',
    'amount', 'targets', 'mode', 'modes_detail', 'reference_no', 'quote_hash']);
  const kinds = { customer_allocation: ['advance', 'return_credit'], customer_refund: ['advance', 'return_credit'],
    anonymous_refund: ['anonymous_liability'], reversal: ['event'], payment_reversal: ['payment'] };
  if (!kinds[input.kind]?.includes(input.source_type)) fail('UNSUPPORTED_CUSTOMER_SETTLEMENT');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) fail('SETTLEMENT_REASON_REQUIRED');
  const result = { kind: input.kind, customer_id: input.customer_id == null ? null : positiveId(input.customer_id),
    source_type: input.source_type, source_id: positiveId(input.source_id), date: date(input.date), reason: input.reason.trim(),
    operator_confirmed: input.operator_confirmed === true };
  if (input.kind !== 'anonymous_refund' && result.customer_id === null && input.kind !== 'reversal' && input.kind !== 'payment_reversal') fail('CUSTOMER_REQUIRED');
  if (input.kind === 'anonymous_refund' && result.customer_id !== null) fail('CUSTOMER_SOURCE_MISMATCH');
  if (!result.operator_confirmed) fail('OPERATOR_CONFIRMATION_REQUIRED');
  if (input.reference_no != null && (typeof input.reference_no !== 'string' || input.reference_no.length > 100)) fail('INVALID_SETTLEMENT_REFERENCE');
  result.reference_no = input.reference_no || null;
  if (input.kind === 'customer_allocation') {
    if (!Array.isArray(input.targets) || input.targets.length < 1 || input.targets.length > 100) fail('INVALID_SETTLEMENT_TARGETS');
    const seen = new Set();
    result.targets = input.targets.map(target => {
      fields(target, ['invoice_id', 'amount']);
      const invoice_id = positiveId(target.invoice_id);
      if (seen.has(invoice_id)) fail('DUPLICATE_SETTLEMENT_TARGET');
      seen.add(invoice_id);
      return { invoice_id, amount: format(decimal(target.amount, 2, 'allocation', { min: 1n })) };
    }).sort((a, b) => a.invoice_id - b.invoice_id);
    result.amount = format(result.targets.reduce((sum, target) => sum + decimal(target.amount, 2), 0n));
    decimal(result.amount, 2, 'allocation total', { min: 1n });
    if (input.amount !== undefined && decimal(input.amount, 2) !== decimal(result.amount, 2)) fail('SETTLEMENT_AMOUNT_MISMATCH');
    if (input.mode !== undefined || input.modes_detail !== undefined) fail('NONCASH_SETTLEMENT_TENDERS');
  } else {
    if (input.targets !== undefined) fail('UNSUPPORTED_SETTLEMENT_TARGETS');
    if (input.kind.endsWith('_refund')) {
      const payment = normalizePaymentIntent({ customer_id: result.customer_id || 1, invoice_id: null,
        amount: input.amount, mode: input.mode, modes_detail: input.modes_detail, payment_date: result.date, reference_no: result.reference_no }).payment;
      result.amount = payment.amount; result.tenders = payment.modes;
    } else {
      if (input.amount !== undefined) result.amount = format(decimal(input.amount, 2, 'reversal', { min: 1n }));
      if (input.mode !== undefined || input.modes_detail !== undefined) fail('REVERSAL_USES_ORIGINAL_TENDERS');
    }
  }
  if (input.quote_hash !== undefined) {
    if (typeof input.quote_hash !== 'string' || !/^[a-f0-9]{64}$/.test(input.quote_hash)) fail('INVALID_QUOTE');
    result.quote_hash = input.quote_hash;
  }
  return result;
}

module.exports = { normalize };
