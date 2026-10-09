const { fail } = require('./financial');

// Caller holds the original invoice lock; linked credits/applications are immutable.
async function requireReconciledInvoice(client, invoiceId) {
  let effects;
  try { effects = await require('../modules/settlements/customerEvidence').invoiceEffects(client, invoiceId); }
  catch (error) { if (error.errorCode) fail('INVOICE_RECONCILIATION_REQUIRED'); throw error; }
  const { rows: [history] } = await client.query(`
    WITH return_sources AS (
      SELECT credit_invoice_id,original_invoice_id,customer_id,total_credit,applied_amount,unapplied_amount FROM sales_return_applications
      UNION ALL SELECT credit_invoice_id,original_invoice_id,NULL::integer,amount,0::numeric,amount FROM anonymous_return_liabilities
    )
    SELECT i.document_kind IS DISTINCT FROM 'sales_return'
      AND i.grand_total >= 0 AND i.amount_paid >= 0 AND i.balance_due >= 0
      AND i.amount_paid + i.balance_due + $2::numeric + COALESCE((SELECT SUM(a.applied_amount)
        FROM sales_return_applications a WHERE a.original_invoice_id=i.id),0) = i.grand_total
      AND (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id) - $3::numeric = i.amount_paid
      AND (SELECT COUNT(*) FROM customer_ledger l WHERE l.reference_type='invoice' AND l.reference_id=i.id) = CASE WHEN i.customer_id IS NULL THEN 0 ELSE 1 END
      AND NOT EXISTS (SELECT 1 FROM customer_ledger l WHERE l.reference_type='invoice' AND l.reference_id=i.id
        AND (l.customer_id IS DISTINCT FROM i.customer_id OR l.entry_type <> 'invoice'
          OR l.credit <> 0 OR l.debit IS DISTINCT FROM i.grand_total))
      AND NOT EXISTS (
        SELECT 1 FROM payments p WHERE p.invoice_id=i.id AND (
          p.customer_id IS DISTINCT FROM i.customer_id OR p.amount <= 0
          OR p.mode NOT IN ('cash','upi','bank','cheque','mixed')
          OR (SELECT COUNT(*) FROM customer_ledger l WHERE l.reference_type='payment' AND l.reference_id=p.id) <> CASE WHEN i.customer_id IS NULL THEN 0 ELSE 1 END
          OR (SELECT COALESCE(SUM(l.credit),0) FROM customer_ledger l WHERE l.reference_type='payment' AND l.reference_id=p.id) <> CASE WHEN i.customer_id IS NULL THEN 0 ELSE p.amount END
          OR EXISTS (SELECT 1 FROM customer_ledger l WHERE l.reference_type='payment' AND l.reference_id=p.id
            AND (l.customer_id IS DISTINCT FROM i.customer_id OR l.entry_type <> 'payment' OR l.debit <> 0 OR l.credit <= 0))
          OR EXISTS (SELECT 1 FROM payment_modes_detail d WHERE d.payment_id=p.id
            AND (d.amount <= 0 OR d.mode NOT IN ('cash','upi','bank','cheque') OR (p.mode <> 'mixed' AND d.mode <> p.mode)))
          OR ((p.mode='mixed' OR EXISTS (SELECT 1 FROM payment_modes_detail d WHERE d.payment_id=p.id))
            AND (SELECT COALESCE(SUM(d.amount),0) FROM payment_modes_detail d WHERE d.payment_id=p.id) <> p.amount)
        ))
      AND NOT EXISTS (
        SELECT 1 FROM invoices c LEFT JOIN return_sources a ON a.credit_invoice_id=c.id
        WHERE c.original_invoice_id=i.id AND (a.credit_invoice_id IS NULL OR a.original_invoice_id<>i.id
          OR (SELECT COUNT(*) FROM return_sources x WHERE x.credit_invoice_id=c.id)<>1))
      AND NOT EXISTS (
        SELECT 1 FROM return_sources a JOIN invoices c ON c.id=a.credit_invoice_id
        WHERE a.original_invoice_id=i.id AND (
          a.customer_id IS DISTINCT FROM i.customer_id OR c.customer_id IS DISTINCT FROM i.customer_id
          OR c.original_invoice_id IS DISTINCT FROM i.id OR c.document_kind IS DISTINCT FROM 'sales_return'
          OR c.contract_version IS DISTINCT FROM 'phase3-v1'
          OR c.grand_total IS DISTINCT FROM -a.total_credit OR c.amount_paid IS DISTINCT FROM 0::numeric
          OR c.balance_due IS DISTINCT FROM 0::numeric OR c.status <> 'paid'
          OR a.total_credit <> a.applied_amount+a.unapplied_amount
          OR a.total_credit < 0 OR a.applied_amount < 0 OR a.unapplied_amount < 0
          OR (SELECT COUNT(*) FROM customer_ledger l WHERE l.reference_type='invoice' AND l.reference_id=c.id) <> CASE WHEN i.customer_id IS NULL THEN 0 ELSE 1 END
          OR (i.customer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM customer_ledger l WHERE l.reference_type='invoice' AND l.reference_id=c.id
              AND l.customer_id=i.customer_id AND l.entry_type='return' AND l.debit=0 AND l.credit=a.total_credit))
          OR EXISTS (SELECT 1 FROM payments p WHERE p.invoice_id=c.id)
          OR NOT EXISTS (SELECT 1 FROM invoice_items ci WHERE ci.invoice_id=c.id)
          OR EXISTS (SELECT 1 FROM invoice_items ci LEFT JOIN invoice_items oi ON oi.id=ci.original_invoice_item_id
            WHERE ci.invoice_id=c.id AND (oi.invoice_id IS DISTINCT FROM i.id OR ci.product_id IS DISTINCT FROM oi.product_id
              OR ci.qty>=0 OR ci.base_qty IS NULL OR ci.base_qty>=0 OR ci.base_unit_snapshot IS DISTINCT FROM oi.base_unit_snapshot
              OR ci.unit IS DISTINCT FROM oi.unit OR ci.rate IS DISTINCT FROM oi.rate
              OR ci.discount_pct IS DISTINCT FROM oi.discount_pct OR ci.discount_amount IS DISTINCT FROM oi.discount_amount
              OR ci.product_name_snapshot IS DISTINCT FROM oi.product_name_snapshot OR ci.hsn_snapshot IS DISTINCT FROM oi.hsn_snapshot
              OR ci.cost_price_snapshot IS DISTINCT FROM oi.cost_price_snapshot OR ci.gst_pct IS DISTINCT FROM oi.gst_pct
              OR ci.allocated_subtotal IS NULL OR ci.allocated_discount_total IS NULL
              OR ci.allocated_subtotal>0 OR ci.allocated_discount_total>0 OR ci.taxable_amount>0 OR ci.gst_amount>0
              OR ci.allocated_subtotal-ci.allocated_discount_total<>ci.taxable_amount
              OR ci.line_total<>ci.taxable_amount+ci.gst_amount))
          OR c.subtotal IS DISTINCT FROM (SELECT SUM(ci.allocated_subtotal) FROM invoice_items ci WHERE ci.invoice_id=c.id)
          OR c.discount_total IS DISTINCT FROM (SELECT SUM(ci.allocated_discount_total) FROM invoice_items ci WHERE ci.invoice_id=c.id)
          OR c.taxable_total IS DISTINCT FROM (SELECT SUM(ci.taxable_amount) FROM invoice_items ci WHERE ci.invoice_id=c.id)
          OR c.gst_total IS DISTINCT FROM (SELECT SUM(ci.gst_amount) FROM invoice_items ci WHERE ci.invoice_id=c.id)
          OR c.grand_total IS DISTINCT FROM (SELECT SUM(ci.line_total) FROM invoice_items ci WHERE ci.invoice_id=c.id)
          OR c.total_cost IS DISTINCT FROM (SELECT SUM(ci.taxable_amount-ci.line_profit) FROM invoice_items ci WHERE ci.invoice_id=c.id)
          OR c.profit_amount IS DISTINCT FROM (SELECT SUM(ci.line_profit) FROM invoice_items ci WHERE ci.invoice_id=c.id)
        ))
      AND NOT EXISTS (SELECT 1 FROM invoice_items oi WHERE oi.invoice_id=i.id AND (
        oi.qty_returned < 0 OR oi.qty_returned > oi.qty
        OR oi.qty_returned <> -(SELECT COALESCE(SUM(ci.qty),0) FROM invoice_items ci WHERE ci.original_invoice_item_id=oi.id)
        OR (oi.qty_returned > 0 AND (
          oi.qty <= 0 OR oi.base_qty IS NULL OR oi.base_unit_snapshot IS NULL
          OR oi.base_qty * oi.qty_returned / NULLIF(oi.qty,0) <>
            -(SELECT COALESCE(SUM(ci.base_qty),0) FROM invoice_items ci WHERE ci.original_invoice_item_id=oi.id)
          OR ROUND(oi.taxable_amount * oi.qty_returned / NULLIF(oi.qty,0),2) <>
            -(SELECT COALESCE(SUM(ci.taxable_amount),0) FROM invoice_items ci WHERE ci.original_invoice_item_id=oi.id)
          OR ROUND(oi.gst_amount * oi.qty_returned / NULLIF(oi.qty,0),2) <>
            -(SELECT COALESCE(SUM(ci.gst_amount),0) FROM invoice_items ci WHERE ci.original_invoice_item_id=oi.id)
          OR ROUND((oi.taxable_amount-oi.line_profit) * oi.qty_returned / NULLIF(oi.qty,0),2) <>
            -(SELECT COALESCE(SUM(ci.taxable_amount-ci.line_profit),0) FROM invoice_items ci WHERE ci.original_invoice_item_id=oi.id)
        )))) AS consistent FROM invoices i WHERE i.id=$1`, [invoiceId, effects.allocated, effects.reversedPayments]);
  if (!history?.consistent) fail('INVOICE_RECONCILIATION_REQUIRED');
  const { rows: [invoice] } = await client.query('SELECT customer_id FROM invoices WHERE id=$1', [invoiceId]);
  if (invoice.customer_id === null) {
    const { rows: payments } = await client.query('SELECT * FROM payments WHERE invoice_id=$1', [invoiceId]);
    try { for (const payment of payments) await require('../modules/settlements/customerEvidence').verifyReceipt(client, payment); }
    catch (error) { if (error.errorCode) fail('INVOICE_RECONCILIATION_REQUIRED'); throw error; }
  }
}

module.exports = { requireReconciledInvoice };
