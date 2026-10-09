-- Read-only diagnostics, not a repair or settlement script. Investigate every difference.
BEGIN TRANSACTION READ ONLY;

-- Unknown identity is deliberately not backfilled from dates, sign, or current catalog.
SELECT id, invoice_no, document_kind, contract_version
FROM invoices WHERE document_kind IS NULL OR contract_version IS NULL;
SELECT p.id AS purchase_id, p.contract_version, pi.id AS purchase_item_id
FROM purchases p JOIN purchase_items pi ON pi.purchase_id=p.id
WHERE p.contract_version IS NULL OR pi.base_qty IS NULL OR pi.base_unit_snapshot IS NULL;

-- Actual receipts and applied return credits are distinct from remaining invoice debt.
WITH receipts AS (SELECT invoice_id,SUM(amount) AS amount FROM payments GROUP BY invoice_id),
credits AS (SELECT original_invoice_id,SUM(applied_amount) AS applied,SUM(unapplied_amount) AS unapplied
  FROM sales_return_applications GROUP BY original_invoice_id)
SELECT i.id,i.invoice_no,i.grand_total,i.amount_paid,COALESCE(r.amount,0) AS recorded_receipts,
  COALESCE(c.applied,0) AS applied_return_credit,COALESCE(c.unapplied,0) AS unapplied_customer_credit,i.balance_due,
  i.grand_total-COALESCE(r.amount,0)-COALESCE(c.applied,0)-i.balance_due AS difference
FROM invoices i LEFT JOIN receipts r ON r.invoice_id=i.id LEFT JOIN credits c ON c.original_invoice_id=i.id
WHERE i.document_kind='sale' OR (i.document_kind IS NULL AND i.grand_total>=0)
ORDER BY i.id;

-- Unapplied customer credits are liabilities/account credits, not cash-refund evidence.
SELECT a.id,a.original_invoice_id,a.credit_invoice_id,a.customer_id,a.total_credit,a.applied_amount,a.unapplied_amount,
  c.grand_total AS signed_credit_document,c.document_kind,c.amount_paid,c.balance_due,
  (SELECT COALESCE(SUM(l.credit-l.debit),0) FROM customer_ledger l
    WHERE l.reference_type='invoice' AND l.reference_id=c.id) AS ledger_credit
FROM sales_return_applications a JOIN invoices c ON c.id=a.credit_invoice_id ORDER BY a.id;

SELECT c.id AS credit_invoice_id,c.original_invoice_id
FROM invoices c LEFT JOIN sales_return_applications a ON a.credit_invoice_id=c.id
WHERE c.document_kind='sales_return' AND a.id IS NULL;

SELECT oi.invoice_id,oi.id,oi.qty,oi.qty_returned,-COALESCE(SUM(ci.qty),0) AS linked_returns,
  oi.base_qty,-COALESCE(SUM(ci.base_qty),0) AS returned_base_qty
FROM invoice_items oi LEFT JOIN invoice_items ci ON ci.original_invoice_item_id=oi.id
WHERE oi.qty>=0 GROUP BY oi.id
HAVING oi.qty_returned<>-COALESCE(SUM(ci.qty),0) OR oi.qty_returned>oi.qty OR oi.qty_returned<0;

SELECT c.id,c.outstanding_balance,COALESCE(SUM(l.debit-l.credit),0) AS ledger_balance
FROM customers c LEFT JOIN customer_ledger l ON l.customer_id=c.id GROUP BY c.id
HAVING c.outstanding_balance<>COALESCE(SUM(l.debit-l.credit),0);

-- An agreeing total does not prove a missing historical opening or old stock-unit meaning.
SELECT p.id,p.base_unit,p.current_stock,p.stock_version,
  COALESCE(SUM(l.qty_in-l.qty_out),0) AS ledger_quantity,
  p.current_stock-COALESCE(SUM(l.qty_in-l.qty_out),0) AS difference,
  COUNT(l.id) FILTER(WHERE l.reference_type='opening') AS opening_movements
FROM products p LEFT JOIN stock_ledger l ON l.product_id=p.id GROUP BY p.id ORDER BY p.id;

SELECT pi.purchase_id,pi.id,pi.qty,pi.qty_returned,COALESCE(SUM(ri.qty_returned),0) AS linked_returns
FROM purchase_items pi LEFT JOIN purchase_return_items ri ON ri.purchase_item_id=pi.id GROUP BY pi.id
HAVING pi.qty_returned<>COALESCE(SUM(ri.qty_returned),0) OR pi.qty_returned>pi.qty OR pi.qty_returned<0;

SELECT p.id,p.total_amount,COALESCE(SUM(pi.line_total),0) AS items_total
FROM purchases p LEFT JOIN purchase_items pi ON pi.purchase_id=p.id GROUP BY p.id
HAVING p.total_amount<>COALESCE(SUM(pi.line_total),0);

SELECT r.id,r.purchase_id,r.status,r.total_amount,
  (SELECT COUNT(*) FROM supplier_debit_notes d WHERE d.purchase_return_id=r.id) AS debit_note_count,
  (SELECT COALESCE(SUM(d.amount),0) FROM supplier_debit_notes d WHERE d.purchase_return_id=r.id) AS debit_note_amount,
  (SELECT COALESCE(SUM(ri.amount),0) FROM purchase_return_items ri WHERE ri.purchase_return_id=r.id) AS item_amount
FROM purchase_returns r ORDER BY r.id;

-- Outstanding supplier claims remain outside Phase 3 settlement support.
SELECT id,debit_note_no,purchase_return_id,supplier_id,amount,status
FROM supplier_debit_notes WHERE status='outstanding' ORDER BY id;
ROLLBACK;
