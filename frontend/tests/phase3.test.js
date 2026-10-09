import test from 'node:test';
import assert from 'node:assert/strict';
import { intentStorageKey, readIntent, newIntent, executeIntent, clearIntent } from '../src/utils/financialIntent.js';

assert.equal(globalThis.__ERP_LOCAL_NETWORK_GUARD__, true, 'Preload the local-only network guard before test startup');

const memory = () => {
  const values = new Map();
  return { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: key => values.delete(key) };
};

const operations = [
  { operation: 'purchase', payload: { supplier_id: 3, date: '2026-01-15', items: [{ product_id: 7, qty: '2.000', unit: 'piece', cost_price: '30.00' }] },
    receipt: { purchase: { id: 11, total_amount: '60.00' }, items: [], stockUpdates: [] } },
  { operation: 'purchase-return', payload: { purchase_id: 11, return_date: '2026-01-16', reason: 'Synthetic return', items: [{ purchase_item_id: 21, qty_returned: '1.000' }] },
    receipt: { id: 12, purchase_id: 11, total_amount: '30.00', status: 'posted', debit_note: { id: 13, amount: '30.00', status: 'outstanding' } } },
  { operation: 'sales-return', payload: { original_invoice_id: 14, return_date: '2026-01-16', reason: 'Synthetic sellable return', disposition: 'sellable', items: [{ invoice_item_id: 22, qty_returned: '1.000' }] },
    receipt: { credit_note_id: 15, original_invoice_id: 14, grand_total: '-100.00', applied_amount: '100.00', unapplied_amount: '0.00', amount_paid: '0.00', balance_due: '100.00' } },
  { operation: 'product-create', payload: { name: 'Synthetic opening product', unit: 'piece', current_stock: '5.000' },
    receipt: { id: 16, current_stock: '5.000' } },
  { operation: 'stock-adjustment', payload: { product_id: 16, counted_stock: '4.000', expected_stock: '5.000', expected_stock_version: '0', date: '2026-01-16', reason: 'Synthetic count' },
    receipt: { adjustment_id: 17, product_id: 16, current_stock: '4.000', stock_version: '1' } },
];

for (const example of operations) {
  test(`Phase3 ${example.operation} recognizes its committed successful receipt`, async () => {
    const storage = memory();
    const intent = newIntent(example.payload, null, 4);
    const result = await executeIntent(storage, 4, example.operation, intent, async (payload, key, actor) => {
      assert.deepEqual(payload, example.payload);
      assert.equal(key, intent.key);
      assert.equal(actor, 4);
      return { data: { success: true, data: example.receipt } };
    });
    assert.equal(result.status, 'completed', `${example.operation} response must not be mistaken for an invoice or payment`);
    assert.deepEqual(result.result, example.receipt);
    assert.equal(readIntent(storage, 4, example.operation).key, intent.key);
  });

  test(`Phase3 ${example.operation} recovers a lost response with the saved target, payload, actor and key`, async () => {
    const storage = memory();
    const intent = newIntent(example.payload, { target: example.payload.original_invoice_id ?? example.payload.purchase_id ?? example.payload.product_id }, 4);
    let calls = 0;
    const lost = await executeIntent(storage, 4, example.operation, intent, async () => { calls++; throw new Error('Committed response was lost'); });
    assert.equal(lost.status, 'uncertain');
    assert.throws(() => clearIntent(storage, 4, example.operation, lost));
    const recovered = readIntent(storage, 4, example.operation);
    assert.equal(calls, 1, 'Reloading recovery state must not dispatch a mutation');
    assert.deepEqual(recovered.payload, example.payload);
    assert.equal(recovered.actorId, 4);
    let sentAsOther = false;
    await assert.rejects(executeIntent(storage, 5, example.operation, recovered, async () => { sentAsOther = true; }));
    assert.equal(sentAsOther, false);
    assert.equal(readIntent(storage, 5, example.operation), null);
    const completed = await executeIntent(storage, 4, example.operation, recovered, async (payload, key, actor) => {
      calls++;
      assert.deepEqual(payload, example.payload);
      assert.equal(key, intent.key);
      assert.equal(actor, 4);
      return { data: { success: true, data: example.receipt } };
    });
    assert.equal(completed.status, 'completed');
    assert.equal(calls, 2);
    clearIntent(storage, 4, example.operation, completed);
    assert.equal(storage.getItem(intentStorageKey(4, example.operation)), null);
  });

  test(`Phase3 ${example.operation} keeps malformed successes and account-switch responses recoverable`, async () => {
    const storage = memory();
    const intent = newIntent(example.payload, null, 4);
    const malformed = await executeIntent(storage, 4, example.operation, intent, async () => ({ data: { success: true, data: {} } }));
    assert.equal(malformed.status, 'uncertain');
    const switched = await executeIntent(storage, 4, example.operation, malformed, async () => {
      throw { response: { status: 409, data: { code: 'OPERATION_ACTOR_MISMATCH' } } };
    });
    assert.equal(switched.status, 'uncertain');
    assert.equal(switched.actorId, 4);
    assert.equal(switched.key, intent.key);
    assert.deepEqual(switched.payload, example.payload);
    assert.throws(() => clearIntent(storage, 4, example.operation, switched));
    let replacementSent = false;
    await assert.rejects(executeIntent(storage, 4, example.operation, newIntent(example.payload, null, 4), async () => { replacementSent = true; }));
    assert.equal(replacementSent, false);
  });
}

