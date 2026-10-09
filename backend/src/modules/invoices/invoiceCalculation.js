const { decimal, format, round, fail, positiveId, date } = require('../../utils/financial');
const MAX = 999999999999n;
const legacyLine = ['product_name_snapshot', 'hsn_snapshot', 'base_qty', 'cost_price_snapshot',
  'gst_pct', 'taxable_amount', 'gst_amount', 'line_total', 'line_profit'];
const legacyTotals = ['subtotal', 'discount_total', 'taxable_total', 'gst_total',
  'grand_total', 'total_cost', 'profit_amount', 'profit_pct', 'balance_due', 'amount_paid'];

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      Object.keys(value).some(key => !allowed.includes(key))) fail('UNSUPPORTED_INPUT');
}
function text(value, max, optional = false) {
  if (optional && (value === undefined || value === null)) return null;
  if (typeof value !== 'string' || value.length > max || (!optional && !value.length)) fail('INVALID_TEXT');
  return value;
}

function normalizeInvoice(data) {
  fields(data, ['customer_id', 'customer_name_walkin', 'bill_type', 'date', 'items',
    'payment', 'notes', 'quote_hash', ...legacyTotals]);
  if (!['retail', 'wholesale', 'quickbill'].includes(data.bill_type)) fail('INVALID_BILL_TYPE');
  const customerId = data.customer_id == null ? null : positiveId(data.customer_id);
  if (!customerId && data.bill_type !== 'quickbill') fail('CUSTOMER_REQUIRED');
  const walkin = text(data.customer_name_walkin, 100, true);
  if (customerId && walkin) fail('CUSTOMER_IDENTITY_CONFLICT');
  if (!Array.isArray(data.items) || data.items.length < 1 || data.items.length > 500) fail('INVALID_ITEMS');
  const items = data.items.map(item => {
    fields(item, ['product_id', 'qty', 'unit', 'rate', 'discount_amount', 'discount_pct', ...legacyLine]);
    if (item.discount_amount !== undefined && item.discount_pct !== undefined) fail('DISCOUNT_CONFLICT');
    const rate = decimal(item.rate, 2);
    const discount = item.discount_pct !== undefined
      ? { discount_pct: format(decimal(item.discount_pct, 2, 'discount', { max: 10000n })) }
      : { discount_amount: format(decimal(item.discount_amount ?? 0, 2)) };
    if (discount.discount_amount && decimal(discount.discount_amount, 2) > rate) fail('EXCESSIVE_DISCOUNT');
    return { product_id: positiveId(item.product_id), qty: format(decimal(item.qty, 3, 'qty', { min: 1n }), 3),
      unit: text(item.unit, 20), rate: format(rate), ...discount };
  });
  fields(data.payment, ['amount_paid', 'modes', 'due_date']);
  const { preparePayment } = require('../payments/paymentPosting');
  const payment = preparePayment({ amount: data.payment.amount_paid, modes: data.payment.modes });
  const dueDate = data.payment.due_date == null ? null : date(data.payment.due_date);
  if (data.quote_hash !== undefined && (typeof data.quote_hash !== 'string' || !/^[a-f0-9]{64}$/.test(data.quote_hash))) fail('INVALID_QUOTE');
  return { customer_id: customerId, customer_name_walkin: walkin, bill_type: data.bill_type,
    date: date(data.date), items, payment: { amount_paid: payment.amount, modes: payment.modes, due_date: dueDate },
    notes: text(data.notes, 500, true), ...(data.quote_hash ? { quote_hash: data.quote_hash } : {}) };
}

function baseQuantity(item, product, conversions) {
  const quantity = decimal(item.qty, 3, 'qty', { min: 1n });
  const baseUnit = product.base_unit || product.unit;
  if (item.unit === baseUnit) return format(quantity, 3);
  const conversion = conversions.find(row => row.product_id === product.id && row.unit_name === item.unit && row.is_sales_unit);
  if (!conversion) fail('INVALID_SALES_UNIT');
  const factor = decimal(conversion.conversion_value, 4, 'conversion', { min: 1n });
  const numerator = quantity * factor;
  if (numerator % 10000n !== 0n) fail('UNREPRESENTABLE_QUANTITY');
  const base = numerator / 10000n;
  if (base < 1n || base > MAX) fail('DECIMAL_RANGE');
  return format(base, 3);
}

function calculateInvoiceTotals(items) {
  let subtotal = 0n, taxableTotal = 0n, gstTotal = 0n, totalCost = 0n;
  const computed = items.map(item => {
    const qty = decimal(item.qty, 3, 'qty', { min: 1n });
    const base = decimal(item.base_qty ?? item.qty, 3, 'base quantity', { min: 1n });
    const rate = decimal(item.rate, 2);
    const pct = decimal(item.discount_pct ?? 0, 2, 'discount', { max: 10000n });
    const discount = item.discount_amount !== undefined ? decimal(item.discount_amount, 2) : round(rate * pct, 10000n);
    if (discount > rate) fail('EXCESSIVE_DISCOUNT');
    const tax = decimal(item.gst_pct, 2, 'tax', { max: 2800n });
    const gross = round(rate * qty, 1000n);
    const taxable = round((rate - discount) * qty, 1000n);
    const gst = round(taxable * tax, 10000n);
    const cost = round(decimal(item.cost_price_snapshot, 2) * base, 1000n);
    if ([gross, taxable + gst, cost].some(value => value > MAX)) fail('DECIMAL_RANGE');
    subtotal += gross; taxableTotal += taxable; gstTotal += gst; totalCost += cost;
    return { ...item, discount_pct: format(pct), discount_amount: format(discount),
      taxable_amount: format(taxable), gst_amount: format(gst), line_total: format(taxable + gst),
      line_profit: format(taxable - cost) };
  });
  const grand = taxableTotal + gstTotal;
  if ([subtotal, grand, totalCost].some(value => value > MAX)) fail('DECIMAL_RANGE');
  const profit = taxableTotal - totalCost;
  return { items: computed, subtotal: format(subtotal), discount_total: format(subtotal - taxableTotal),
    taxable_total: format(taxableTotal), gst_total: format(gstTotal), grand_total: format(grand),
    total_cost: format(totalCost), profit_amount: format(profit),
    profit_pct: format(taxableTotal ? round(profit * 10000n, taxableTotal) : 0n) };
}

module.exports = { normalizeInvoice, baseQuantity, calculateInvoiceTotals };
