const { createHash } = require('node:crypto');
const { pool } = require('../../config/db');
const { decimal, format, round, positiveId, date, fail } = require('../../utils/financial');
const { withIdempotency } = require('../../utils/idempotency');
const { requireReconciledInvoice } = require('../../utils/invoiceReconciliation');
const { calculateInvoiceTotals } = require('./invoiceCalculation');

const MAX = 999999999999n;
const moneyFields = ['rate', 'discount_amount', 'discount_pct', 'gst_pct', 'cost_price_snapshot'];
const totalFields = ['subtotal', 'discount_total', 'taxable_total', 'gst_total', 'grand_total', 'total_cost', 'profit_amount', 'profit_pct'];
function signed(value, scale = 2, maximum = MAX) {
  const negative = typeof value === 'string' ? value.startsWith('-') : typeof value === 'number' && value < 0;
  const magnitude = negative ? (typeof value === 'string' ? value.slice(1) : -value) : value;
  const result = decimal(magnitude, scale, 'issued value', { max: maximum });
  return negative ? -result : result;
}

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('UNSUPPORTED_RETURN_FIELD');
}

function normalizeReturn(input) {
  fields(input, ['original_invoice_id', 'items', 'date', 'return_date', 'reason', 'disposition', 'quote_hash']);
  const returnDate = date(input.return_date ?? input.date);
  if (input.date !== undefined && date(input.date) !== returnDate) fail('RETURN_DATE_CONFLICT');
  if (input.disposition !== 'sellable') fail('RETURN_DISPOSITION_UNSUPPORTED');
  if (typeof input.reason !== 'string' || !input.reason.trim() || input.reason.length > 500) fail('RETURN_REASON_REQUIRED');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 500) fail('INVALID_RETURN_ITEMS');
  const seen = new Set();
  const items = input.items.map(item => {
    fields(item, ['invoice_item_id', 'product_id', 'qty_returned', 'unit', 'base_unit_snapshot', 'base_qty', ...moneyFields]);
    const id = positiveId(item.invoice_item_id);
    if (seen.has(id)) fail('DUPLICATE_RETURN_ITEM');
    seen.add(id);
    const normalized = { invoice_item_id: id, qty_returned: format(decimal(item.qty_returned, 3, 'return quantity', { min: 1n }), 3) };
    if (item.product_id !== undefined) normalized.product_id = positiveId(item.product_id);
    for (const field of moneyFields) {
      if (item[field] !== undefined) normalized[field] = format(decimal(item[field], 2));
    }
    if (item.base_qty !== undefined) normalized.base_qty = format(decimal(item.base_qty, 3, 'base quantity', { min: 1n }), 3);
    for (const field of ['unit', 'base_unit_snapshot']) {
      if (item[field] !== undefined) {
        if (typeof item[field] !== 'string' || !item[field] || item[field].length > 20) fail('INVALID_RETURN_UNIT');
        normalized[field] = item[field];
      }
    }
    return normalized;
  }).sort((a, b) => a.invoice_item_id - b.invoice_item_id);
  if (input.quote_hash !== undefined && (typeof input.quote_hash !== 'string' || !/^[a-f0-9]{64}$/.test(input.quote_hash))) fail('INVALID_QUOTE');
  return { original_invoice_id: positiveId(input.original_invoice_id), return_date: returnDate,
    reason: input.reason.trim(), disposition: 'sellable', items,
    ...(input.quote_hash === undefined ? {} : { quote_hash: input.quote_hash }) };
}

function issuedAmounts(line) {
  const qty = decimal(line.qty, 3, 'issued quantity', { min: 1n });
  const base = decimal(line.base_qty, 3, 'issued base quantity', { min: 1n });
  const taxable = decimal(line.taxable_amount, 2);
  const gross = round(decimal(line.rate, 2) * qty, 1000n);
  const discount = gross - taxable;
  const gst = decimal(line.gst_amount, 2);
  const cost = taxable - signed(line.line_profit);
  if (discount < 0n || cost < 0n || cost > MAX || !line.base_unit_snapshot || line.original_invoice_item_id !== null ||
      (line.allocated_subtotal !== null && signed(line.allocated_subtotal) !== gross) ||
      (line.allocated_discount_total !== null && signed(line.allocated_discount_total) !== discount)) fail('RETURN_RECONCILIATION_REQUIRED');
  return { qty, base, taxable, discount, gst, cost };
}

