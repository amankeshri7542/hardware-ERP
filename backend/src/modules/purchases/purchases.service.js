const { pool } = require('../../config/db');
const { createPurchaseWithStockIn, quotePurchase, createPurchaseReturn, quotePurchaseReturn } = require('./purchasePosting');

// ─── ALLOWED FIELDS FOR DYNAMIC UPDATE ────────────────────────────
const SUPPLIER_UPDATABLE = new Set([
  'name', 'phone', 'email', 'gstin', 'address', 'payment_terms', 'is_active',
]);

// ═══════════════════════════════════════════════════════════════════
// SUPPLIER CRUD
// ═══════════════════════════════════════════════════════════════════

async function createSupplier(data) {
  const { rows } = await pool.query(
    `INSERT INTO suppliers (name, phone, email, gstin, address, payment_terms)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id, name, phone, email, gstin, address, payment_terms, is_active, created_at`,
    [data.name, data.phone || null, data.email || null,
     data.gstin || null, data.address || null, data.payment_terms || null],
  );
  return rows[0];
}

async function getSuppliers({ search, isActive } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (search) {
    conditions.push(`name ILIKE $${idx++}`);
    values.push(`%${search}%`);
  }

  if (isActive !== undefined) {
    conditions.push(`is_active = $${idx++}`);
    values.push(isActive);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const { rows } = await pool.query(
    `SELECT id, name, phone, email, gstin, payment_terms, is_active, created_at
     FROM suppliers
     ${whereClause}
     ORDER BY name ASC`,
    values,
  );
  return rows;
}

async function getSupplierById(id) {
  const { rows } = await pool.query(
    `SELECT id, name, phone, email, gstin, address, payment_terms, is_active, created_at
     FROM suppliers WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

async function updateSupplier(id, data) {
  const fields = [];
  const values = [];
  let idx = 1;

  for (const [key, val] of Object.entries(data)) {
    if (SUPPLIER_UPDATABLE.has(key)) {
      fields.push(`${key} = $${idx++}`);
      values.push(val);
    }
  }

  if (fields.length === 0) {
    const error = new Error('No valid fields to update');
    error.statusCode = 422;
    error.errorCode = 'NO_FIELDS';
    throw error;
  }

  values.push(id);

  const { rows } = await pool.query(
    `UPDATE suppliers
     SET ${fields.join(', ')}
     WHERE id = $${idx}
     RETURNING id, name, phone, email, gstin, address, payment_terms, is_active`,
    values,
  );

  if (rows.length === 0) {
    const error = new Error('Supplier not found');
    error.statusCode = 404;
    error.errorCode = 'SUPPLIER_NOT_FOUND';
    throw error;
  }
  return rows[0];
}

// ═══════════════════════════════════════════════════════════════════
// PURCHASE / STOCK-IN — ATOMIC TRANSACTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Creates a purchase order and receives stock in a SINGLE transaction.
 * Steps inside the transaction:
 *   1. INSERT into purchases
 *   2. For each item:
 *      a. INSERT into purchase_items
 *      b. UPDATE products SET current_stock += qty, purchase_price = cost_price
 *      c. INSERT into stock_ledger
 *   3. COMMIT
 * If anything fails → ROLLBACK. client.release() is in finally.
 */

// ═══════════════════════════════════════════════════════════════════
// PURCHASE LISTING
// ═══════════════════════════════════════════════════════════════════

async function getPurchases({ supplierId, from, to, page = 1, limit = 20 }) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (supplierId) {
    conditions.push(`p.supplier_id = $${idx++}`);
    values.push(supplierId);
  }
  if (from) {
    conditions.push(`p.date >= $${idx++}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`p.date <= $${idx++}`);
    values.push(to);
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT p.id) FROM purchases p ${whereClause}`,
    values,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const { rows } = await pool.query(
    `SELECT p.id, p.po_number, p.date, p.total_amount, p.status,
            s.name AS supplier_name, p.created_at,
            COUNT(pi.id) AS item_count
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id
     LEFT JOIN purchase_items pi ON pi.purchase_id = p.id
     ${whereClause}
     GROUP BY p.id, p.po_number, p.date, p.total_amount, p.status,
              s.name, p.created_at
     ORDER BY p.date DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    values,
  );

  return { purchases: rows, total };
}

