const { createHash } = require('node:crypto');
const { pool } = require('../../config/db');
const { decimal, format, round, positiveId, date, fail } = require('../../utils/financial');
const { withIdempotency } = require('../../utils/idempotency');

function fields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(key => !allowed.includes(key))) fail('UNSUPPORTED_PURCHASE_FIELD');
}
function text(value, maximum, required = false) {
  if (!required && (value === undefined || value === null || value === '')) return null;
  if (typeof value !== 'string' || !value.trim() || value.length > maximum) fail('INVALID_PURCHASE_TEXT');
  return value.trim();
}
function quoteHash(value) {
  if (value !== undefined && (typeof value !== 'string' || !/^[a-f0-9]{64}$/.test(value))) fail('INVALID_QUOTE');
  return value === undefined ? {} : { quote_hash: value };
}
function normalizePurchase(input) {
  fields(input, ['supplier_id', 'date', 'notes', 'items', 'quote_hash', 'total_amount']);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 500) fail('INVALID_PURCHASE_ITEMS');
  const items = input.items.map(item => {
    fields(item, ['product_id', 'qty', 'unit', 'cost_price', 'line_total', 'base_qty', 'product_name', 'product_name_snapshot']);
    return { product_id: positiveId(item.product_id), qty: format(decimal(item.qty, 3, 'quantity', { min: 1n }), 3),
      unit: text(item.unit, 20, true), cost_price: format(decimal(item.cost_price, 2)) };
  });
  return { supplier_id: positiveId(input.supplier_id), date: date(input.date), notes: text(input.notes, 500), items, ...quoteHash(input.quote_hash) };
}
function normalizeReturn(purchaseId, input) {
  fields(input, ['items', 'date', 'return_date', 'reason', 'supplier_id', 'quote_hash']);
  const returnDate = date(input.return_date ?? input.date);
  if (input.date !== undefined && date(input.date) !== returnDate) fail('PURCHASE_RETURN_DATE_CONFLICT');
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 500) fail('INVALID_PURCHASE_RETURN_ITEMS');
  const seen = new Set();
  const items = input.items.map(item => {
    fields(item, ['purchase_item_id', 'qty_returned', 'product_id', 'cost_price', 'unit', 'base_qty', 'base_unit_snapshot']);
    const id = positiveId(item.purchase_item_id);
    if (seen.has(id)) fail('DUPLICATE_PURCHASE_RETURN_ITEM');
    seen.add(id);
    const normalized = { purchase_item_id: id, qty_returned: format(decimal(item.qty_returned, 3, 'return quantity', { min: 1n }), 3) };
    if (item.product_id !== undefined) normalized.product_id = positiveId(item.product_id);
    if (item.cost_price !== undefined) normalized.cost_price = format(decimal(item.cost_price, 2));
    if (item.base_qty !== undefined) normalized.base_qty = format(decimal(item.base_qty, 3, 'base quantity', { min: 1n }), 3);
    for (const field of ['unit', 'base_unit_snapshot']) if (item[field] !== undefined) normalized[field] = text(item[field], 20, true);
    return normalized;
  }).sort((a, b) => a.purchase_item_id - b.purchase_item_id);
  return { purchase_id: positiveId(purchaseId), return_date: returnDate, reason: text(input.reason, 500, true), items,
    ...(input.supplier_id === undefined ? {} : { supplier_id: positiveId(input.supplier_id) }), ...quoteHash(input.quote_hash) };
}
function hash(quote) {
  return { ...quote, quote_hash: createHash('sha256').update(JSON.stringify(quote)).digest('hex') };
}
async function lockProducts(client, ids) {
  const unique = [...new Set(ids)].sort((a, b) => a - b);
  const { rows } = await client.query(`SELECT id,name,unit,base_unit,current_stock,stock_version,catalog_version,
    purchase_price,wholesale_price,mrp,is_active FROM products WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE`, [unique]);
  if (rows.length !== unique.length || rows.some(product => !product.is_active)) fail('PRODUCT_UNAVAILABLE');
  return new Map(rows.map(product => [product.id, product]));
}
async function lockSupplier(client, id) {
  const { rows: [supplier] } = await client.query('SELECT id,name,is_active FROM suppliers WHERE id=$1 FOR UPDATE', [id]);
  if (!supplier?.is_active) fail('SUPPLIER_UNAVAILABLE');
  return supplier;
}
async function calculatePurchase(client, intent) {
  const products = await lockProducts(client, intent.items.map(item => item.product_id));
  const { rows: conversions } = await client.query(`SELECT product_id,unit_name,conversion_value,is_purchase_unit
    FROM product_unit_conversions WHERE product_id=ANY($1::integer[]) ORDER BY product_id,id FOR SHARE`, [[...products.keys()]]);
  const supplier = await lockSupplier(client, intent.supplier_id);
  let total = 0n;
  const demand = new Map();
  const items = intent.items.map(item => {
    const product = products.get(item.product_id);
    const baseUnit = product.base_unit || product.unit;
    const conversion = item.unit === baseUnit ? '1.0000' : conversions.find(row => row.product_id === product.id && row.unit_name === item.unit && row.is_purchase_unit)?.conversion_value;
    if (conversion === undefined) fail('INVALID_PURCHASE_UNIT');
    const factor = decimal(conversion, 4, 'conversion', { min: 1n });
    const quantity = decimal(item.qty, 3);
    if (quantity * factor % 10000n !== 0n) fail('UNREPRESENTABLE_QUANTITY');
    const base = quantity * factor / 10000n;
    const lineTotal = round(decimal(item.cost_price, 2) * quantity, 1000n);
    const baseCost = round(decimal(item.cost_price, 2) * 10000n, factor);
    decimal(format(base, 3), 3, 'base quantity', { min: 1n });
    decimal(format(lineTotal), 2); decimal(format(baseCost), 2);
    total += lineTotal;
    demand.set(product.id, (demand.get(product.id) || 0n) + base);
    return { ...item, product_name_snapshot: product.name, base_qty: format(base, 3), base_unit_snapshot: baseUnit,
      conversion_value_snapshot: format(factor, 4), line_total: format(lineTotal), base_cost_price: format(baseCost) };
  });
  decimal(format(total), 2);
  const stock = [...products.values()].map(product => {
    const after = decimal(product.current_stock, 3) + demand.get(product.id);
    decimal(format(after, 3), 3);
    return { product_id: product.id, stock_before: product.current_stock, stock_after: format(after, 3),
      stock_version: product.stock_version, catalog_version: product.catalog_version };
  });
  return { products, supplier, quote: hash({ supplier_id: supplier.id, supplier_name: supplier.name, date: intent.date,
    notes: intent.notes, items, total_amount: format(total), stock }) };
}
async function quoteTransaction(action) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await action(client);
    await client.query('ROLLBACK');
    return result.quote;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function quotePurchase(input) {
  const intent = normalizePurchase(input);
  return quoteTransaction(client => calculatePurchase(client, intent));
}
async function createPurchaseWithStockIn(input, userId, key) {
  const intent = normalizePurchase(input);
  return withIdempotency({ actorId: userId, operation: 'purchase.create', key, intent }, async client => {
    const { quote, products, supplier } = await calculatePurchase(client, intent);
    if (intent.quote_hash && intent.quote_hash !== quote.quote_hash) fail('PURCHASE_QUOTE_CHANGED', 409);
    const { rows: [sequence] } = await client.query("SELECT nextval(pg_get_serial_sequence('purchases','id')) AS id");
    const { rows: [purchase] } = await client.query(`INSERT INTO purchases(id,supplier_id,po_number,date,total_amount,notes,status,created_by,contract_version)
      VALUES($1,$2,$3,$4,$5,$6,'received',$7,'phase3-v1') RETURNING *`,
    [sequence.id,supplier.id,`PO-${intent.date.replace(/-/g, '')}-${sequence.id}`,intent.date,quote.total_amount,intent.notes,userId]);
    const items = [], stockUpdates = [];
    for (const item of quote.items) {
      const { rows: [saved] } = await client.query(`INSERT INTO purchase_items(purchase_id,product_id,qty,unit,cost_price,line_total,
        base_qty,base_unit_snapshot,conversion_value_snapshot,product_name_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [purchase.id,item.product_id,item.qty,item.unit,item.cost_price,item.line_total,item.base_qty,item.base_unit_snapshot,item.conversion_value_snapshot,item.product_name_snapshot]);
      items.push(saved);
      const before = products.get(item.product_id);
      const { rows: [updated] } = await client.query(`UPDATE products SET current_stock=current_stock+$1,purchase_price=$2,updated_at=NOW()
        WHERE id=$3 RETURNING id,name,current_stock,purchase_price,wholesale_price,mrp,stock_version,catalog_version`, [item.base_qty,item.base_cost_price,item.product_id]);
      if (decimal(before.purchase_price, 2) !== decimal(updated.purchase_price, 2)) {
        const { rows: [clock] } = await client.query('SELECT clock_timestamp()::text AS changed_at');
        await client.query('UPDATE product_price_history SET effective_to=$2 WHERE product_id=$1 AND effective_to IS NULL', [item.product_id,clock.changed_at]);
        await client.query(`INSERT INTO product_price_history(product_id,purchase_price,wholesale_price,mrp,source,changed_by,effective_from)
          VALUES($1,$2,$3,$4,'purchase',$5,$6)`, [item.product_id,updated.purchase_price,updated.wholesale_price,updated.mrp,userId,clock.changed_at]);
      }
      products.set(item.product_id, updated);
      await client.query(`INSERT INTO product_suppliers(product_id,supplier_id,last_price,last_unit,last_purchase_date)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT(product_id,supplier_id) DO UPDATE SET last_price=EXCLUDED.last_price,
        last_unit=EXCLUDED.last_unit,last_purchase_date=EXCLUDED.last_purchase_date,updated_at=NOW()`, [item.product_id,supplier.id,item.cost_price,item.unit,intent.date]);
      await client.query(`INSERT INTO stock_ledger(product_id,date,movement_type,reference_id,reference_type,qty_in,qty_out,stock_after,notes,created_by)
        VALUES($1,$2,'in',$3,'purchase',$4,0,$5,$6,$7)`, [item.product_id,intent.date,purchase.id,item.base_qty,updated.current_stock,`Purchase from supplier: ${supplier.name}`,userId]);
      stockUpdates.push({ product_id: item.product_id, product_name: item.product_name_snapshot, qty_added: item.base_qty,
        base_unit: item.base_unit_snapshot, stock_after: updated.current_stock, stock_version: updated.stock_version });
    }
    return { status: 201, body: { success: true, data: { purchase, items, stockUpdates } } };
  });
}

function sourceAmounts(line) {
  const qty = decimal(line.qty, 3, 'issued quantity', { min: 1n });
  const base = decimal(line.base_qty, 3, 'issued base quantity', { min: 1n });
  const factor = decimal(line.conversion_value_snapshot, 4, 'issued conversion', { min: 1n });
  const cost = decimal(line.cost_price, 2);
  const amount = decimal(line.line_total, 2);
  if (!line.unit || !line.base_unit_snapshot || !line.product_name_snapshot || qty * factor % 10000n !== 0n ||
      qty * factor / 10000n !== base || round(cost * qty, 1000n) !== amount) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
  return { qty, base, amount };
}
async function verifyPurchase(client, purchase, lines) {
  try {
    if (purchase.contract_version !== 'phase3-v1' || purchase.status !== 'received' || !lines.length) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
    const sum = lines.reduce((value, line) => value + sourceAmounts(line).amount, 0n);
    if (sum !== decimal(purchase.total_amount, 2)) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
    const { rows: history } = await client.query(`SELECT r.*,
      (SELECT COUNT(*) FROM supplier_debit_notes d WHERE d.purchase_return_id=r.id) AS debit_count,
      (SELECT COUNT(*) FROM supplier_debit_notes d WHERE d.purchase_return_id=r.id AND d.supplier_id=r.supplier_id
        AND d.amount=r.total_amount AND d.contract_version='phase3-v1' AND d.status='outstanding') AS matching_debits
      FROM purchase_returns r WHERE r.purchase_id=$1 ORDER BY r.id`, [purchase.id]);
    const { rows: prior } = await client.query(`SELECT ri.* FROM purchase_return_items ri JOIN purchase_returns r ON r.id=ri.purchase_return_id
      WHERE r.purchase_id=$1 ORDER BY ri.id`, [purchase.id]);
    const { rows: returnedStock } = await client.query(`SELECT reference_id,product_id,movement_type,qty_in,qty_out
      FROM stock_ledger WHERE reference_type='purchase_return' AND reference_id=ANY($1::integer[])`, [history.map(header => header.id)]);
    const byId = new Map(lines.map(line => [line.id, line]));
    for (const header of history) {
      const items = prior.filter(item => item.purchase_return_id === header.id);
      if (header.contract_version !== 'phase3-v1' || header.supplier_id !== purchase.supplier_id || header.status !== 'posted' ||
          header.debit_count !== '1' || header.matching_debits !== '1' || !items.length ||
          items.reduce((value, item) => value + decimal(item.amount, 2), 0n) !== decimal(header.total_amount, 2)) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
      for (const item of items) {
        const source = byId.get(item.purchase_item_id);
        if (!source || item.product_id !== source.product_id || item.unit !== source.unit || item.base_unit_snapshot !== source.base_unit_snapshot ||
            decimal(item.unit_price, 2) !== decimal(source.cost_price, 2)) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
      }
      const expectedStock = new Map(), actualStock = new Map();
      for (const item of items) expectedStock.set(item.product_id, (expectedStock.get(item.product_id) || 0n) + decimal(item.base_qty, 3));
      for (const movement of returnedStock.filter(row => row.reference_id === header.id)) {
        if (movement.movement_type !== 'return_out' || decimal(movement.qty_in, 3) !== 0n) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
        actualStock.set(movement.product_id, (actualStock.get(movement.product_id) || 0n) + decimal(movement.qty_out, 3));
      }
      if (actualStock.size !== expectedStock.size || [...expectedStock].some(([id, quantity]) => actualStock.get(id) !== quantity)) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
    }
    for (const line of lines) {
      const amounts = sourceAmounts(line);
      let returned = 0n;
      for (const item of prior.filter(row => row.purchase_item_id === line.id)) {
        const qty = decimal(item.qty_returned, 3, 'return quantity', { min: 1n });
        const next = returned + qty;
        if (next > amounts.qty || amounts.base * qty % amounts.qty !== 0n ||
            decimal(item.base_qty, 3) !== amounts.base * qty / amounts.qty ||
            decimal(item.amount, 2) !== round(amounts.amount * next, amounts.qty) - round(amounts.amount * returned, amounts.qty)) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
        returned = next;
      }
      if (returned !== decimal(line.qty_returned, 3)) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
    }
    const { rows: movements } = await client.query(`SELECT product_id,qty_in,qty_out,movement_type FROM stock_ledger
      WHERE reference_type='purchase' AND reference_id=$1`, [purchase.id]);
    const received = new Map();
    for (const movement of movements) {
      if (movement.movement_type !== 'in' || decimal(movement.qty_out, 3) !== 0n) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
      received.set(movement.product_id, (received.get(movement.product_id) || 0n) + decimal(movement.qty_in, 3));
    }
    const expected = new Map();
    for (const line of lines) expected.set(line.product_id, (expected.get(line.product_id) || 0n) + decimal(line.base_qty, 3));
    if (received.size !== expected.size || [...expected].some(([id, quantity]) => received.get(id) !== quantity)) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
  } catch (error) {
    if (error.errorCode) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
    throw error;
  }
}
async function calculateReturn(client, intent) {
  const { rows: [purchase] } = await client.query('SELECT * FROM purchases WHERE id=$1 FOR UPDATE', [intent.purchase_id]);
  if (!purchase) fail('PURCHASE_NOT_FOUND', 404);
  const { rows: lines } = await client.query('SELECT * FROM purchase_items WHERE purchase_id=$1 ORDER BY id FOR UPDATE', [purchase.id]);
  await verifyPurchase(client, purchase, lines);
  if (intent.supplier_id !== undefined && intent.supplier_id !== purchase.supplier_id) fail('PURCHASE_RETURN_SUPPLIER_MISMATCH');
  const byId = new Map(lines.map(line => [line.id, line]));
  for (const item of intent.items) {
    const source = byId.get(item.purchase_item_id);
    if (!source) fail('INVALID_PURCHASE_RETURN_ITEM');
    if (item.product_id !== undefined && item.product_id !== source.product_id) fail('PURCHASE_RETURN_PRODUCT_MISMATCH');
    if (item.cost_price !== undefined && decimal(item.cost_price, 2) !== decimal(source.cost_price, 2)) fail('PURCHASE_RETURN_VALUE_MISMATCH');
    for (const field of ['unit', 'base_unit_snapshot']) if (item[field] !== undefined && item[field] !== source[field]) fail('PURCHASE_RETURN_VALUE_MISMATCH');
  }
  const products = await lockProducts(client, intent.items.map(item => byId.get(item.purchase_item_id).product_id));
  const supplier = await lockSupplier(client, purchase.supplier_id);
  const demand = new Map();
  let total = 0n;
  const items = intent.items.map(item => {
    const source = byId.get(item.purchase_item_id), amounts = sourceAmounts(source);
    const product = products.get(source.product_id);
    if ((product.base_unit || product.unit) !== source.base_unit_snapshot) fail('PURCHASE_RETURN_RECONCILIATION_REQUIRED');
    const qty = decimal(item.qty_returned, 3), before = decimal(source.qty_returned, 3), after = before + qty;
    if (after > amounts.qty) fail('PURCHASE_RETURN_QTY_EXCEEDS_ORIGINAL');
    if (amounts.base * qty % amounts.qty !== 0n) fail('UNREPRESENTABLE_QUANTITY');
    const base = amounts.base * qty / amounts.qty;
    if (item.base_qty !== undefined && decimal(item.base_qty, 3) !== base) fail('PURCHASE_RETURN_VALUE_MISMATCH');
    const amount = round(amounts.amount * after, amounts.qty) - round(amounts.amount * before, amounts.qty);
    total += amount;
    demand.set(product.id, (demand.get(product.id) || 0n) + base);
    return { purchase_item_id: source.id, product_id: source.product_id, product_name_snapshot: source.product_name_snapshot,
      qty_returned: item.qty_returned, qty_returned_before: source.qty_returned,
      remaining_qty: format(amounts.qty - before, 3), remaining_qty_after: format(amounts.qty - after, 3), unit: source.unit,
      base_qty: format(base, 3), base_unit_snapshot: source.base_unit_snapshot, cost_price: source.cost_price, amount: format(amount) };
  });
  const stock = [...products.values()].map(product => {
    const current = decimal(product.current_stock, 3), wanted = demand.get(product.id);
    if (wanted > current) fail('INSUFFICIENT_STOCK');
    return { product_id: product.id, stock_before: product.current_stock, stock_after: format(current - wanted, 3), stock_version: product.stock_version };
  });
  return { purchase, supplier, quote: hash({ purchase_id: purchase.id, supplier_id: supplier.id, supplier_name: supplier.name,
    return_date: intent.return_date, reason: intent.reason, items, total_amount: format(total), stock }) };
}
async function quotePurchaseReturn(purchaseId, input) {
  const intent = normalizeReturn(purchaseId, input);
  return quoteTransaction(client => calculateReturn(client, intent));
}
async function createPurchaseReturn(purchaseId, input, userId, key) {
  const intent = normalizeReturn(purchaseId, input);
  return withIdempotency({ actorId: userId, operation: 'purchase.return', key, intent }, async client => {
    const { quote, purchase, supplier } = await calculateReturn(client, intent);
    if (intent.quote_hash && intent.quote_hash !== quote.quote_hash) fail('PURCHASE_RETURN_QUOTE_CHANGED', 409);
    const { rows: [sequence] } = await client.query("SELECT nextval('purchase_return_seq') AS id");
    const { rows: [header] } = await client.query(`INSERT INTO purchase_returns(purchase_id,supplier_id,return_no,return_date,total_amount,reason,status,created_by,contract_version)
      VALUES($1,$2,$3,$4,$5,$6,'posted',$7,'phase3-v1') RETURNING *`,
    [purchase.id,supplier.id,`PR-${intent.return_date.slice(0,4)}-${String(sequence.id).padStart(5,'0')}`,intent.return_date,quote.total_amount,intent.reason,userId]);
    const items = [];
    for (const item of quote.items) {
      const { rows: [saved] } = await client.query(`INSERT INTO purchase_return_items(purchase_return_id,purchase_item_id,product_id,qty_returned,unit_price,amount,reason,base_qty,unit,base_unit_snapshot)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
      [header.id,item.purchase_item_id,item.product_id,item.qty_returned,item.cost_price,item.amount,intent.reason,item.base_qty,item.unit,item.base_unit_snapshot]);
      items.push(saved);
      const updated = await client.query(`UPDATE purchase_items SET qty_returned=qty_returned+$1 WHERE id=$2
        AND qty_returned=$3 AND qty_returned+$1<=qty RETURNING id`, [item.qty_returned,item.purchase_item_id,item.qty_returned_before]);
      if (!updated.rowCount) fail('PURCHASE_RETURN_QTY_EXCEEDS_ORIGINAL');
      const { rows: [stock] } = await client.query('UPDATE products SET current_stock=current_stock-$1,updated_at=NOW() WHERE id=$2 RETURNING current_stock', [item.base_qty,item.product_id]);
      await client.query(`INSERT INTO stock_ledger(product_id,date,movement_type,reference_id,reference_type,qty_in,qty_out,stock_after,notes,created_by)
        VALUES($1,$2,'return_out',$3,'purchase_return',0,$4,$5,$6,$7)`, [item.product_id,intent.return_date,header.id,item.base_qty,stock.current_stock,intent.reason,userId]);
    }
    const { rows: [debitSequence] } = await client.query("SELECT nextval('debit_note_seq') AS id");
    const { rows: [debitNote] } = await client.query(`INSERT INTO supplier_debit_notes(supplier_id,purchase_return_id,debit_note_no,amount,notes,status,created_by,contract_version)
      VALUES($1,$2,$3,$4,$5,'outstanding',$6,'phase3-v1') RETURNING *`,
    [supplier.id,header.id,`DN-${intent.return_date.slice(0,4)}-${String(debitSequence.id).padStart(5,'0')}`,quote.total_amount,intent.reason,userId]);
    return { status: 201, body: { success: true, data: { ...header, items, debit_note: debitNote } } };
  });
}

module.exports = { verifyPurchase, normalizePurchase, quotePurchase, createPurchaseWithStockIn, quotePurchaseReturn, createPurchaseReturn };
