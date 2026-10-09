import test from 'node:test';
import assert from 'node:assert/strict';
import { newIntent, executeIntent, readIntent, clearIntent } from '../src/utils/financialIntent.js';

assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true);
const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};
const date = '2026-01-20';
const customer = [
  ['customer_allocation', 'advance', { targets: [{ invoice_id: 21, amount: '10.00' }] }],
  ['customer_refund', 'return_credit', { amount: '10.00', mode: 'cash' }],
  ['anonymous_refund', 'anonymous_liability', { amount: '10.00', mode: 'cash' }],
  ['payment_reversal', 'payment', {}],
  ['reversal', 'event', {}],
].map(([kind, source_type, extra]) => ({ operation: 'customer-settlement',
  payload: { kind, source_type, source_id: 11, ...(kind === 'anonymous_refund' ? {} : { customer_id: 4 }), date, reason: 'Synthetic evidence', operator_confirmed: true, ...extra },
  receipt: { record: { id: 31, kind, source_type, source_id: 11, customer_id: kind === 'anonymous_refund' ? null : 4, amount: '10.00', date },
    ...(kind === 'customer_allocation' ? { targets: [{ invoice_id: 21, amount: '10.00', balance_due: '20.00', amount_paid: '0.00' }] } : {}) },
}));
const supplier = [
  ['payable_recognition', 'purchase', { purchase_id: 12, amount: '10.00', due_date: '2026-01-30', document_reference: 'Synthetic bill' }],
  ['supplier_payment', 'payable', { amount: '10.00', mode: 'cash' }],
  ['supplier_debit_application', 'debit', { amount: '10.00', targets: [{ payable_id: 22, amount: '10.00' }] }],
  ['supplier_refund', 'debit', { amount: '10.00', mode: 'cash' }],
  ['reversal', 'event', {}],
  ['payable_reversal', 'payable', {}],
].map(([kind, source_type, extra]) => ({ operation: 'supplier-settlement',
  payload: { kind, supplier_id: 5, ...(kind === 'payable_recognition' ? {} : { source_type, source_id: 12 }), date, reason: 'Synthetic evidence', operator_confirmed: true, ...extra },
  receipt: { record: { id: 32, kind, source_type, source_id: 12, supplier_id: 5, amount: '10.00', date },
    ...(kind === 'supplier_debit_application' ? { targets: [{ payable_id: 22, amount: '10.00', balance_due: '20.00' }] } : {}) },
}));
const days = [
  { operation: 'day-open', payload: { date, opening_float: '100.00' }, receipt: { record: { id: 33, kind: 'day_open', date, opening_float: '100.00' } } },
  { operation: 'day-close', payload: { date, counted_cash: '105.00', reason: 'Synthetic count', operator_confirmed: true }, receipt: { record: { id: 34, kind: 'day_close', date, counted_cash: '105.00', expected_cash: '110.00', discrepancy: '-5.00' } } },
];
const examples = [...customer, ...supplier, ...days];
for (const example of examples) {
  test(`Phase4 ${example.operation}/${example.payload.kind || example.receipt.record.kind} accepts only its committed receipt`, async () => {
    const storage = memory();
    const result = await executeIntent(storage, 7, example.operation, newIntent(example.payload, null, 7), async () => ({ data: { success: true, data: example.receipt } }));
    assert.equal(result.status, 'completed');
    assert.deepEqual(result.result, example.receipt);
  });
  test(`Phase4 ${example.operation}/${example.payload.kind || example.receipt.record.kind} keeps its original command through loss, reload and account change`, async () => {
    const storage = memory();
    const original = newIntent(example.payload, { label: 'Synthetic saved target' }, 7);
    const uncertain = await executeIntent(storage, 7, example.operation, original, async () => { throw new Error('Committed response lost'); });
    assert.equal(uncertain.status, 'uncertain');
    assert.throws(() => clearIntent(storage, 7, example.operation, uncertain));
    const recovered = readIntent(storage, 7, example.operation);
    let dispatches = 0;
    await assert.rejects(executeIntent(storage, 8, example.operation, recovered, async () => { dispatches++; }));
    assert.equal(dispatches, 0);
    const completed = await executeIntent(storage, 7, example.operation, recovered, async (payload, key, actor) => {
      dispatches++; assert.deepEqual(payload, example.payload); assert.equal(key, original.key); assert.equal(actor, 7);
      return { data: { success: true, data: example.receipt } };
    });
    assert.equal(completed.status, 'completed'); assert.equal(dispatches, 1);
  });
}
for (const field of ['kind', 'source_type', 'source_id', 'customer_id', 'date', 'amount']) {
  test(`Phase4 changed ${field} in a refund receipt remains uncertain`, async () => {
    const example = customer[1]; const storage = memory();
    const receipt = structuredClone(example.receipt);
    receipt.record[field] = ({ kind: 'customer_allocation', source_type: 'advance', source_id: 900, customer_id: 900, date: '2026-01-21', amount: '9.99' })[field];
    const result = await executeIntent(storage, 7, example.operation, newIntent(example.payload, null, 7), async () => ({ data: { success: true, data: receipt } }));
    assert.equal(result.status, 'uncertain');
  });
}
test('Phase4 allocation receipt must cover every reviewed target exactly once', async () => {
  const example = customer[0];
  for (const targets of [[], [{ invoice_id: 22 }], [{ invoice_id: 21 }, { invoice_id: 21 }]]) {
    const result = await executeIntent(memory(), 7, example.operation, newIntent(example.payload, null, 7), async () => ({ data: { success: true, data: { ...example.receipt, targets } } }));
    assert.equal(result.status, 'uncertain');
  }
});
test('Phase4 day close receipt cannot settle a different date or counted amount', async () => {
  const example = days[1];
  for (const patch of [{ date: '2026-01-21' }, { counted_cash: '105.01' }, { kind: 'day_open' }]) {
    const result = await executeIntent(memory(), 7, example.operation, newIntent(example.payload, null, 7), async () => ({ data: { success: true, data: { record: { ...example.receipt.record, ...patch } } } }));
    assert.equal(result.status, 'uncertain');
  }
});
for (const code of ['SOURCE_HAS_DEPENDENCIES', 'SOURCE_INSUFFICIENT', 'SETTLEMENT_QUOTE_CHANGED', 'BACKDATED_SETTLEMENT_UNSUPPORTED', 'CUSTOMER_SOURCE_MISMATCH', 'PAYABLE_AMOUNT_EXCEEDED', 'DEBIT_AMOUNT_EXCEEDED', 'ALLOCATION_EXCEEDS_BALANCE', 'PAYABLE_REVERSED', 'SETTLEMENT_ALREADY_REVERSED', 'REVERSAL_TENDER_MISMATCH']) {
  test(`Phase4 ${code} permits review only before uncertainty`, async () => {
    const example = customer[1]; const storage = memory(); const intent = newIntent(example.payload, null, 7);
    const reject = async () => { throw { response: { status: 409, data: { code } } }; };
    const rejected = await executeIntent(storage, 7, example.operation, intent, reject);
    assert.equal(rejected.status, 'rejected');
    clearIntent(storage, 7, example.operation, rejected);
    const lost = await executeIntent(storage, 7, example.operation, newIntent(example.payload, null, 7), async () => { throw new Error('Lost response'); });
    assert.equal((await executeIntent(storage, 7, example.operation, lost, reject)).status, 'uncertain');
  });
}