async function verifyIssuedSale(client, invoice, lines) {
  try {
    if (!lines.length || invoice.original_invoice_id !== null ||
        (invoice.document_kind !== null && invoice.document_kind !== 'sale')) fail('RETURN_RECONCILIATION_REQUIRED');
    const totals = calculateInvoiceTotals(lines);
    for (const field of totalFields) {
      const maximum = field === 'profit_pct' ? 9999999999999999n : MAX;
      if (signed(totals[field], 2, maximum) !== signed(invoice[field], 2, maximum)) fail('RETURN_RECONCILIATION_REQUIRED');
    }
    lines.forEach((line, index) => {
      issuedAmounts(line);
      for (const field of ['taxable_amount', 'gst_amount', 'line_total', 'line_profit']) {
        if (signed(line[field]) !== signed(totals.items[index][field])) fail('RETURN_RECONCILIATION_REQUIRED');
      }
    });
    if (invoice.document_kind === 'sale' && invoice.contract_version === 'phase3-v1') return;
    if (invoice.document_kind !== null || invoice.contract_version !== null) fail('RETURN_RECONCILIATION_REQUIRED');
    const { rows } = await client.query(`SELECT response_body FROM idempotency_keys
      WHERE operation='invoice.create' AND actor_id=$1 AND status_code=201
        AND response_body->'data'->>'invoice_id'=$2`, [invoice.created_by, String(invoice.id)]);
    const evidence = rows.length === 1 && rows[0].response_body?.data;
    if (!evidence || evidence.customer_id !== invoice.customer_id || evidence.bill_type !== invoice.bill_type ||
        evidence.invoice_no !== invoice.invoice_no || !Array.isArray(evidence.items) || evidence.items.length !== lines.length) fail('RETURN_RECONCILIATION_REQUIRED');
    for (const field of totalFields) {
      const maximum = field === 'profit_pct' ? 9999999999999999n : MAX;
      if (signed(evidence.totals?.[field], 2, maximum) !== signed(invoice[field], 2, maximum)) fail('RETURN_RECONCILIATION_REQUIRED');
    }
    lines.forEach((line, index) => {
      const saved = evidence.items[index];
      if (!saved || saved.product_id !== line.product_id || saved.unit !== line.unit || saved.base_unit !== line.base_unit_snapshot ||
          saved.product_name_snapshot !== line.product_name_snapshot || saved.hsn_snapshot !== line.hsn_snapshot) fail('RETURN_RECONCILIATION_REQUIRED');
      for (const field of [...moneyFields, 'taxable_amount', 'gst_amount', 'line_total', 'line_profit']) {
        if (signed(saved[field]) !== signed(line[field])) fail('RETURN_RECONCILIATION_REQUIRED');
      }
      for (const field of ['qty', 'base_qty']) {
        if (decimal(saved[field], 3) !== decimal(line[field], 3)) fail('RETURN_RECONCILIATION_REQUIRED');
      }
    });
  } catch (error) {
    if (error.errorCode) fail('RETURN_RECONCILIATION_REQUIRED');
    throw error;
  }
}

function allocation(amounts, returned, previous = 0n) {
  const result = {};
  for (const field of ['taxable', 'discount', 'gst', 'cost']) {
    result[field] = round(amounts[field] * returned, amounts.qty) - round(amounts[field] * previous, amounts.qty);
  }
  return result;
}

