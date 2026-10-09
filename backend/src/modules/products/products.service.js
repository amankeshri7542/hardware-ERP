const { pool } = require('../../config/db');

// ─── Column lists (no SELECT *) ───────────────────────────────────
const PRODUCT_COLUMNS = `
  id, name, category, brand, sku, barcode, unit, base_unit, hsn_code,
  gst_rate, mrp, wholesale_price, purchase_price,
  current_stock, min_stock, is_active, stock_version, catalog_version, created_at, updated_at
`;

/**
 * List products with filters & pagination.
 */
async function getAllProducts({ search, category, isActive, lowStockOnly, page = 1, limit = 20 }) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (search && search.trim()) {
    conditions.push(`(p.name ILIKE $${idx} OR p.sku ILIKE $${idx} OR p.barcode ILIKE $${idx} OR p.category ILIKE $${idx})`);
    values.push(`%${search.trim()}%`);
    idx++;
  }

  if (category) {
    conditions.push(`p.category = $${idx++}`);
    values.push(category);
  }

  if (isActive !== undefined) {
    conditions.push(`p.is_active = $${idx++}`);
    values.push(isActive);
  }

  if (lowStockOnly) {
    conditions.push('p.current_stock < p.min_stock');
  }

  const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Total count
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM products p ${whereClause}`,
    values,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Paginated results with unit conversions
  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const result = await pool.query(
    `SELECT p.id, p.name, p.category, p.brand, p.sku, p.barcode, p.unit, p.base_unit,
       p.hsn_code, p.gst_rate, p.mrp, p.wholesale_price, p.purchase_price,
       p.current_stock, p.min_stock, p.is_active, p.stock_version, p.catalog_version, p.created_at, p.updated_at,
       (SELECT json_agg(json_build_object(
          'id', uc.id, 'unit_name', uc.unit_name,
          'conversion_value', uc.conversion_value
        )) FROM product_unit_conversions uc WHERE uc.product_id = p.id
       ) AS unit_conversions
     FROM products p
     ${whereClause}
     ORDER BY p.name ASC
     LIMIT $${idx++} OFFSET $${idx++}`,
    values,
  );

  return { products: result.rows, total };
}

/**
 * Get a single product by ID.
 */
async function getProductById(id) {
  const { rows } = await pool.query(
    `SELECT ${PRODUCT_COLUMNS},
      (SELECT COALESCE(json_agg(json_build_object('id',c.id,'unit_name',c.unit_name,
        'conversion_value',c.conversion_value::text,'is_sales_unit',c.is_sales_unit,
        'is_purchase_unit',c.is_purchase_unit) ORDER BY c.id),'[]'::json)
       FROM product_unit_conversions c WHERE c.product_id=products.id) AS conversions
     FROM products WHERE id = $1`,
    [id],
  );
  return rows[0] || null;
}

/**
 * Create a new product.
 * Handles pg 23505 (unique violation) for sku/barcode.
 */
const { createProduct, updateProduct, adjustStock } = require('./catalogPosting');

async function softDeleteProduct(id) {
  // Check for billing history
  const historyCheck = await pool.query(
    `SELECT COUNT(*) FROM invoice_items WHERE product_id = $1`,
    [id],
  );
  if (parseInt(historyCheck.rows[0].count, 10) > 0) {
    const error = new Error('Cannot delete — product has billing history. Deactivate instead.');
    error.statusCode = 422;
    error.errorCode = 'PRODUCT_HAS_HISTORY';
    throw error;
  }

  const { rows } = await pool.query(
    `UPDATE products SET is_active = false, updated_at = NOW()
     WHERE id = $1
     RETURNING id, name`,
    [id],
  );

  if (rows.length === 0) {
    const error = new Error('Product not found');
    error.statusCode = 404;
    error.errorCode = 'PRODUCT_NOT_FOUND';
    throw error;
  }
  return rows[0];
}

/**
 * Get stock ledger entries for a product with date range filter.
 */
async function getProductStockLedger(productId, { from, to, page = 1, limit = 20 }) {
  const values = [productId, from || null, to || null];
  let idx = 4;

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM stock_ledger
     WHERE product_id = $1
       AND ($2::date IS NULL OR date >= $2)
       AND ($3::date IS NULL OR date <= $3)`,
    values,
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const offset = (page - 1) * limit;

  const { rows } = await pool.query(
    `SELECT sl.id, sl.date, sl.movement_type, sl.qty_in, sl.qty_out,
            sl.stock_after, sl.notes, sl.reference_type, sl.reference_id,
            u.name AS created_by_name
     FROM stock_ledger sl
     LEFT JOIN users u ON u.id = sl.created_by
     WHERE sl.product_id = $1
       AND ($2::date IS NULL OR sl.date >= $2)
       AND ($3::date IS NULL OR sl.date <= $3)
     ORDER BY sl.date DESC, sl.id DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    [...values, limit, offset],
  );

  return { entries: rows, total };
}

/**
 * Get products where current_stock < min_stock.
 */
async function getLowStockProducts() {
  const { rows } = await pool.query(
    `SELECT id, name, sku, category, unit, current_stock, min_stock, mrp
     FROM products
     WHERE current_stock < min_stock AND is_active = true
     ORDER BY (min_stock - current_stock) DESC`,
  );
  return rows;
}

/**
 * Count of low-stock products (for dashboard badge).
 */
async function getLowStockCount() {
  const { rows } = await pool.query(
    `SELECT COUNT(*) FROM products
     WHERE current_stock < min_stock AND is_active = true`,
  );
  return parseInt(rows[0].count, 10);
}

// ═══════════════════════════════════════════════════════════════════
// PRICE HISTORY
// ═══════════════════════════════════════════════════════════════════

async function getProductPriceHistory(productId) {
  const { rows } = await pool.query(
    `SELECT pph.id, pph.effective_from, pph.purchase_price, pph.wholesale_price,
            pph.mrp, pph.source, pph.created_at,
            u.name AS changed_by_name
     FROM product_price_history pph
     LEFT JOIN users u ON u.id = pph.changed_by
     WHERE pph.product_id = $1
     ORDER BY pph.effective_from DESC, pph.id DESC`,
    [productId],
  );
  return rows;
}

// ═══════════════════════════════════════════════════════════════════
// PRODUCT SUPPLIERS
// ═══════════════════════════════════════════════════════════════════

async function getProductSuppliers(productId) {
  const { rows } = await pool.query(
    `SELECT ps.id, ps.supplier_id, s.name AS supplier_name, s.phone AS supplier_phone,
            ps.last_price, ps.last_purchase_date, ps.is_primary_supplier
     FROM product_suppliers ps
     JOIN suppliers s ON s.id = ps.supplier_id
     WHERE ps.product_id = $1
     ORDER BY ps.is_primary_supplier DESC, s.name ASC`,
    [productId],
  );
  return rows;
}

async function linkProductSupplier(productId, data) {
  const { rows } = await pool.query(
    `INSERT INTO product_suppliers (product_id, supplier_id, last_price, is_primary_supplier)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (product_id, supplier_id)
     DO UPDATE SET last_price = EXCLUDED.last_price,
                   is_primary_supplier = EXCLUDED.is_primary_supplier
     RETURNING id, product_id, supplier_id, last_price, is_primary_supplier`,
    [productId, data.supplier_id, data.last_price || 0, data.is_primary_supplier || false],
  );
  return rows[0];
}

// ═══════════════════════════════════════════════════════════════════
// UNIT CONVERSIONS
// ═══════════════════════════════════════════════════════════════════

async function getUnitConversions(productId) {
  const { rows } = await pool.query(
    `SELECT id, product_id, unit_name, conversion_value, is_purchase_unit, is_sales_unit
     FROM product_unit_conversions
     WHERE product_id = $1
     ORDER BY unit_name ASC`,
    [productId],
  );
  return rows;
}

async function createUnitConversion() { require('../../utils/financial').fail('ATOMIC_CATALOG_UPDATE_REQUIRED'); }
async function deleteUnitConversion() { require('../../utils/financial').fail('ATOMIC_CATALOG_UPDATE_REQUIRED'); }

/**
 * Unlink a supplier from a product.
 */
async function unlinkProductSupplier(productId, linkId) {
  const { rowCount } = await pool.query(
    `DELETE FROM product_suppliers WHERE id = $1 AND product_id = $2`,
    [linkId, productId],
  );
  if (rowCount === 0) {
    const error = new Error('Product-supplier link not found');
    error.statusCode = 404;
    error.errorCode = 'PRODUCT_SUPPLIER_NOT_FOUND';
    throw error;
  }
}

module.exports = {
  getAllProducts,
  getProductById,
  createProduct,
  adjustStock,
  updateProduct,
  softDeleteProduct,
  getProductStockLedger,
  getLowStockProducts,
  getLowStockCount,
  getProductPriceHistory,
  getProductSuppliers,
  linkProductSupplier,
  unlinkProductSupplier,
  getUnitConversions,
  createUnitConversion,
  deleteUnitConversion,
};
