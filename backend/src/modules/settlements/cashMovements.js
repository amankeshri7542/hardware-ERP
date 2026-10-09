const { fail } = require('../../utils/financial');

async function getCashMovements(client, { from, to } = {}) {
  const args=[from || null,to || null];
  const {rows:[proof]}=await client.query(`SELECT
    NOT EXISTS(SELECT 1 FROM payments p WHERE ($1::date IS NULL OR p.payment_date >= $1) AND ($2::date IS NULL OR p.payment_date <= $2) AND
      (p.amount<=0 OR (p.customer_id IS NULL AND p.invoice_id IS NULL) OR
       (SELECT COALESCE(SUM(d.amount),0) FROM payment_modes_detail d WHERE d.payment_id=p.id)<>p.amount OR
       EXISTS(SELECT 1 FROM payment_modes_detail d WHERE d.payment_id=p.id AND (d.amount<=0 OR d.mode NOT IN ('cash','upi','bank','cheque') OR (p.mode<>'mixed' AND p.mode<>d.mode)))))
    AND NOT EXISTS(SELECT 1 FROM settlement_events e LEFT JOIN settlement_events original ON original.id=e.reverses_event_id
      WHERE ($1::date IS NULL OR e.date >= $1) AND ($2::date IS NULL OR e.date <= $2)
      AND (e.kind IN ('customer_refund','anonymous_refund','supplier_payment','supplier_refund','payment_reversal') OR
          (e.kind='reversal' AND original.kind IN ('customer_refund','anonymous_refund','supplier_payment','supplier_refund')))
      AND (NOT e.operator_confirmed OR (SELECT COALESCE(SUM(t.amount),0) FROM settlement_tenders t WHERE t.event_id=e.id)<>e.amount)) AS valid`,args);
  if(!proof.valid) fail('CASH_RECONCILIATION_REQUIRED');
  return (await client.query(`SELECT * FROM (
    SELECT 'payment'::text AS source_type,p.id AS source_id,CASE WHEN p.invoice_id IS NULL THEN 'customer_advance' ELSE 'customer_receipt' END AS kind,
      p.payment_date::text AS date,p.created_at,p.customer_id,NULL::integer AS supplier_id,d.id AS tender_id,d.mode,d.amount,'in'::text AS direction,d.reference_no
      FROM payments p JOIN payment_modes_detail d ON d.payment_id=p.id
    UNION ALL
    SELECT 'settlement',e.id,e.kind,e.date::text,e.created_at,e.customer_id,e.supplier_id,t.id,t.mode,t.amount,
      CASE WHEN e.kind='supplier_refund' OR (e.kind='reversal' AND original.kind IN ('customer_refund','anonymous_refund','supplier_payment')) THEN 'in' ELSE 'out' END,t.reference_no
      FROM settlement_events e JOIN settlement_tenders t ON t.event_id=e.id LEFT JOIN settlement_events original ON original.id=e.reverses_event_id
      WHERE e.kind IN ('customer_refund','anonymous_refund','supplier_payment','supplier_refund','payment_reversal') OR
        (e.kind='reversal' AND original.kind IN ('customer_refund','anonymous_refund','supplier_payment','supplier_refund'))
    ) money WHERE ($1::date IS NULL OR date::date >= $1) AND ($2::date IS NULL OR date::date <= $2)
    ORDER BY date,created_at,source_type,source_id,tender_id`,args)).rows;
}
module.exports={getCashMovements};
