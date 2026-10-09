import { scaled } from './billing.calculations.js';
import { validSettlementReceipt, settlementRejectionCodes, settlementError } from './settlementIntent.js';
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
  if(value.operation!==undefined && value.operation!==operation) throw new Error('Saved transaction operation does not match its recovery slot');
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
for (const code of settlementRejectionCodes) rejectedCodes.add(code);
// Only definitive pre-commit domain rejections permit editing a saved operation.
for (const code of ['ANONYMOUS_RETURN_SETTLEMENT_REQUIRED', 'BASE_UNIT_CHANGE_UNSUPPORTED', 'BASE_UNIT_CONFLICT', 'CATALOG_CHANGED', 'CATALOG_VERSION_REQUIRED', 'CONVERSION_FLAGS_REQUIRED', 'DUPLICATE_BARCODE', 'DUPLICATE_CONVERSION_UNIT', 'DUPLICATE_PURCHASE_RETURN_ITEM', 'DUPLICATE_RETURN_ITEM', 'DUPLICATE_SKU', 'INSUFFICIENT_STOCK', 'INVALID_CONVERSIONS', 'INVALID_CONVERSION_UNIT', 'INVALID_GST_RATE', 'INVALID_PRODUCT_ACTIVE', 'INVALID_PRODUCT_TEXT', 'INVALID_PURCHASE_ITEMS', 'INVALID_PURCHASE_RETURN_ITEM', 'INVALID_PURCHASE_RETURN_ITEMS', 'INVALID_PURCHASE_TEXT', 'INVALID_PURCHASE_UNIT', 'INVALID_QUOTE', 'INVALID_RETURN_DOCUMENT', 'INVALID_RETURN_ITEM', 'INVALID_RETURN_ITEMS', 'INVALID_RETURN_UNIT', 'INVOICE_NOT_FOUND', 'NO_FIELDS', 'PRODUCT_FIELDS_REQUIRED', 'PRODUCT_NOT_FOUND', 'PRODUCT_UNAVAILABLE', 'PURCHASE_NOT_FOUND', 'PURCHASE_QUOTE_CHANGED', 'PURCHASE_RETURN_DATE_CONFLICT', 'PURCHASE_RETURN_PRODUCT_MISMATCH', 'PURCHASE_RETURN_QTY_EXCEEDS_ORIGINAL', 'PURCHASE_RETURN_QUOTE_CHANGED', 'PURCHASE_RETURN_RECONCILIATION_REQUIRED', 'PURCHASE_RETURN_SUPPLIER_MISMATCH', 'PURCHASE_RETURN_VALUE_MISMATCH', 'RETURN_CUSTOMER_UNAVAILABLE', 'RETURN_DATE_CONFLICT', 'RETURN_DISPOSITION_UNSUPPORTED', 'RETURN_PRODUCT_MISMATCH', 'RETURN_PRODUCT_UNAVAILABLE', 'RETURN_QTY_EXCEEDS_ORIGINAL', 'RETURN_QUOTE_CHANGED', 'RETURN_REASON_REQUIRED', 'RETURN_RECONCILIATION_REQUIRED', 'RETURN_VALUE_MISMATCH', 'STOCK_CHANGED', 'STOCK_COMMAND_REQUIRED', 'STOCK_REASON_REQUIRED', 'STOCK_RECONCILIATION_REQUIRED', 'SUPPLIER_UNAVAILABLE', 'UNREPRESENTABLE_QUANTITY', 'UNSUPPORTED_CATALOG_FIELD', 'UNSUPPORTED_PURCHASE_FIELD', 'UNSUPPORTED_RETURN_FIELD']) rejectedCodes.add(code);
export const financialError = code => settlementError(code) || ({RETURN_QUOTE_CHANGED:'Return eligibility or credit application changed. Edit and review a fresh quote.',PURCHASE_QUOTE_CHANGED:'Purchase units or catalog details changed. Edit and review a fresh quote.',PURCHASE_RETURN_QUOTE_CHANGED:'Return eligibility or stock changed. Edit and review a fresh quote.',STOCK_CHANGED:'Stock changed since this count was loaded. Reload and count again before a new submission.',CATALOG_CHANGED:'This product changed since the form was loaded. Reload and review your edits.',STOCK_RECONCILIATION_REQUIRED:'The stock balance needs a ledger review before a count can be posted.',RETURN_RECONCILIATION_REQUIRED:'The original sale needs a review of its issued records before it can be returned.',PURCHASE_RETURN_RECONCILIATION_REQUIRED:'The original purchase needs a review of its issued records before it can be returned.',ANONYMOUS_RETURN_SETTLEMENT_REQUIRED:'Walk-in returns require a settlement workflow that is not supported yet.',BASE_UNIT_CHANGE_UNSUPPORTED:'The base stock unit cannot change after stock or document history exists.',STOCK_COMMAND_REQUIRED:'Use the reasoned stock count action to change stock.',RETURN_DISPOSITION_UNSUPPORTED:'Only sellable goods can be returned to stock.',RETURN_QTY_EXCEEDS_ORIGINAL:'The return exceeds the remaining quantity on the original sale.',PURCHASE_RETURN_QTY_EXCEEDS_ORIGINAL:'The return exceeds the remaining quantity on the original purchase.',INVALID_PURCHASE_UNIT:'This unit is not enabled for purchasing.',OPERATION_ACTOR_MISMATCH:'The signed-in account changed in another tab. Sign in as the original account, then retry this saved transaction.',INVALID_OPERATION_ACTOR:'The original account could not be verified. Keep this saved transaction and sign in as its original account before retrying.',QUOTE_CHANGED:'Product, stock or tax details changed. Edit and review the updated invoice before confirming.',DUE_DATE_REQUIRED:'Choose a due date on or after the invoice date.',PAYMENT_EXCEEDS_BALANCE:'The payment exceeds the remaining invoice balance. Review the amount.',ANONYMOUS_CREDIT_NOT_SUPPORTED:'Walk-in Quick Bills must be paid in full. Select a registered customer to allow dues.',INVALID_SALES_UNIT:'The selected unit is not enabled for sales on this product.',UNREPRESENTABLE_QUANTITY:'This quantity cannot be represented exactly in stock units. Choose another quantity.',EXCESSIVE_DISCOUNT:'The per-unit discount cannot exceed the selling rate.',INSUFFICIENT_STOCK:'There is not enough stock for this sale. Review the quantities.',INVOICE_RECONCILIATION_REQUIRED:'This invoice needs a ledger review before another payment can be recorded.'}[code] || 'The transaction could not be confirmed. Review its recovery status before continuing.');
const safeReceipt = value => Array.isArray(value) ? value.map(safeReceipt) : value && typeof value==='object' ? Object.fromEntries(Object.entries(value).filter(([key])=>!['cost_price_snapshot','line_profit','total_cost','profit_amount','profit_pct'].includes(key)).map(([key,item])=>[key,safeReceipt(item)])) : value;
const receiptId = value => /^[1-9]\d*$/.test(String(value));
const receiptMoney = value => typeof value==='string' && /^-?\d+\.\d{2}$/.test(value);
const receiptQuantity = value => typeof value==='string' && /^\d+\.\d{3}$/.test(value);
const cents = value => BigInt(value.replace('.',''));
function validReceipt(operation, receipt, payload) {
  if(!receipt || typeof receipt!=='object') return false;
  if(['customer-advance','customer-settlement','supplier-settlement','day-open','day-close'].includes(operation)) return validSettlementReceipt(operation,receipt,payload);
  if(operation==='invoice') return receiptId(receipt.invoice_id) && ['grand_total','amount_paid','balance_due'].every(field=>receiptMoney(receipt[field]));
  if(operation==='payment') return receiptId(receipt.id) && ['amount','outstanding_balance'].every(field=>receiptMoney(receipt[field]));
  if(operation==='purchase') return receiptId(receipt.purchase?.id) && receiptMoney(receipt.purchase?.total_amount) && cents(receipt.purchase.total_amount)>=0n;
  if(operation==='purchase-return') return receiptId(receipt.id) && String(receipt.purchase_id)===String(payload.purchase_id)
    && receipt.status==='posted' && receiptMoney(receipt.total_amount) && cents(receipt.total_amount)>=0n
    && receiptId(receipt.debit_note?.id) && receipt.debit_note.status==='outstanding' && receipt.debit_note.amount===receipt.total_amount;
  if(operation==='sales-return') return receiptId(receipt.credit_note_id) && String(receipt.original_invoice_id)===String(payload.original_invoice_id)
    && ['grand_total','applied_amount','unapplied_amount','amount_paid','balance_due'].every(field=>receiptMoney(receipt[field]))
    && ['applied_amount','unapplied_amount','amount_paid','balance_due'].every(field=>cents(receipt[field])>=0n)
    && -cents(receipt.grand_total)===cents(receipt.applied_amount)+cents(receipt.unapplied_amount);
  if(operation==='product-create') return receiptId(receipt.id) && receiptQuantity(receipt.current_stock);
  if(operation==='stock-adjustment') return receiptId(receipt.adjustment_id) && String(receipt.product_id)===String(payload.product_id)
    && receiptQuantity(receipt.current_stock) && /^\d+$/.test(String(receipt.stock_version))
    && scaled(receipt.current_stock,3)===scaled(payload.counted_stock,3);
  return false;
}
export async function executeIntent(storage, userId, operation, intent, send) {
  const actorId=originalActor(intent,userId);
  const stored = readIntent(storage,userId,operation);
  if (stored && stored.key !== intent.key) throw new Error('Another saved transaction must be resolved first');
  const pending = { ...intent, actorId, operation, status:'pending', error:null };
  persist(storage,userId,operation,pending); // If this fails, no request is sent.
  let outcome;
  try {
    const response = await send(pending.payload,pending.key,pending.actorId);
    const receipt=response?.data?.data;
    if(response?.data?.success!==true || !validReceipt(operation,receipt,pending.payload)) {
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
