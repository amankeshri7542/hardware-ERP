// Draft previews use exact decimal arithmetic. Only the server quote can authorize a sale.
export function scaled(value, precision = 2) {
  const raw = String(value ?? '');
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error('Enter a plain nonnegative decimal');
  const [whole, fraction = ''] = raw.split('.');
  if (fraction.length > precision) throw new Error(`Use at most ${precision} decimal places`);
  return BigInt(whole) * (10n ** BigInt(precision)) + BigInt(fraction.padEnd(precision, '0') || '0');
}
export function formatted(value, precision = 2) {
  const negative = value < 0n;
  const raw = (negative ? -value : value).toString().padStart(precision + 1, '0');
  return `${negative ? '-' : ''}${raw.slice(0, -precision)}.${raw.slice(-precision)}`;
}
export const decimal = (value, precision = 2) => formatted(scaled(value, precision), precision);
export const moneySum = values => formatted(values.reduce((sum, value) => sum + scaled(value), 0n));
export const quantityIncrement = value => formatted(scaled(value,3)+1000n,3);
export const moneyDifference = (a, b) => formatted(scaled(a) - scaled(b));
const rounded = (value, divisor) => (value + divisor / 2n) / divisor;

export function calculateLineItem(item) {
  const qty = scaled(item.qty ?? '0', 3);
  if(qty <= 0n) throw new Error('Quantity must be positive');
  const rate = scaled(item.rate ?? '0');
  const conversion = scaled(item._conversionValue ?? '1', 4);
  const base = qty * conversion;
  if (base % 10000n) throw new Error('Selected quantity cannot be represented in stock units');
  const percentage = scaled(item.discount_pct ?? '0');
  if (percentage > 10000n) throw new Error('Discount must be at most 100%');
  const percentMode = item.discount_kind === 'pct' || (item.discount_kind !== 'amount' && percentage > 0n);
  const discount = percentMode ? rounded(rate * percentage, 10000n) : scaled(item.discount_amount ?? '0');
  if (discount > rate) throw new Error('Discount cannot exceed the rate');
  const gross = rounded(rate * qty, 1000n);
  const taxable = rounded((rate - discount) * qty, 1000n);
  const gst = rounded(taxable * scaled(item.gst_pct ?? '0'), 10000n);
  return { ...item, base_qty: formatted(base / 10000n, 3), discount_amount: formatted(discount),
    gross_amount: formatted(gross), line_discount: formatted(gross - taxable),
    taxable_amount: formatted(taxable), gst_amount: formatted(gst), line_total: formatted(taxable + gst) };
}
export function calculateInvoiceTotals(items = []) {
  return { subtotal: moneySum(items.map(i => i.gross_amount || '0')),
    discount_total: moneySum(items.map(i => i.line_discount || '0')),
    taxable_total: moneySum(items.map(i => i.taxable_amount || '0')),
    gst_total: moneySum(items.map(i => i.gst_amount || '0')),
    grand_total: moneySum(items.map(i => i.line_total || '0')) };
}
export function getPaymentStatus(total, paid) {
  return scaled(paid) >= scaled(total) ? 'paid' : scaled(paid) > 0n ? 'partial' : 'unpaid';
}
export function buildGstBreakdown(items = []) {
  const groups = new Map();
  for (const item of items) {
    const pct = decimal(item.gst_pct || '0');
    const row = groups.get(pct) || { taxable: 0n, tax: 0n };
    row.taxable += scaled(item.taxable_amount || '0'); row.tax += scaled(item.gst_amount || '0'); groups.set(pct,row);
  }
  return [...groups].sort(([a],[b]) => Number(a)-Number(b)).map(([gst_pct, row]) => ({gst_pct,
    taxable_amount:formatted(row.taxable), cgst:formatted(rounded(row.tax,2n)), sgst:formatted(row.tax-rounded(row.tax,2n)), igst:'0.00', total_tax:formatted(row.tax)}));
}