async function calculateReturn(client, intent) {
  const { rows: [invoice] } = await client.query('SELECT * FROM invoices WHERE id=$1 FOR UPDATE', [intent.original_invoice_id]);
  if (!invoice) fail('INVOICE_NOT_FOUND', 404);
  if (invoice.document_kind === 'sales_return') fail('INVALID_RETURN_DOCUMENT');
  if (invoice.customer_id === null && (invoice.amount_paid !== invoice.grand_total || invoice.balance_due !== '0.00')) fail('ANONYMOUS_RETURN_SETTLEMENT_REQUIRED');
  await require('../settlements/customer').requireInvoiceDate(client, invoice.id, intent.return_date);
  const { rows: lines } = await client.query('SELECT * FROM invoice_items WHERE invoice_id=$1 ORDER BY id FOR UPDATE', [invoice.id]);
  await verifyIssuedSale(client, invoice, lines);
  const byId = new Map(lines.map(line => [line.id, line]));
  for (const item of intent.items) {
    const line = byId.get(item.invoice_item_id);
    if (!line) fail('INVALID_RETURN_ITEM');
    if (item.product_id !== undefined && item.product_id !== line.product_id) fail('RETURN_PRODUCT_MISMATCH');
    for (const field of moneyFields) {
      if (item[field] !== undefined && decimal(item[field], 2) !== decimal(line[field], 2)) fail('RETURN_VALUE_MISMATCH');
    }
    for (const field of ['unit', 'base_unit_snapshot']) {
      if (item[field] !== undefined && item[field] !== line[field]) fail('RETURN_VALUE_MISMATCH');
    }
  }
  const productIds = [...new Set(intent.items.map(item => byId.get(item.invoice_item_id).product_id))].sort((a, b) => a - b);
  const { rows: products } = await client.query('SELECT id,is_active,base_unit,unit,current_stock FROM products WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE', [productIds]);
  if (products.length !== productIds.length || products.some(product => !product.is_active)) fail('RETURN_PRODUCT_UNAVAILABLE');
  const productById = new Map(products.map(product => [product.id, product]));
  if (invoice.customer_id !== null) {
    const { rows: [customer] } = await client.query('SELECT id,is_active FROM customers WHERE id=$1 FOR UPDATE', [invoice.customer_id]);
    if (!customer?.is_active) fail('RETURN_CUSTOMER_UNAVAILABLE');
  }
  try { await requireReconciledInvoice(client, invoice.id); }
  catch (error) {
    if (error.errorCode === 'INVOICE_RECONCILIATION_REQUIRED') fail('RETURN_RECONCILIATION_REQUIRED');
    throw error;
  }
  const oldMovements = await client.query("SELECT 1 FROM stock_ledger WHERE reference_type='return' AND reference_id=$1 LIMIT 1", [invoice.id]);
  if (oldMovements.rowCount) fail('RETURN_RECONCILIATION_REQUIRED');
  const { rows: prior } = await client.query(`SELECT ci.*, c.original_invoice_id AS source_invoice_id, c.document_kind, c.contract_version
    FROM invoice_items ci JOIN invoices c ON c.id=ci.invoice_id WHERE ci.original_invoice_item_id=ANY($1::integer[])`, [lines.map(line => line.id)]);
  for (const line of lines) {
    const amounts = issuedAmounts(line);
    const previous = decimal(line.qty_returned, 3);
    if (previous > amounts.qty) fail('RETURN_RECONCILIATION_REQUIRED');
    const linked = prior.filter(item => item.original_invoice_item_id === line.id).sort((a, b) => a.id - b.id);
    const actual = { qty: 0n, base: 0n, taxable: 0n, discount: 0n, gst: 0n, cost: 0n };
    for (const item of linked) {
      if (item.source_invoice_id !== invoice.id || item.document_kind !== 'sales_return' || item.contract_version !== 'phase3-v1' ||
          item.product_id !== line.product_id || item.unit !== line.unit || item.base_unit_snapshot !== line.base_unit_snapshot ||
          item.product_name_snapshot !== line.product_name_snapshot || item.hsn_snapshot !== line.hsn_snapshot ||
          signed(item.qty, 3) >= 0n || signed(item.base_qty, 3) >= 0n) fail('RETURN_RECONCILIATION_REQUIRED');
      for (const field of moneyFields) {
        if (decimal(item[field], 2) !== decimal(line[field], 2)) fail('RETURN_RECONCILIATION_REQUIRED');
      }
      const next = actual.qty - signed(item.qty, 3);
      if (next > amounts.qty || amounts.base * -signed(item.qty, 3) % amounts.qty !== 0n ||
          -signed(item.base_qty, 3) !== amounts.base * -signed(item.qty, 3) / amounts.qty) fail('RETURN_RECONCILIATION_REQUIRED');
      const slice = allocation(amounts, next, actual.qty);
      if (-signed(item.taxable_amount) !== slice.taxable || -signed(item.allocated_discount_total) !== slice.discount ||
          -signed(item.gst_amount) !== slice.gst || signed(item.line_profit) - signed(item.taxable_amount) !== slice.cost) fail('RETURN_RECONCILIATION_REQUIRED');
      actual.qty -= signed(item.qty, 3); actual.base -= signed(item.base_qty, 3);
      actual.taxable -= signed(item.taxable_amount); actual.discount -= signed(item.allocated_discount_total);
      actual.gst -= signed(item.gst_amount); actual.cost -= signed(item.taxable_amount) - signed(item.line_profit);
      if (signed(item.allocated_subtotal) !== signed(item.taxable_amount) + signed(item.allocated_discount_total) ||
          signed(item.line_total) !== signed(item.taxable_amount) + signed(item.gst_amount)) fail('RETURN_RECONCILIATION_REQUIRED');
    }
    if (actual.qty !== previous || amounts.base * previous % amounts.qty !== 0n || actual.base !== amounts.base * previous / amounts.qty) fail('RETURN_RECONCILIATION_REQUIRED');
    const expected = allocation(amounts, previous);
    for (const field of ['taxable', 'discount', 'gst', 'cost']) {
      if (actual[field] !== expected[field]) fail('RETURN_RECONCILIATION_REQUIRED');
    }
  }
  const sums = { taxable: 0n, discount: 0n, gst: 0n, cost: 0n };
  const stockReturns = new Map();
  const items = intent.items.map(item => {
    const line = byId.get(item.invoice_item_id);
    const product = productById.get(line.product_id);
    if ((product.base_unit || product.unit) !== line.base_unit_snapshot) fail('RETURN_RECONCILIATION_REQUIRED');
    const amounts = issuedAmounts(line);
    const quantity = decimal(item.qty_returned, 3);
    const previous = decimal(line.qty_returned, 3);
    if (quantity > amounts.qty - previous) fail('RETURN_QTY_EXCEEDS_ORIGINAL');
    if (amounts.base * quantity % amounts.qty !== 0n) fail('UNREPRESENTABLE_QUANTITY');
    const base = amounts.base * quantity / amounts.qty;
    if (item.base_qty !== undefined && decimal(item.base_qty, 3) !== base) fail('RETURN_VALUE_MISMATCH');
    const values = allocation(amounts, previous + quantity, previous);
    for (const field of Object.keys(sums)) sums[field] += values[field];
    stockReturns.set(product.id, (stockReturns.get(product.id) || 0n) + base);
    return { invoice_item_id: line.id, product_id: line.product_id, product_name_snapshot: line.product_name_snapshot,
      hsn_snapshot: line.hsn_snapshot, qty_returned: item.qty_returned, qty_returned_before: line.qty_returned,
      remaining_qty: format(amounts.qty - previous, 3), remaining_qty_after: format(amounts.qty - previous - quantity, 3),
      unit: line.unit, base_qty: format(base, 3), base_unit_snapshot: line.base_unit_snapshot,
      rate: line.rate, discount_amount: line.discount_amount, discount_pct: line.discount_pct, gst_pct: line.gst_pct,
      cost_price_snapshot: line.cost_price_snapshot, taxable_amount: format(values.taxable), gst_amount: format(values.gst),
      allocated_discount_total: format(values.discount), allocated_subtotal: format(values.taxable + values.discount),
      line_total: format(values.taxable + values.gst), total_cost: format(values.cost), line_profit: format(values.taxable - values.cost) };
  });
  for (const [id, quantity] of stockReturns) decimal(format(decimal(productById.get(id).current_stock, 3) + quantity, 3), 3);
  const credit = sums.taxable + sums.gst;
  const due = decimal(invoice.balance_due, 2);
  const applied = credit < due ? credit : due;
  const totals = { subtotal: format(sums.taxable + sums.discount), discount_total: format(sums.discount),
    taxable_total: format(sums.taxable), gst_total: format(sums.gst), grand_total: format(credit),
    total_cost: format(sums.cost), profit_amount: format(sums.taxable - sums.cost),
    profit_pct: format(sums.taxable ? round((sums.taxable - sums.cost) * 10000n, sums.taxable) : 0n) };
  const quote = { original_invoice_id: invoice.id, original_invoice_no: invoice.invoice_no, customer_id: invoice.customer_id,
    return_date: intent.return_date, reason: intent.reason, disposition: intent.disposition, items, totals,
    grand_total: totals.grand_total, applied_amount: format(applied), unapplied_amount: format(credit - applied),
    amount_paid: invoice.amount_paid, balance_due: format(due - applied) };
  quote.quote_hash = createHash('sha256').update(JSON.stringify(quote)).digest('hex');
  return { invoice, quote };
}