test('Phase4 allocation receipt amount must match its confirmed target amounts', async () => {
  const example = customer[0];
  for (const receipt of [
    { ...example.receipt, record: { ...example.receipt.record, amount: '9.99' } },
    { ...example.receipt, targets: [{ invoice_id: 21, amount: '9.99' }] },
  ]) {
    const result = await executeIntent(memory(), 7, example.operation, newIntent(example.payload, null, 7), async () => ({ data: { success: true, data: receipt } }));
    assert.equal(result.status, 'uncertain');
  }
});
test('Phase4 customer advances require the original customer, date, amount and no invoice', async () => {
  const payload = { customer_id: 4, invoice_id: null, amount: '50.00', payment_date: date, mode: 'cash' };
  const receipt = { id: 41, ...payload, outstanding_balance: '-50.00' };
  const response = value => async () => ({ data: { success: true, data: value } });
  assert.equal((await executeIntent(memory(), 7, 'customer-advance', newIntent(payload, null, 7), response(receipt))).status, 'completed');
  for (const patch of [{ customer_id: 5 }, { invoice_id: 20 }, { amount: '49.99' }, { payment_date: '2026-01-21' }, { mode: 'bank' }]) {
    assert.equal((await executeIntent(memory(), 7, 'customer-advance', newIntent(payload, null, 7), response({ ...receipt, ...patch }))).status, 'uncertain');
  }
});
test('Phase4 anonymous refund reversal never creates a customer account', async () => {
  const payload = { kind: 'reversal', source_type: 'event', source_id: 31, date, reason: 'Correct the recorded refund', operator_confirmed: true };
  const record = { id: 51, ...payload, customer_id: null, amount: '10.00' };
  const send = value => async () => ({ data: { success: true, data: { record: value } } });
  assert.equal((await executeIntent(memory(), 7, 'customer-settlement', newIntent(payload, null, 7), send(record))).status, 'completed');
  assert.equal((await executeIntent(memory(), 7, 'customer-settlement', newIntent(payload, null, 7), send({ ...record, customer_id: 4 }))).status, 'uncertain');
});
