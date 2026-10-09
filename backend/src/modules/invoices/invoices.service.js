const { pool } = require('../../config/db');
const { createHash } = require('node:crypto');
const { disabledDocumentError } = require('../../utils/documentContainment');
const { decimal, format, fail } = require('../../utils/financial');
const { normalizeInvoice, baseQuantity, calculateInvoiceTotals } = require('./invoiceCalculation');
const { preparePayment, postPayment } = require('../payments/paymentPosting');
const { withIdempotency } = require('../../utils/idempotency');

function determinePaymentStatus(grandTotal, amountPaid) {
  const total = decimal(grandTotal, 2);
  const paid = decimal(amountPaid, 2);
  return paid >= total ? 'paid' : paid > 0n ? 'partial' : 'unpaid';
}

async function calculateQuote(client, data) {
  const ids = [...new Set(data.items.map(item => item.product_id))].sort((a, b) => a - b);
  const { rows: products } = await client.query(
    `SELECT id,name,hsn_code,base_unit,unit,gst_rate,purchase_price,current_stock,is_active
       FROM products WHERE id=ANY($1::integer[]) ORDER BY id FOR UPDATE`, [ids]);
  if (products.length !== ids.length || products.some(product => !product.is_active)) fail('PRODUCT_UNAVAILABLE');
  const { rows: conversions } = await client.query(
    `SELECT product_id,unit_name,conversion_value,is_sales_unit
       FROM product_unit_conversions WHERE product_id=ANY($1::integer[])
       ORDER BY product_id,id FOR SHARE`, [ids]);
  if (data.customer_id) {
    const { rows } = await client.query('SELECT id,is_active FROM customers WHERE id=$1 FOR UPDATE', [data.customer_id]);
    if (!rows[0]?.is_active) fail('CUSTOMER_UNAVAILABLE');
  }
  const byId = new Map(products.map(product => [product.id, product]));
  const demand = new Map();
  const lines = data.items.map(item => {
    const product = byId.get(item.product_id);
    const base = baseQuantity(item, product, conversions);
    demand.set(product.id, (demand.get(product.id) || 0n) + decimal(base, 3));
    return { ...item, base_qty: base, base_unit: product.base_unit || product.unit,
      product_name_snapshot: product.name, hsn_snapshot: product.hsn_code,
      gst_pct: format(decimal(product.gst_rate, 2, 'GST', { max: 2800n })),
      cost_price_snapshot: format(decimal(product.purchase_price, 2)) };
  });
  const failures = products.filter(product => demand.get(product.id) > decimal(product.current_stock, 3))
    .map(product => ({ product_id: product.id, product_name: product.name,
      requested: format(demand.get(product.id), 3), available: product.current_stock }));
  if (failures.length) {
    const error = new Error('Stock check failed');
    error.statusCode = 422; error.errorCode = 'INSUFFICIENT_STOCK'; error.failures = failures;
    throw error;
  }
  const { items, ...totals } = calculateInvoiceTotals(lines);
  const snapshot = { customer_id: data.customer_id, bill_type: data.bill_type, items, totals };
  const quoteHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
  const paid = decimal(data.payment.amount_paid, 2);
  return { ...snapshot, quote_hash: quoteHash, payment: { amount_paid: format(paid),
    balance_due: format(decimal(totals.grand_total, 2) - paid),
    status: determinePaymentStatus(totals.grand_total, data.payment.amount_paid) } };
}

async function quoteInvoice(input) {
  const data = normalizeInvoice(input);
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    return await calculateQuote(client, data);
  } finally {
    try { await client.query('ROLLBACK'); } finally { client.release(); }
  }
}

