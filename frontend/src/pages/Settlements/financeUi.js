export const settlementLabels = {
  customer_allocation: 'Allocate customer funds', customer_refund: 'Record customer refund',
  anonymous_refund: 'Record walk-in refund', payment_reversal: 'Reverse customer receipt',
  payable_recognition: 'Recognize supplier payable', supplier_payment: 'Record supplier payment',
  supplier_debit_application: 'Apply supplier debit', supplier_refund: 'Record supplier refund',
  reversal: 'Reverse settlement', payable_reversal: 'Reverse supplier payable',
};
export const moneyModes = ['cash', 'upi', 'bank', 'cheque'];
export const modeOptions = [...moneyModes, 'mixed'].map(value => ({ value, label: value === 'mixed' ? 'Split across modes' : value.toUpperCase() }));
export const positive = value => /^\d+\.\d{2}$/.test(String(value)) && BigInt(String(value).replace('.', '')) > 0n;
export const businessDate = () => {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
};
export const apiError = error => error.response?.data?.error || error.message || 'Unable to load the requested financial records.';
export const sourceLabel = value => ({ advance: 'Advance receipt', return_credit: 'Return credit', anonymous_liability: 'Walk-in return liability', payable: 'Supplier payable', debit: 'Supplier debit note', payment: 'Customer receipt', event: 'Settlement', purchase: 'Stock receipt' }[value] || value);
