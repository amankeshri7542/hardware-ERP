// Scaled integers are the financial policy; convert to strings only at boundaries.
function fail(code, status = 422) {
  const error = new Error(code);
  error.statusCode = status;
  error.errorCode = code;
  throw error;
}

function decimal(value, scale, _label, { min = 0n, max = 999999999999n } = {}) {
  if (!['string', 'number'].includes(typeof value) ||
      (typeof value === 'number' && !Number.isFinite(value))) fail('INVALID_DECIMAL');
  const text = String(value);
  if (!/^\d+(\.\d+)?$/.test(text) || text.length > 32) fail('INVALID_DECIMAL');
  const [whole, fraction = ''] = text.split('.');
  if (fraction.length > scale) fail('DECIMAL_PRECISION');
  const result = BigInt(whole) * 10n ** BigInt(scale) +
    BigInt(fraction.padEnd(scale, '0') || '0');
  if (result < min || result > max) fail('DECIMAL_RANGE');
  return result;
}

function format(value, scale = 2) {
  const sign = value < 0n ? '-' : '';
  const digits = (value < 0n ? -value : value).toString().padStart(scale + 1, '0');
  return scale ? sign + digits.slice(0, -scale) + '.' + digits.slice(-scale) : sign + digits;
}

function round(numerator, denominator) {
  if (denominator <= 0n) throw new Error('Invalid rounding denominator');
  const sign = numerator < 0n ? -1n : 1n;
  const absolute = numerator < 0n ? -numerator : numerator;
  return sign * ((absolute + denominator / 2n) / denominator);
}

function positiveId(value, _label) {
  const id = decimal(value, 0, 'id', { min: 1n, max: 2147483647n });
  return Number(id);
}

function date(value, _label) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
      value < '1900-01-01' || value > '9999-12-31') fail('INVALID_DATE');
  const parsed = new Date(value + 'T00:00:00.000Z');
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) fail('INVALID_DATE');
  return value;
}

module.exports = { decimal, format, round, fail, positiveId, date };