async function getPurchaseById(id) {
  const purchaseResult = await pool.query(
    `SELECT p.id, p.po_number, p.date, p.total_amount, p.status,
            p.notes, p.contract_version, p.invoice_file_url, p.created_at,
            s.name AS supplier_name, s.id AS supplier_id
     FROM purchases p
     JOIN suppliers s ON s.id = p.supplier_id
     WHERE p.id = $1`,
    [id],
  );

  if (purchaseResult.rows.length === 0) return null;

  const purchase = purchaseResult.rows[0];

  const itemsResult = await pool.query(
    `SELECT pi.id, pi.product_id, pi.qty, pi.unit, pi.cost_price, pi.line_total,
            pi.base_qty,pi.base_unit_snapshot,pi.conversion_value_snapshot,pi.product_name_snapshot,pi.qty_returned,
            COALESCE(pi.product_name_snapshot,pr.name) AS product_name, pr.current_stock
     FROM purchase_items pi
     JOIN products pr ON pr.id = pi.product_id
     WHERE pi.purchase_id = $1
     ORDER BY pi.id ASC`,
    [id],
  );

  return { ...purchase, items: itemsResult.rows };
}

// ═══════════════════════════════════════════════════════════════════
// SUPPLIER DETAIL: Products & Debit Notes
// ═══════════════════════════════════════════════════════════════════

async function getSupplierProducts(supplierId) {
  const { rows } = await pool.query(
    `SELECT ps.id, ps.product_id, p.name AS product_name, p.sku, p.category,
            p.unit, p.current_stock, ps.last_price, ps.last_unit, ps.last_purchase_date,
            ps.is_primary_supplier
     FROM product_suppliers ps
     JOIN products p ON p.id = ps.product_id
     WHERE ps.supplier_id = $1
     ORDER BY p.name ASC`,
    [supplierId],
  );
  return rows;
}

async function getSupplierDebitNotes(supplierId) {
  const { rows } = await pool.query(
    `SELECT sdn.id, sdn.debit_note_no AS debit_note_number, sdn.created_at AS date, sdn.amount AS total_amount,
            sdn.notes AS reason, sdn.status, sdn.purchase_return_id, sdn.created_at
     FROM supplier_debit_notes sdn
     WHERE sdn.supplier_id = $1
     ORDER BY sdn.created_at DESC, sdn.id DESC`,
    [supplierId],
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
// PURCHASE RETURNS
// ═══════════════════════════════════════════════════════════════════


async function getPurchaseReturns(purchaseId) {
  const { rows } = await pool.query(
    `SELECT pr.id, pr.purchase_id, pr.return_no, pr.supplier_id, pr.return_date AS date, pr.total_amount, pr.status, pr.contract_version, pr.reason, pr.created_at,
      COALESCE((SELECT json_agg(json_build_object('id',d.id,'debit_note_no',d.debit_note_no,'amount',d.amount::text,'status',d.status) ORDER BY d.id)
        FROM supplier_debit_notes d WHERE d.purchase_return_id=pr.id),'[]'::json) AS debit_notes
     FROM purchase_returns pr
     WHERE pr.purchase_id = $1
     ORDER BY pr.return_date DESC`,
    [purchaseId],
  );

  // Get items for each return
  for (const ret of rows) {
    const items = await pool.query(
      `SELECT pri.id, pri.product_id, COALESCE(pi.product_name_snapshot,p.name) AS product_name, pri.purchase_item_id,pri.base_qty,pri.unit,pri.base_unit_snapshot,pri.amount,
              pri.qty_returned, pri.unit_price AS cost_price
       FROM purchase_return_items pri
       JOIN products p ON p.id = pri.product_id
       LEFT JOIN purchase_items pi ON pi.id=pri.purchase_item_id
       WHERE pri.purchase_return_id = $1`,
      [ret.id],
    );
    ret.items = items.rows;
  }

  return rows;
}

/**
 * Update only the notes field on a purchase.
 * Items/quantities cannot be edited after stock has been received.
 */
async function updatePurchaseNotes(id, notes) {
  const { rows } = await pool.query(
    `UPDATE purchases SET notes = $1 WHERE id = $2
     RETURNING id, po_number, notes`,
    [notes, id],
  );
  if (rows.length === 0) {
    const error = new Error('Purchase not found');
    error.statusCode = 404;
    error.errorCode = 'PURCHASE_NOT_FOUND';
    throw error;
  }
  return rows[0];
}

async function updatePurchaseInvoiceUrl(id, fileUrl) {
  const { rows } = await pool.query(
    `UPDATE purchases SET invoice_file_url = $1 WHERE id = $2
     RETURNING id, invoice_file_url`,
    [fileUrl, id],
  );
  return rows[0] || null;
}

module.exports = {
  createSupplier,
  getSuppliers,
  getSupplierById,
  updateSupplier,
  createPurchaseWithStockIn,
  quotePurchase,
  getPurchases,
  getPurchaseById,
  updatePurchaseNotes,
  updatePurchaseInvoiceUrl,
  getSupplierProducts,
  getSupplierDebitNotes,
  createPurchaseReturn,
  quotePurchaseReturn,
  getPurchaseReturns,
};
