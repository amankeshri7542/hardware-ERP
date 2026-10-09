-- Diagnostic only. No repairs, opening balances, source enrollment or journal adoption.
BEGIN READ ONLY;

-- Each query returns discrepancies. A clean supported scenario returns zero rows.
WITH effective AS (
 SELECT e.*,CASE WHEN r.id IS NULL THEN e.amount ELSE 0 END AS active_amount
 FROM settlement_events e LEFT JOIN settlement_events r ON r.reverses_event_id=e.id
), projections AS (
 SELECT i.id,i.customer_id,i.grand_total,i.amount_paid,i.balance_due,
  COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id=i.id),0)
   -COALESCE((SELECT SUM(e.amount) FROM settlement_events e JOIN payments p ON p.id=e.source_id
    WHERE e.kind='payment_reversal' AND p.invoice_id=i.id),0) AS receipts,
  COALESCE((SELECT SUM(a.applied_amount) FROM sales_return_applications a WHERE a.original_invoice_id=i.id),0)
   +COALESCE((SELECT SUM(l.amount) FROM settlement_lines l JOIN effective e ON e.id=l.event_id
     WHERE l.target_type='invoice' AND l.target_id=i.id AND e.kind='customer_allocation' AND e.active_amount>0),0) AS credits
 FROM invoices i WHERE i.document_kind='sale'
) SELECT 'invoice_projection' AS issue,* FROM projections
 WHERE amount_paid<>receipts OR grand_total<>receipts+credits+balance_due OR balance_due<0;

SELECT 'customer_cache' AS issue,c.id,c.outstanding_balance,COALESCE(SUM(l.debit-l.credit),0) AS ledger
 FROM customers c LEFT JOIN customer_ledger l ON l.customer_id=c.id GROUP BY c.id
 HAVING c.outstanding_balance<>COALESCE(SUM(l.debit-l.credit),0);
SELECT 'stock_projection' AS issue,p.id,p.current_stock,COALESCE(SUM(l.qty_in-l.qty_out),0) AS ledger
 FROM products p LEFT JOIN stock_ledger l ON l.product_id=p.id GROUP BY p.id
 HAVING p.current_stock<>COALESCE(SUM(l.qty_in-l.qty_out),0) OR p.current_stock<0;

WITH sources AS (
 SELECT 'advance'::text AS type,id,amount FROM payments WHERE invoice_id IS NULL AND customer_id IS NOT NULL
 UNION ALL SELECT 'return_credit',id,unapplied_amount FROM sales_return_applications
 UNION ALL SELECT 'anonymous_liability',id,amount FROM anonymous_return_liabilities
 UNION ALL SELECT 'debit',id,amount FROM supplier_debit_notes WHERE contract_version='phase3-v1'
), consumed AS (
 SELECT e.source_type,e.source_id,SUM(e.amount) AS amount FROM settlement_events e
 WHERE e.kind IN ('customer_allocation','customer_refund','anonymous_refund','supplier_debit_application','supplier_refund')
 AND NOT EXISTS(SELECT 1 FROM settlement_events r WHERE r.reverses_event_id=e.id)
 GROUP BY e.source_type,e.source_id
) SELECT 'source_overconsumption' AS issue,s.type,s.id,s.amount AS recognized,c.amount AS consumed
 FROM sources s JOIN consumed c ON c.source_type=s.type AND c.source_id=s.id WHERE c.amount>s.amount
 UNION ALL SELECT 'unknown_consumed_source',c.source_type,c.source_id,NULL,c.amount FROM consumed c
 WHERE NOT EXISTS(SELECT 1 FROM sources s WHERE s.type=c.source_type AND s.id=c.source_id);

WITH due AS (
 SELECT p.id,p.amount,
  COALESCE((SELECT SUM(l.amount) FROM settlement_lines l JOIN settlement_events e ON e.id=l.event_id
   WHERE l.target_type='payable' AND l.target_id=p.id AND e.kind IN ('supplier_payment','supplier_debit_application')
   AND NOT EXISTS(SELECT 1 FROM settlement_events r WHERE r.reverses_event_id=e.id)),0) AS consumed,
  EXISTS(SELECT 1 FROM settlement_events r WHERE r.kind='payable_reversal' AND r.source_id=p.id) AS reversed
 FROM supplier_payables p
) SELECT 'payable_overconsumption' AS issue,* FROM due WHERE consumed>amount OR (reversed AND consumed<>0);

