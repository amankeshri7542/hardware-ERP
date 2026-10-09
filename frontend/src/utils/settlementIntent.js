import { decimal } from './billing.calculations.js';

const kinds = {
  'customer-settlement': new Set(['customer_allocation', 'customer_refund', 'anonymous_refund', 'payment_reversal', 'reversal']),
  'supplier-settlement': new Set(['payable_recognition', 'supplier_payment', 'supplier_debit_application', 'supplier_refund', 'reversal', 'payable_reversal']),
};
const id = value => /^[1-9]\d*$/.test(String(value));
const money = value => typeof value === 'string' && /^-?\d+\.\d{2}$/.test(value);
const same = (left, right) => String(left) === String(right);
const sameMoney = (left, right) => money(left) && left === decimal(right, 2);
export const settlementRejectionCodes = new Set([
  'REVERSAL_TENDER_MISMATCH',
  'ALLOCATION_EXCEEDS_BALANCE', 'ALREADY_REVERSED', 'CONTRADICTORY_PAYMENT_MODES', 'CUSTOMER_NOT_FOUND', 'CUSTOMER_REQUIRED', 'DEBIT_AMOUNT_EXCEEDED', 'DEBIT_NOT_FOUND', 'DUPLICATE_SETTLEMENT_TARGET', 'FULL_REVERSAL_REQUIRED', 'INVALID_DUE_DATE', 'INVALID_PAYMENT_MODES', 'INVALID_QUOTE', 'INVALID_SETTLEMENT_REFERENCE', 'INVALID_SETTLEMENT_TARGETS', 'INVALID_SETTLEMENT_TEXT', 'INVALID_SUPPLIER_SOURCE', 'INVALID_SUPPLIER_TARGETS', 'INVOICE_CUSTOMER_MISMATCH', 'INVOICE_NOT_FOUND', 'INVOICE_NOT_PAYABLE', 'NONCASH_SETTLEMENT_TENDERS', 'PAYABLE_ALREADY_RECOGNIZED', 'PAYABLE_AMOUNT_EXCEEDED', 'PAYABLE_AMOUNT_MISMATCH', 'PAYABLE_HAS_SETTLEMENTS', 'PAYABLE_NOT_FOUND', 'PAYABLE_REVERSED', 'PURCHASE_NOT_FOUND', 'REVERSAL_DATE_REQUIRED', 'REVERSAL_USES_ORIGINAL_TENDERS', 'SETTLEMENT_ALREADY_REVERSED', 'SETTLEMENT_AMOUNT_MISMATCH', 'SETTLEMENT_NOT_FOUND', 'SETTLEMENT_REASON_REQUIRED', 'SETTLEMENT_SOURCE_NOT_FOUND', 'SETTLEMENT_TARGET_MISMATCH', 'SOURCE_RECONCILIATION_REQUIRED', 'SUPPLIER_MISMATCH', 'SUPPLIER_NOT_FOUND', 'SUPPLIER_RECONCILIATION_REQUIRED', 'SUPPLIER_UNAVAILABLE', 'UNEXPECTED_CASH_MOVEMENT', 'UNSUPPORTED_CUSTOMER_SETTLEMENT', 'UNSUPPORTED_CUSTOMER_SOURCE', 'UNSUPPORTED_REVERSAL', 'UNSUPPORTED_SETTLEMENT_FIELD', 'UNSUPPORTED_SETTLEMENT_REVERSAL', 'UNSUPPORTED_SETTLEMENT_TARGETS', 'UNSUPPORTED_SUPPLIER_COMMAND',
  'SOURCE_HAS_DEPENDENCIES', 'SOURCE_INSUFFICIENT', 'SETTLEMENT_QUOTE_CHANGED',
  'BACKDATED_SETTLEMENT_UNSUPPORTED', 'CUSTOMER_SOURCE_MISMATCH',
  'UNSUPPORTED_DAY_FIELD', 'DAY_REASON_REQUIRED', 'OPERATOR_CONFIRMATION_REQUIRED', 'FUTURE_FINANCIAL_DATE',
  'DAY_ALREADY_OPEN', 'DAY_OPEN_SEQUENCE_REQUIRED', 'DAY_OPENING_REQUIRED', 'DAY_QUOTE_CHANGED',
  'FINANCIAL_PERIOD_CLOSED', 'CASH_RECONCILIATION_REQUIRED',
]);
export const settlementError = code => ({
  SOURCE_HAS_DEPENDENCIES: 'This source has later settlements. Reverse those explicitly before reversing the original.',
  SOURCE_INSUFFICIENT: 'The source no longer has enough available value. Reload the account and review a fresh quote.',
  SETTLEMENT_QUOTE_CHANGED: 'The source or target changed after review. Reload and review the updated settlement.',
  BACKDATED_SETTLEMENT_UNSUPPORTED: 'Choose a business date on or after the related source and settlement records.',
  CUSTOMER_SOURCE_MISMATCH: 'This source belongs to another customer. Return to the original account.',
  FINANCIAL_PERIOD_CLOSED: 'This business date is closed. Review the saved operation, then use a later open date for a new entry.',
  DAY_QUOTE_CHANGED: 'Money movements changed after review. Review the new expected closing amount before confirming.',
  DAY_ALREADY_OPEN: 'An opening has already been recorded for this date. Reload the day.',
  DAY_OPEN_SEQUENCE_REQUIRED: 'Close the current open day, then open the next calendar day in sequence.',
  DAY_OPENING_REQUIRED: 'Record an explicit opening float before closing this day.',
  FUTURE_FINANCIAL_DATE: 'The business date cannot be in the future.',
  CASH_RECONCILIATION_REQUIRED: 'Money evidence needs reconciliation before the day can be closed.',
  OPERATOR_CONFIRMATION_REQUIRED: 'Confirm the actual recorded event before continuing.',
}[code]);