async function createInvoice(input, userId, key) {
  const data = normalizeInvoice(input);
  return withIdempotency({ actorId: userId, operation: 'invoice.create', key, intent: data }, async client => {
    const quote = await calculateQuote(client, data);
    if (data.quote_hash && data.quote_hash !== quote.quote_hash) fail('QUOTE_CHANGED', 409);
    const totals = quote.totals;
    const paid = decimal(data.payment.amount_paid, 2);
    const total = decimal(totals.grand_total, 2);
    if (paid > total) fail('PAYMENT_EXCEEDS_BALANCE');
    if (!data.customer_id && paid !== total) fail('ANONYMOUS_CREDIT_NOT_SUPPORTED');
    if (paid < total && (!data.payment.due_date || data.payment.due_date < data.date)) fail('DUE_DATE_REQUIRED');
    const payment = preparePayment({ amount: data.payment.amount_paid, modes: data.payment.modes });
    const { rows: [invoice] } = await client.query(
      `INSERT INTO invoices(customer_id,customer_name_walkin,bill_type,date,subtotal,discount_total,
        taxable_total,gst_total,grand_total,total_cost,profit_amount,profit_pct,amount_paid,balance_due,
        due_date,status,created_by,pdf_status,notes)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,'disabled',$18)
       RETURNING id,invoice_no`,
      [data.customer_id,data.customer_name_walkin,data.bill_type,data.date,totals.subtotal,totals.discount_total,
        totals.taxable_total,totals.gst_total,totals.grand_total,totals.total_cost,totals.profit_amount,totals.profit_pct,
        payment.amount,quote.payment.balance_due,paid < total ? data.payment.due_date : null,
        quote.payment.status,userId,data.notes]);
    for (const item of quote.items) {
      await client.query(
        `INSERT INTO invoice_items(invoice_id,product_id,product_name_snapshot,hsn_snapshot,qty,unit,
          rate,discount_pct,discount_amount,taxable_amount,gst_pct,gst_amount,line_total,
          cost_price_snapshot,line_profit,base_qty,base_unit_snapshot)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
        [invoice.id,item.product_id,item.product_name_snapshot,item.hsn_snapshot,item.qty,item.unit,
          item.rate,item.discount_pct,item.discount_amount,item.taxable_amount,item.gst_pct,item.gst_amount,
          item.line_total,item.cost_price_snapshot,item.line_profit,item.base_qty,item.base_unit]);
      const { rows: [stock] } = await client.query(
        'UPDATE products SET current_stock=current_stock-$1,updated_at=NOW() WHERE id=$2 RETURNING current_stock',
        [item.base_qty,item.product_id]);
      await client.query(
        `INSERT INTO stock_ledger(product_id,date,movement_type,reference_id,reference_type,
          qty_in,qty_out,stock_after,notes,created_by)
         VALUES($1,$2,'out',$3,'invoice',0,$4,$5,$6,$7)`,
        [item.product_id,data.date,invoice.id,item.base_qty,stock.current_stock,'Sale: invoice ' + invoice.invoice_no,userId]);
    }
    if (data.customer_id) {
      await client.query(
        `INSERT INTO customer_ledger(customer_id,date,entry_type,reference_id,reference_type,debit,credit,balance,description)
         VALUES($1,$2,'invoice',$3,'invoice',$4,0,0,$5)`,
        [data.customer_id,data.date,invoice.id,totals.grand_total,'Invoice ' + invoice.invoice_no]);
    }
    if (paid > 0n) {
      await postPayment(client, { customerId: data.customer_id, invoiceId: invoice.id, payment,
        paymentDate: data.date, notes: null, userId });
    }
    return { status: 201, body: { success: true, data: {
      invoice_id: invoice.id, invoice_no: invoice.invoice_no, grand_total: totals.grand_total,
      amount_paid: payment.amount, balance_due: quote.payment.balance_due, status: quote.payment.status,
      pdf_status: 'disabled', customer_id: data.customer_id, bill_type: data.bill_type,
      totals, items: quote.items,
    } } };
  });
}

async function getInvoiceById(id) {
  const invoiceResult = await pool.query(
    `SELECT
      i.id, i.invoice_no, i.customer_id, i.customer_name_walkin,
      i.bill_type, i.date, i.subtotal, i.discount_total,
      i.taxable_total, i.gst_total, i.grand_total, i.total_cost,
      i.profit_amount, i.profit_pct, i.amount_paid, i.balance_due,
      i.due_date, i.status, i.pdf_status, i.pdf_url,
      i.notes, i.created_by, i.created_at,
      c.name AS customer_name, c.phone AS customer_phone,
      c.gstin AS customer_gstin,
      u.name AS created_by_name
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    LEFT JOIN users u ON u.id = i.created_by
    WHERE i.id = $1`,
    [id]
  );

  if (invoiceResult.rows.length === 0) return null;

  const itemsResult = await pool.query(
    `SELECT
      ii.id, ii.invoice_id, ii.product_id, ii.product_name_snapshot,
      ii.hsn_snapshot, ii.qty, ii.unit, ii.rate, ii.discount_pct,
      ii.discount_amount, ii.taxable_amount, ii.gst_pct, ii.gst_amount,
      ii.line_total, ii.cost_price_snapshot, ii.line_profit,
       ii.alt_qty, ii.alt_unit, ii.base_qty, ii.base_unit_snapshot,
      p.name AS current_product_name, p.current_stock
    FROM invoice_items ii
    LEFT JOIN products p ON p.id = ii.product_id
    WHERE ii.invoice_id = $1
    ORDER BY ii.id ASC`,
    [id]
  );

  return {
    ...invoiceResult.rows[0],
    items: itemsResult.rows,
  };
}

/**
 * List invoices with filters and pagination.
 */
async function listInvoices({ customerId, customerSearch, from, to, status, billType, invoiceNo, page = 1, limit = 20 }) {
  const conditions = [];
  const params = [];
  let paramIndex = 1;

  if (customerId) {
    conditions.push(`i.customer_id = $${paramIndex++}`);
    params.push(customerId);
  }
  if (customerSearch) {
    conditions.push(`(c.name ILIKE $${paramIndex} OR c.phone ILIKE $${paramIndex} OR i.customer_name_walkin ILIKE $${paramIndex})`);
    params.push(`%${customerSearch}%`);
    paramIndex++;
  }
  if (from) {
    conditions.push(`i.date >= $${paramIndex++}`);
    params.push(from);
  }
  if (to) {
    conditions.push(`i.date <= $${paramIndex++}`);
    params.push(to);
  }
  if (status) {
    conditions.push(`i.status = $${paramIndex++}`);
    params.push(status);
  }
  if (billType) {
    conditions.push(`i.bill_type = $${paramIndex++}`);
    params.push(billType);
  }
  if (invoiceNo) {
    conditions.push(`i.invoice_no ILIKE $${paramIndex++}`);
    params.push(`%${invoiceNo}%`);
  }

  const whereClause = conditions.length > 0
    ? 'WHERE ' + conditions.join(' AND ')
    : '';

  const offset = (page - 1) * limit;

  const needsCustomerJoin = customerSearch ? 'LEFT JOIN customers c ON c.id = i.customer_id' : '';
  const countResult = await pool.query(
    `SELECT COUNT(*) AS total FROM invoices i ${needsCustomerJoin} ${whereClause}`,
    params
  );
  const total = parseInt(countResult.rows[0].total, 10);

  // Summary for the filtered set
  const summaryResult = await pool.query(
    `SELECT
      COALESCE(SUM(i.grand_total), 0) AS total_sales,
      COALESCE(SUM(i.gst_total), 0) AS total_gst,
      COALESCE(SUM(i.profit_amount), 0) AS total_profit
    FROM invoices i
    ${customerSearch ? 'LEFT JOIN customers c ON c.id = i.customer_id' : ''}
    ${whereClause}`,
    params
  );

  const dataParams = [...params, limit, offset];
  const invoicesResult = await pool.query(
    `SELECT
      i.id, i.invoice_no, i.customer_id, i.customer_name_walkin,
      i.bill_type, i.date, i.grand_total, i.amount_paid,
      i.balance_due, i.status, i.profit_amount, i.pdf_status, i.created_at,
      c.name AS customer_name, c.phone AS customer_phone
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    ${whereClause}
    ORDER BY i.created_at DESC
    LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
    dataParams
  );

  return {
    invoices: invoicesResult.rows,
    summary: summaryResult.rows[0],
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

/**
 * Get PDF generation status for an invoice.
 */
async function getPdfStatus() {
  throw disabledDocumentError('PDF');
}

async function getPresignedPdfUrl() {
  throw disabledDocumentError('PDF');
}

// ─── Returns / Credit notes ─────────────────────────────────────────

/**
 * Process a sales return as an atomic transaction.
 * Creates a credit note (negative invoice) and restores stock.
 */
async function processReturn(data, userId) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // Fetch original invoice with FOR UPDATE lock
    const origResult = await client.query(
      `SELECT id, invoice_no, customer_id, bill_type, date
       FROM invoices WHERE id = $1 FOR UPDATE`,
      [data.original_invoice_id]
    );
    if (origResult.rows.length === 0) {
      await client.query('ROLLBACK');
      const err = new Error('Original invoice not found');
      err.statusCode = 404;
      err.errorCode = 'INVOICE_NOT_FOUND';
      throw err;
    }
    const original = origResult.rows[0];

    // Fetch original invoice items for validation (locked via parent invoice FOR UPDATE)
    const origItemsResult = await client.query(
      `SELECT id, product_id, qty, unit, rate, discount_pct, discount_amount,
              gst_pct, cost_price_snapshot, product_name_snapshot, hsn_snapshot,
              alt_qty, alt_unit, base_qty, qty_returned
       FROM invoice_items WHERE invoice_id = $1`,
      [data.original_invoice_id]
    );
    const origItemsMap = new Map();
    for (const oi of origItemsResult.rows) {
      origItemsMap.set(oi.id, oi);
    }

    // Validate and process each returned item
    const returnItems = [];
    for (const item of data.items) {
      const origItem = origItemsMap.get(item.invoice_item_id);
      if (!origItem) {
        await client.query('ROLLBACK');
        const err = new Error(`Invoice item ${item.invoice_item_id} not found on original invoice`);
        err.statusCode = 422;
        err.errorCode = 'INVALID_RETURN_ITEM';
        throw err;
      }
      const alreadyReturned = parseFloat(origItem.qty_returned) || 0;
      const remainingReturnable = parseFloat(origItem.qty) - alreadyReturned;
      if (item.qty_returned > remainingReturnable) {
        await client.query('ROLLBACK');
        const err = new Error(
          `Return qty (${item.qty_returned}) exceeds returnable qty (${remainingReturnable}) for item ${item.invoice_item_id}. Already returned: ${alreadyReturned}`
        );
        err.statusCode = 422;
        err.errorCode = 'RETURN_QTY_EXCEEDS_ORIGINAL';
        throw err;
      }

      // Compute return base qty
      const returnRatio = item.qty_returned / parseFloat(origItem.qty);
      const returnBaseQty = origItem.base_qty ? parseFloat(origItem.base_qty) * returnRatio : item.qty_returned;

      // Restore stock
      const stockResult = await client.query(
        'UPDATE products SET current_stock = current_stock + $1, updated_at = NOW() WHERE id = $2 RETURNING current_stock',
        [returnBaseQty, item.product_id]
      );

      // Stock ledger entry
      await client.query(
        `INSERT INTO stock_ledger (
          product_id, date, movement_type, reference_id, reference_type,
          qty_in, qty_out, stock_after, notes, created_by
        ) VALUES ($1, NOW(), 'return_in', $2, 'return', $3, 0, $4, $5, $6)`,
        [
          item.product_id, data.original_invoice_id, returnBaseQty,
          parseFloat(stockResult.rows[0].current_stock),
          'Return against invoice ' + original.invoice_no,
          userId,
        ]
      );

      // Calculate return line totals using original item's pricing
      const origRate = parseFloat(origItem.rate) || 0;
      const discountAmount = parseFloat(origItem.discount_amount) || 0;
      const taxableAmount = parseFloat(((origRate - discountAmount) * returnBaseQty).toFixed(2));
      const gstAmount = parseFloat((taxableAmount * (parseFloat(origItem.gst_pct) / 100)).toFixed(2));
      const lineTotal = parseFloat((taxableAmount + gstAmount).toFixed(2));
      const lineProfit = parseFloat(((origRate - discountAmount - parseFloat(origItem.cost_price_snapshot)) * returnBaseQty).toFixed(2));

      returnItems.push({
        ...item,
        rate: origRate,
        product_name_snapshot: origItem.product_name_snapshot,
        hsn_snapshot: origItem.hsn_snapshot,
        discount_pct: parseFloat(origItem.discount_pct) || 0,
        discount_amount: discountAmount,
        taxable_amount: taxableAmount,
        gst_pct: parseFloat(origItem.gst_pct),
        gst_amount: gstAmount,
        line_total: lineTotal,
        cost_price_snapshot: parseFloat(origItem.cost_price_snapshot),
        line_profit: lineProfit,
        calc_qty: returnBaseQty,
        unit: origItem.unit,
        alt_unit: origItem.alt_unit,
      });
    }

    // Calculate credit note totals
    const returnSubtotal = returnItems.reduce((sum, i) => sum + parseFloat((i.rate * i.calc_qty).toFixed(2)), 0);
    const returnDiscountTotal = returnItems.reduce((sum, i) => sum + parseFloat((i.discount_amount * i.calc_qty).toFixed(2)), 0);
    const returnTaxableTotal = returnItems.reduce((sum, i) => sum + i.taxable_amount, 0);
    const returnGstTotal = returnItems.reduce((sum, i) => sum + i.gst_amount, 0);
    const returnGrandTotal = returnItems.reduce((sum, i) => sum + i.line_total, 0);
    const returnTotalCost = returnItems.reduce((sum, i) => sum + parseFloat((i.cost_price_snapshot * i.calc_qty).toFixed(2)), 0);
    const returnProfitAmount = parseFloat((returnTaxableTotal - returnTotalCost).toFixed(2));
    const returnProfitPct = returnTaxableTotal > 0
      ? parseFloat(((returnProfitAmount / returnTaxableTotal) * 100).toFixed(2))
      : 0;

    // INSERT credit note (negative grand_total)
    const creditNoteResult = await client.query(
      `INSERT INTO invoices (
        customer_id, customer_name_walkin, bill_type, date,
        subtotal, discount_total, taxable_total, gst_total,
        grand_total, total_cost, profit_amount, profit_pct,
        amount_paid, balance_due, status, pdf_status,
        created_by
      ) VALUES ($1,$2,$3,NOW(),$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16)
      RETURNING id, invoice_no`,
      [
        original.customer_id, null, original.bill_type,
        -parseFloat(returnSubtotal.toFixed(2)),
        -parseFloat(returnDiscountTotal.toFixed(2)),
        -parseFloat(returnTaxableTotal.toFixed(2)),
        -parseFloat(returnGstTotal.toFixed(2)),
        -parseFloat(returnGrandTotal.toFixed(2)),
        -parseFloat(returnTotalCost.toFixed(2)),
        -parseFloat(returnProfitAmount.toFixed(2)),
        returnProfitPct,
        0, 0, 'paid', 'pending',
        userId,
      ]
    );
    const creditNote = creditNoteResult.rows[0];

    // INSERT credit note items and update qty_returned on original items
    for (const item of returnItems) {
      await client.query(
        `INSERT INTO invoice_items (
          invoice_id, product_id, product_name_snapshot, hsn_snapshot,
          qty, unit, rate, discount_pct, discount_amount,
          taxable_amount, gst_pct, gst_amount, line_total,
          cost_price_snapshot, line_profit, alt_qty, alt_unit, base_qty
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [
          creditNote.id, item.product_id, item.product_name_snapshot,
          item.hsn_snapshot || null,
          -item.qty_returned, item.unit, item.rate,
          item.discount_pct, item.discount_amount,
          -item.taxable_amount, item.gst_pct, -item.gst_amount, -item.line_total,
          item.cost_price_snapshot, -item.line_profit,
          item.alt_unit ? -item.qty_returned : null, item.alt_unit || null, item.alt_unit ? -item.calc_qty : null
        ]
      );

      // Track cumulative returned qty on the original invoice item
      await client.query(
        `UPDATE invoice_items SET qty_returned = qty_returned + $1 WHERE id = $2`,
        [item.qty_returned, item.invoice_item_id]
      );
    }

    // Customer ledger credit entry (if customer exists and not quickbill)
    if (original.customer_id && original.bill_type !== 'quickbill') {
      await client.query(
        `INSERT INTO customer_ledger (
          customer_id, date, entry_type, reference_id, reference_type,
          debit, credit, balance, description
        ) VALUES ($1, NOW(), 'return', $2, 'invoice', 0, $3, 0, $4)`,
        [
          original.customer_id, creditNote.id,
          parseFloat(returnGrandTotal.toFixed(2)),
          'Credit note ' + creditNote.invoice_no + ' against ' + original.invoice_no,
        ]
      );
      // balance updated by trigger (fn_sync_customer_outstanding)
    }

    // Update original invoice's balance_due to reflect the return
    // NOTE: Do NOT modify grand_total — the credit note already has negative grand_total,
    // so reports (SUM of grand_total) automatically account for the return.
    const origInvResult = await client.query(
      'SELECT balance_due, amount_paid FROM invoices WHERE id = $1 FOR UPDATE',
      [data.original_invoice_id]
    );
    if (origInvResult.rows.length > 0) {
      const origInv = origInvResult.rows[0];
      const returnAmount = parseFloat(returnGrandTotal.toFixed(2));
      const newBalanceDue = Math.max(0, parseFloat((parseFloat(origInv.balance_due) - returnAmount).toFixed(2)));
      const paidAmt = parseFloat(origInv.amount_paid) || 0;
      const newStatus = newBalanceDue <= 0 ? 'paid' : (paidAmt > 0 ? 'partial' : 'unpaid');
      await client.query(
        `UPDATE invoices SET balance_due = $1, status = $2 WHERE id = $3`,
        [newBalanceDue, newStatus, data.original_invoice_id]
      );
    }

    await client.query('COMMIT');

    return {
      credit_note_id: creditNote.id,
      credit_note_no: creditNote.invoice_no,
      original_invoice_id: original.id,
      original_invoice_no: original.invoice_no,
      grand_total: -parseFloat(returnGrandTotal.toFixed(2)),
      items_returned: returnItems.length,
    };
  } catch (err) {
    if (client && !err.errorCode) {
      try { await client.query('ROLLBACK'); } catch (_) {}
    }
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Generate PDF directly (fallback when Redis/BullMQ is unavailable).
 * Same logic as pdfWorker but runs in the API process.
 */
async function generatePdfDirect() {
  throw disabledDocumentError('PDF');
}

module.exports = {
  calculateInvoiceTotals,
  determinePaymentStatus,
  createInvoice,
  quoteInvoice,
  getInvoiceById,
  listInvoices,
  getPdfStatus,
  getPresignedPdfUrl,
  processReturn,
  generatePdfDirect,
};