async function quoteReturn(input) {
  const intent = normalizeReturn(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const { quote } = await calculateReturn(client, intent);
    await client.query('ROLLBACK');
    return quote;
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally { client.release(); }
}

async function processReturn(input, userId, key) {
  const intent = normalizeReturn(input);
  return withIdempotency({ actorId: userId, operation: 'invoice.return', key, intent }, async client => {
    const { invoice, quote } = await calculateReturn(client, intent);
    if (intent.quote_hash && intent.quote_hash !== quote.quote_hash) fail('RETURN_QUOTE_CHANGED', 409);
    const total = quote.totals;
    const negative = value => format(-signed(value));
    const { rows: [credit] } = await client.query(`INSERT INTO invoices(customer_id,customer_name_walkin,bill_type,date,
      subtotal,discount_total,taxable_total,gst_total,grand_total,total_cost,profit_amount,profit_pct,
      amount_paid,balance_due,status,pdf_status,created_by,notes,document_kind,contract_version,original_invoice_id)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,0,0,'paid','disabled',$13,$14,'sales_return','phase3-v1',$15)
      RETURNING id,invoice_no`, [invoice.customer_id, invoice.customer_name_walkin, invoice.bill_type, intent.return_date,
      negative(total.subtotal), negative(total.discount_total), negative(total.taxable_total), negative(total.gst_total),
      negative(total.grand_total), negative(total.total_cost), negative(total.profit_amount), total.profit_pct, userId, intent.reason, invoice.id]);
    for (const item of quote.items) {
      await client.query(`INSERT INTO invoice_items(invoice_id,product_id,product_name_snapshot,hsn_snapshot,qty,unit,
        rate,discount_pct,discount_amount,taxable_amount,gst_pct,gst_amount,line_total,cost_price_snapshot,line_profit,
        base_qty,base_unit_snapshot,original_invoice_item_id,allocated_subtotal,allocated_discount_total)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20)`,
      [credit.id,item.product_id,item.product_name_snapshot,item.hsn_snapshot,format(-decimal(item.qty_returned,3),3),item.unit,
        item.rate,item.discount_pct,item.discount_amount,negative(item.taxable_amount),item.gst_pct,negative(item.gst_amount),
        negative(item.line_total),item.cost_price_snapshot,negative(item.line_profit),format(-decimal(item.base_qty,3),3),
        item.base_unit_snapshot,item.invoice_item_id,negative(item.allocated_subtotal),negative(item.allocated_discount_total)]);
      const updated = await client.query(`UPDATE invoice_items SET qty_returned=qty_returned+$1
        WHERE id=$2 AND qty_returned=$3 AND qty_returned+$1<=qty RETURNING id`, [item.qty_returned,item.invoice_item_id,item.qty_returned_before]);
      if (!updated.rowCount) fail('RETURN_QTY_EXCEEDS_ORIGINAL');
      const { rows: [stock] } = await client.query('UPDATE products SET current_stock=current_stock+$1,updated_at=NOW() WHERE id=$2 RETURNING current_stock', [item.base_qty,item.product_id]);
      await client.query(`INSERT INTO stock_ledger(product_id,date,movement_type,reference_id,reference_type,qty_in,qty_out,stock_after,notes,created_by)
        VALUES($1,$2,'return_in',$3,'sales_return',$4,0,$5,$6,$7)`,
      [item.product_id,intent.return_date,credit.id,item.base_qty,stock.current_stock,intent.reason,userId]);
    }
    let anonymousLiability = null;
    if (invoice.customer_id === null) {
      anonymousLiability = (await client.query(`INSERT INTO anonymous_return_liabilities(credit_invoice_id,original_invoice_id,amount,date,created_by)
        VALUES($1,$2,$3,$4,$5) RETURNING id,amount`, [credit.id,invoice.id,total.grand_total,intent.return_date,userId])).rows[0];
    } else {
      await client.query(`INSERT INTO sales_return_applications(credit_invoice_id,original_invoice_id,customer_id,total_credit,applied_amount,unapplied_amount,date,created_by)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, [credit.id,invoice.id,invoice.customer_id,total.grand_total,quote.applied_amount,quote.unapplied_amount,intent.return_date,userId]);
      await client.query(`INSERT INTO customer_ledger(customer_id,date,entry_type,reference_id,reference_type,debit,credit,balance,description)
        VALUES($1,$2,'return',$3,'invoice',0,$4,0,$5)`, [invoice.customer_id,intent.return_date,credit.id,total.grand_total,`Credit note ${credit.invoice_no} against ${invoice.invoice_no}`]);
    }
    const status = quote.balance_due === '0.00' ? 'paid' : decimal(quote.balance_due,2) < decimal(invoice.grand_total,2) ? 'partial' : 'unpaid';
    await client.query('UPDATE invoices SET balance_due=$1,status=$2 WHERE id=$3', [quote.balance_due,status,invoice.id]);
    return { status: 201, body: { success: true, data: { credit_note_id: credit.id, credit_note_no: credit.invoice_no,
      document_kind: 'sales_return', original_invoice_id: invoice.id, original_invoice_no: invoice.invoice_no,
      customer_id: invoice.customer_id, grand_total: negative(total.grand_total), items_returned: quote.items.length,
      applied_amount: quote.applied_amount, unapplied_amount: quote.unapplied_amount, amount_paid: invoice.amount_paid,
      balance_due: quote.balance_due, status, pdf_status: 'disabled', items: quote.items,
      ...(anonymousLiability ? { anonymous_liability_id: anonymousLiability.id, refundable_amount: anonymousLiability.amount } : {}) } } };
  });
}

module.exports = { normalizeReturn, quoteReturn, processReturn };