export function validSettlementReceipt(operation, receipt, payload) {
  try {
    if (operation === 'customer-advance') return id(receipt?.id) && same(receipt.customer_id, payload.customer_id)
      && receipt.invoice_id === null && receipt.payment_date === payload.payment_date && sameMoney(receipt.amount, payload.amount)
      && receipt.mode === payload.mode && money(receipt.outstanding_balance);
    const record = receipt?.record;
    if (!record || !id(record.id) || record.date !== payload.date) return false;
    if (operation === 'day-open') return record.kind === 'day_open' && sameMoney(record.opening_float, payload.opening_float);
    if (operation === 'day-close') return record.kind === 'day_close' && sameMoney(record.counted_cash, payload.counted_cash)
      && money(record.expected_cash) && money(record.discrepancy);
    if (!kinds[operation]?.has(payload.kind) || record.kind !== payload.kind || !money(record.amount) || BigInt(record.amount.replace('.', '')) <= 0n) return false;
    const sourceType = payload.kind === 'payable_recognition' ? 'purchase' : payload.source_type;
    const sourceId = payload.kind === 'payable_recognition' ? payload.purchase_id : payload.source_id;
    if (record.source_type !== sourceType || !id(record.source_id) || !same(record.source_id, sourceId)) return false;
    const partyField = operation === 'customer-settlement' ? 'customer_id' : 'supplier_id';
    if (payload.kind === 'anonymous_refund' || (operation === 'customer-settlement' && payload.kind === 'reversal' && payload.customer_id == null)) {
      if (record.customer_id != null) return false;
    } else if (!id(record[partyField]) || !same(record[partyField], payload[partyField])) return false;
    if (payload.amount !== undefined && !sameMoney(record.amount, payload.amount)) return false;
    if (payload.targets) {
      const targetField = operation === 'customer-settlement' ? 'invoice_id' : 'payable_id';
      if (!Array.isArray(receipt.targets) || receipt.targets.length !== payload.targets.length) return false;
      const expected = new Set(payload.targets.map(target => String(target[targetField])));
      const actual = new Set(receipt.targets.map(target => String(target[targetField])));
      if (actual.size !== expected.size || actual.size !== receipt.targets.length || [...actual].some(value => !expected.has(value))) return false;
      for (const target of payload.targets) {
        const confirmed = receipt.targets.find(value => same(value[targetField], target[targetField]));
        if (!sameMoney(confirmed.amount, target.amount)) return false;
      }
      const applied = receipt.targets.reduce((total, target) => total + BigInt(target.amount.replace('.', '')), 0n);
      if (applied !== BigInt(record.amount.replace('.', ''))) return false;
    }
    return true;
  } catch { return false; }
}
