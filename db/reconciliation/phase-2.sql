-- Read-only diagnostics. Differences require investigation, never automatic repair.
BEGIN TRANSACTION READ ONLY;

-- Customer balances vs append-only ledger. A balanced cache does not prove missing entries exist.
SELECT c.id, c.outstanding_balance, COALESCE(SUM(l.debit-l.credit),0) AS ledger_balance
FROM customers c LEFT JOIN customer_ledger l ON l.customer_id=c.id
GROUP BY c.id HAVING c.outstanding_balance <> COALESCE(SUM(l.debit-l.credit),0);

-- Item totals vs stored invoice total (including credit notes).
SELECT i.id, i.grand_total, COALESCE(SUM(ii.line_total),0) AS item_total
FROM invoices i LEFT JOIN invoice_items ii ON ii.invoice_id=i.id
GROUP BY i.id HAVING i.grand_total <> COALESCE(SUM(ii.line_total),0);

-- Recorded return counters beyond original sold quantities.
SELECT invoice_id, id AS invoice_item_id, qty, qty_returned
FROM invoice_items WHERE qty > 0 AND qty_returned > qty;

-- Payment split mismatches; an absent split is also a difference worth inspecting.
SELECT p.id, p.amount, COALESCE(SUM(d.amount),0) AS split_total
FROM payments p LEFT JOIN payment_modes_detail d ON d.payment_id=p.id
GROUP BY p.id HAVING p.amount <> COALESCE(SUM(d.amount),0);

-- Returned purchase products that were never on the referenced purchase.
SELECT r.id AS purchase_return_id, r.purchase_id, ri.product_id
FROM purchase_returns r JOIN purchase_return_items ri ON ri.purchase_return_id=r.id
WHERE NOT EXISTS (SELECT 1 FROM purchase_items pi WHERE pi.purchase_id=r.purchase_id AND pi.product_id=ri.product_id);

-- Latest recorded stock vs current stock, rather than assuming a complete opening ledger.
SELECT p.id, p.current_stock, latest.stock_after
FROM products p JOIN LATERAL (
  SELECT stock_after FROM stock_ledger s WHERE s.product_id=p.id ORDER BY s.id DESC LIMIT 1
) latest ON true WHERE p.current_stock <> latest.stock_after;

ROLLBACK;