const rejections = [
  ['purchase', 'PURCHASE_QUOTE_CHANGED', 409],
  ['purchase-return', 'PURCHASE_RETURN_QUOTE_CHANGED', 409],
  ['sales-return', 'RETURN_QUOTE_CHANGED', 409],
  ['purchase-return', 'PURCHASE_RETURN_QTY_EXCEEDS_ORIGINAL', 422],
  ['sales-return', 'RETURN_QTY_EXCEEDS_ORIGINAL', 422],
  ['sales-return', 'RETURN_RECONCILIATION_REQUIRED', 422],
  ['purchase-return', 'PURCHASE_RETURN_RECONCILIATION_REQUIRED', 422],
];

for (const [operation, code, status] of rejections) {
  test(`Phase3 ${code} permits review only before any uncertain dispatch`, async () => {
    const storage = memory();
    const example = operations.find(item => item.operation === operation);
    const intent = newIntent(example.payload, null, 4);
    const reject = async () => { throw { response: { status, data: { code } } }; };
    const rejected = await executeIntent(storage, 4, operation, intent, reject);
    assert.equal(rejected.status, 'rejected');
    assert.deepEqual(rejected.payload, example.payload, 'Rejected review must retain the submitted draft');
    assert.equal(rejected.key, intent.key);
    clearIntent(storage, 4, operation, rejected);
    const lost = await executeIntent(storage, 4, operation, intent, async () => { throw new Error('Lost response'); });
    const uncertain = await executeIntent(storage, 4, operation, lost, reject);
    assert.equal(uncertain.status, 'uncertain');
    assert.equal(uncertain.key, intent.key);
    assert.deepEqual(uncertain.payload, example.payload);
    assert.throws(() => clearIntent(storage, 4, operation, uncertain));
  });
}

test('Phase3 operation-specific receipt validation rejects a valid receipt for the wrong operation', async () => {
  const storage = memory();
  const original = newIntent(operations[0].payload, null, 4);
  const result = await executeIntent(storage, 4, 'purchase', original, async () => ({ data: { success: true, data: operations[1].receipt } }));
  assert.equal(result.status, 'uncertain');
  assert.equal(result.key, original.key);
});

for (const [operation, field] of [['sales-return', 'original_invoice_id'], ['purchase-return', 'purchase_id'], ['stock-adjustment', 'product_id']]) {
  test(`Phase3 ${operation} refuses a successful receipt for a different target`, async () => {
    const example = operations.find(item => item.operation === operation);
    const storage = memory();
    const intent = newIntent(example.payload, null, 4);
    const result = await executeIntent(storage, 4, operation, intent, async () => ({ data: { success: true, data: { ...example.receipt, [field]: 999 } } }));
    assert.equal(result.status, 'uncertain');
    assert.equal(result.key, intent.key);
    assert.deepEqual(result.payload, example.payload);
  });
}

test('Phase3 stock count receipt must confirm the requested counted stock', async () => {
  const example = operations.find(item => item.operation === 'stock-adjustment');
  const storage = memory();
  const intent = newIntent(example.payload, null, 4);
  const result = await executeIntent(storage, 4, example.operation, intent, async () => ({ data: { success: true, data: { ...example.receipt, current_stock: '99.000' } } }));
  assert.equal(result.status, 'uncertain');
});

test('Phase3 unknown operation cannot be completed by a valid payment-shaped response', async () => {
  const storage = memory();
  const intent = newIntent({ amount: '1.00' }, null, 4);
  const result = await executeIntent(storage, 4, 'unrecognized-mutation', intent, async () => ({ data: { success: true, data: { id: 5, amount: '1.00', outstanding_balance: '0.00' } } }));
  assert.equal(result.status, 'uncertain');
});
