// Persist before dispatch. Reading or authentication changes never dispatch a mutation.
export const intentStorageKey = (userId, operation) => `hardware-erp-intent-v1:${userId}:${operation}`;
const originalActor = (intent,userId) => {
  if(!/^[1-9]\d*$/.test(String(userId)) || (intent.actorId != null && String(intent.actorId)!==String(userId))) {
    throw new Error('This saved transaction belongs to another account. Sign in as its original account to recover it.');
  }
  return Number(userId);
};
export function readIntent(storage, userId, operation) {
  const raw = storage.getItem(intentStorageKey(userId, operation));
  if (!raw) return null;
  const value = JSON.parse(raw);
  if (value.version !== 1 || !value.key || !value.payload || !['pending','uncertain','rejected','completed'].includes(value.status)) {
    throw new Error('Saved transaction recovery data cannot be read. Do not repeat this transaction.');
  }
  const recovered = {...value,actorId:originalActor(value,userId)};
  return recovered.status === 'pending' ? { ...recovered, status:'uncertain' } : recovered;
}
function persist(storage, userId, operation, intent) {
  if (!userId) throw new Error('Sign in before submitting a financial transaction');
  const key = intentStorageKey(userId, operation);
  const raw = JSON.stringify(intent);
  storage.setItem(key, raw);
  if (storage.getItem(key) !== raw) throw new Error('Transaction recovery storage is unavailable');
}
export function newIntent(payload, snapshot = null, actorId) {
  return { version:1, actorId, key:globalThis.crypto.randomUUID(), payload:JSON.parse(JSON.stringify(payload)), snapshot,
    status:'pending', createdAt:new Date().toISOString() };
}
const rejectedCodes = new Set(['VALIDATION_ERROR','QUOTE_CHANGED','INVALID_IDEMPOTENCY_KEY','PRODUCT_UNAVAILABLE','CUSTOMER_UNAVAILABLE','CUSTOMER_NOT_FOUND','CUSTOMER_REQUIRED','INVALID_CUSTOMER','INVALID_INVOICE','INVOICE_NOT_FOUND','INVOICE_CUSTOMER_MISMATCH','INVOICE_ALREADY_PAID','PAYMENT_EXCEEDS_BALANCE','ANONYMOUS_CREDIT_NOT_SUPPORTED','DUE_DATE_REQUIRED','INSUFFICIENT_STOCK','INVALID_DECIMAL','DECIMAL_RANGE','DECIMAL_PRECISION','INVOICE_RECONCILIATION_REQUIRED','INVOICE_NOT_PAYABLE','INVALID_DATE','INVALID_TEXT','INVALID_BILL_TYPE','INVALID_ITEMS','INVALID_SALES_UNIT','UNREPRESENTABLE_QUANTITY','DISCOUNT_CONFLICT','EXCESSIVE_DISCOUNT','UNSUPPORTED_INPUT','PAYMENT_SPLIT_MISMATCH','INVALID_PAYMENT_MODES','INVALID_PAYMENT_MODE','INVALID_PAYMENT_TEXT','CONTRADICTORY_PAYMENT_MODES','UNSUPPORTED_PAYMENT_FIELD']);
export const financialError = code => ({OPERATION_ACTOR_MISMATCH:'The signed-in account changed in another tab. Sign in as the original account, then retry this saved transaction.',INVALID_OPERATION_ACTOR:'The original account could not be verified. Keep this saved transaction and sign in as its original account before retrying.',QUOTE_CHANGED:'Product, stock or tax details changed. Edit and review the updated invoice before confirming.',DUE_DATE_REQUIRED:'Choose a due date on or after the invoice date.',PAYMENT_EXCEEDS_BALANCE:'The payment exceeds the remaining invoice balance. Review the amount.',ANONYMOUS_CREDIT_NOT_SUPPORTED:'Walk-in Quick Bills must be paid in full. Select a registered customer to allow dues.',INVALID_SALES_UNIT:'The selected unit is not enabled for sales on this product.',UNREPRESENTABLE_QUANTITY:'This quantity cannot be represented exactly in stock units. Choose another quantity.',EXCESSIVE_DISCOUNT:'The per-unit discount cannot exceed the selling rate.',INSUFFICIENT_STOCK:'There is not enough stock for this sale. Review the quantities.',INVOICE_RECONCILIATION_REQUIRED:'This invoice needs a ledger review before another payment can be recorded.'}[code] || 'The transaction could not be confirmed. Review its recovery status before continuing.');
const safeReceipt = value => Array.isArray(value) ? value.map(safeReceipt) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).filter(([key])=>!['cost_price_snapshot','line_profit','total_cost','profit_amount','profit_pct'].includes(key)).map(([key,item])=>[key,safeReceipt(item)])) : value;
export async function executeIntent(storage, userId, operation, intent, send) {
  const actorId=originalActor(intent,userId);
  const stored = readIntent(storage,userId,operation);
  if (stored && stored.key !== intent.key) throw new Error('Another saved transaction must be resolved first');
  const pending = { ...intent, actorId, status:'pending', error:null };
  persist(storage,userId,operation,pending); // If this fails, no request is sent.
  let outcome;
  try {
    const response = await send(pending.payload,pending.key,pending.actorId);
    const receipt=response?.data?.data;
    const id=operation==='invoice' ? receipt?.invoice_id : receipt?.id;
    const amounts=operation==='invoice' ? ['grand_total','amount_paid','balance_due'] : ['amount','outstanding_balance'];
    if(response?.data?.success!==true || !/^[1-9]\d*$/.test(String(id)) || !amounts.every(field=>typeof receipt?.[field]==='string' && /^-?\d+\.\d{2}$/.test(receipt[field]))) {
      throw new Error('The response did not confirm a receipt');
    }
    outcome = { ...pending, status:'completed', result:safeReceipt(receipt) };
  } catch (error) {
    const status = error.response?.status;
    const code = error.response?.data?.code;
    const rejected = intent.status !== 'uncertain' && [400,404,409,422].includes(status) && rejectedCodes.has(code);
    outcome = { ...pending, status:rejected ? 'rejected' : 'uncertain', code,
      error: code ? financialError(code) : 'The response was not received. The transaction may already be recorded.' };
  }
  try { persist(storage,userId,operation,outcome); } catch { /* The pre-dispatch key remains recoverable. */ }
  return outcome;
}
export function clearIntent(storage,userId,operation,intent) {
  if(intent) originalActor(intent,userId);
  if (intent && !['rejected','completed'].includes(intent.status)) throw new Error('Resolve this transaction before starting another');
  const stored = readIntent(storage,userId,operation);
  if (stored && (!intent || stored.key !== intent.key)) throw new Error('Another saved transaction must be resolved first');
  storage.removeItem(intentStorageKey(userId,operation));
  if (storage.getItem(intentStorageKey(userId,operation))) throw new Error('Could not clear the completed transaction');
}
