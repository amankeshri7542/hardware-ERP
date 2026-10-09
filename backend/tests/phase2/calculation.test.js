const { test } = require('node:test');
const assert = require('node:assert/strict');
const fixtures = require('../../../shared/billing-fixtures.json');
const { calculateInvoiceTotals } = require('../../src/modules/invoices/invoices.service');
const { decimal, round, date } = require('../../src/utils/financial');

for (const fixture of fixtures) {
  test('calculation: ' + fixture.name, () => {
    const result = calculateInvoiceTotals(fixture.items);
    for (const [field, expected] of Object.entries(fixture.expected)) {
      assert.equal(Number(result[field]), Number(expected), field);
    }
  });
}

test('decimal boundary rejects coercion, excess precision, exponent and overflow', () => {
  for (const value of [null, true, '', ' 1', '1e2', Infinity, NaN, '0.001', '-1', '10000000000']) {
    assert.throws(() => decimal(value, 2));
  }
  assert.equal(decimal('001.20', 2), 120n);
  assert.equal(decimal(1.2, 2), 120n);
  assert.equal(round(5n, 10n), 1n);
  assert.equal(round(-5n, 10n), -1n);
  assert.throws(() => date('2026-02-30'));
});