SELECT 'settlement_lines' AS issue,e.id,e.kind,e.amount,COALESCE(SUM(l.amount),0) AS line_amount
 FROM settlement_events e LEFT JOIN settlement_lines l ON l.event_id=e.id
 WHERE e.kind IN ('customer_allocation','supplier_payment','supplier_debit_application') GROUP BY e.id
 HAVING e.amount<>COALESCE(SUM(l.amount),0);
SELECT 'settlement_tenders' AS issue,e.id,e.kind,e.amount,COALESCE(SUM(t.amount),0) AS tender_amount
 FROM settlement_events e LEFT JOIN settlement_events original ON original.id=e.reverses_event_id
 LEFT JOIN settlement_tenders t ON t.event_id=e.id
 WHERE e.kind IN ('customer_refund','anonymous_refund','supplier_payment','supplier_refund','payment_reversal')
 OR (e.kind='reversal' AND original.kind IN ('customer_refund','anonymous_refund','supplier_payment','supplier_refund'))
 GROUP BY e.id HAVING e.amount<>COALESCE(SUM(t.amount),0);
SELECT 'receipt_tenders' AS issue,p.id,p.amount,COALESCE(SUM(t.amount),0) AS tender_amount
 FROM payments p LEFT JOIN payment_modes_detail t ON t.payment_id=p.id GROUP BY p.id
 HAVING p.amount<>COALESCE(SUM(t.amount),0) OR p.amount<=0;

SELECT 'allocation_double_ledger' AS issue,e.id FROM settlement_events e
 WHERE e.kind IN ('customer_allocation','supplier_debit_application')
 AND EXISTS(SELECT 1 FROM customer_ledger l WHERE l.reference_type='settlement' AND l.reference_id=e.id);
SELECT 'anonymous_liability' AS issue,a.id FROM anonymous_return_liabilities a
 JOIN invoices c ON c.id=a.credit_invoice_id JOIN invoices original ON original.id=a.original_invoice_id
 WHERE c.customer_id IS NOT NULL OR original.customer_id IS NOT NULL OR c.original_invoice_id<>original.id
 OR c.document_kind<>'sales_return' OR c.grand_total<>-a.amount OR original.balance_due<>0
 OR EXISTS(SELECT 1 FROM customer_ledger l WHERE l.reference_type='invoice' AND l.reference_id=c.id);
SELECT 'reversal_link' AS issue,r.id FROM settlement_events r JOIN settlement_events e ON e.id=r.reverses_event_id
 WHERE r.kind<>'reversal' OR r.amount<>e.amount OR r.date<e.date
 OR r.customer_id IS DISTINCT FROM e.customer_id OR r.supplier_id IS DISTINCT FROM e.supplier_id;

SELECT 'close_cash_snapshot' AS issue,c.id,c.date FROM financial_day_closes c
 JOIN financial_day_openings o ON o.date=c.date
 WHERE c.expected_cash<>o.opening_float+COALESCE((SELECT SUM(
  CASE WHEN row->>'direction'='in' THEN (row->>'amount')::numeric ELSE -(row->>'amount')::numeric END)
  FROM jsonb_array_elements(c.movements) row WHERE row->>'mode'='cash'),0)
 OR c.discrepancy<>c.counted_cash-c.expected_cash;

-- Unknown history is reported separately; it is not silently reconstructed.
SELECT 'unknown_invoice_party' AS limitation,COUNT(*) AS records FROM invoices WHERE customer_snapshot IS NULL;
SELECT 'unknown_purchase_party' AS limitation,COUNT(*) AS records FROM purchases WHERE supplier_snapshot IS NULL;
SELECT 'unrecognized_receipt_not_assumed_payable' AS limitation,COUNT(*) AS records FROM purchases p
 WHERE p.status='received' AND NOT EXISTS(SELECT 1 FROM supplier_payables s WHERE s.purchase_id=p.id);
ROLLBACK;
