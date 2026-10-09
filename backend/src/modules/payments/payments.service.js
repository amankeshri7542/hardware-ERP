const { pool } = require('../../config/db');
const { decimal, format, fail } = require('../../utils/financial');
const { withIdempotency } = require('../../utils/idempotency');
const { normalizePaymentIntent, postPayment } = require('./paymentPosting');

// ─── Column lists (no SELECT *) ───────────────────────────────────

const PAYMENT_COLUMNS = `
  p.id, p.customer_id, p.invoice_id, p.amount, p.mode,
  p.payment_date, p.reference_no, p.notes, p.created_by, p.created_at
`;

const PAYMENT_WITH_JOINS_COLUMNS = `
  p.id, p.customer_id, p.invoice_id, p.amount, p.mode,
  p.payment_date, p.reference_no, p.notes, p.created_at,
  c.name AS customer_name, c.phone AS customer_phone,
  i.invoice_no,
  u.name AS created_by_name
`;

const PAYMENT_CUSTOMER_COLUMNS = `
  p.id, p.invoice_id, p.amount, p.mode,
  p.payment_date, p.reference_no, p.notes, p.created_at,
  i.invoice_no,
  u.name AS created_by_name
`;

// ─── recordPayment (atomic transaction) ───────────────────────────

async function requireReconciledInvoice(client, invoiceId) {
  // Compare exact PostgreSQL numerics. Historical rows are evidence, never repaired here.
  const { rows: [history] } = await client.query(`
    SELECT i.amount_paid >= 0 AND i.balance_due >= 0
      AND i.amount_paid + i.balance_due = i.grand_total
      AND (SELECT COALESCE(SUM(p.amount),0) FROM payments p WHERE p.invoice_id=i.id) = i.amount_paid
      AND (SELECT COALESCE(SUM(l.debit),0) FROM customer_ledger l
           WHERE l.reference_type='invoice' AND l.reference_id=i.id) = i.grand_total
      AND NOT EXISTS (
        SELECT 1 FROM customer_ledger l WHERE l.reference_type='invoice' AND l.reference_id=i.id
          AND (l.customer_id IS DISTINCT FROM i.customer_id OR l.entry_type <> 'invoice' OR l.credit <> 0 OR l.debit <= 0))
      AND NOT EXISTS (
        SELECT 1 FROM payments p WHERE p.invoice_id=i.id AND (
          p.customer_id IS DISTINCT FROM i.customer_id OR p.amount <= 0
          OR p.mode NOT IN ('cash','upi','bank','cheque','mixed')
          OR (SELECT COALESCE(SUM(l.credit),0) FROM customer_ledger l
              WHERE l.reference_type='payment' AND l.reference_id=p.id) <> p.amount
          OR EXISTS (SELECT 1 FROM customer_ledger l WHERE l.reference_type='payment' AND l.reference_id=p.id
              AND (l.customer_id IS DISTINCT FROM i.customer_id OR l.entry_type <> 'payment' OR l.debit <> 0 OR l.credit <= 0))
          OR EXISTS (SELECT 1 FROM payment_modes_detail d WHERE d.payment_id=p.id
              AND (d.amount <= 0 OR d.mode NOT IN ('cash','upi','bank','cheque') OR (p.mode <> 'mixed' AND d.mode <> p.mode)))
          OR ((p.mode='mixed' OR EXISTS (SELECT 1 FROM payment_modes_detail d WHERE d.payment_id=p.id))
              AND (SELECT COALESCE(SUM(d.amount),0) FROM payment_modes_detail d WHERE d.payment_id=p.id) <> p.amount)
        )) AS reconciled
    FROM invoices i WHERE i.id=$1`, [invoiceId]);
  if (!history?.reconciled) fail('INVOICE_RECONCILIATION_REQUIRED');
}

async function recordPayment(data, userId, key) {
  const intent = normalizePaymentIntent(data);
  return withIdempotency({ actorId: userId, operation: 'payment.create', key, intent }, async (client) => {
    let invoice;
    const amount = decimal(intent.payment.amount, 2, 'payment amount', { min: 1n });
    if (intent.invoice_id !== null) {
      const result = await client.query(
        'SELECT id,customer_id,grand_total,amount_paid,balance_due FROM invoices WHERE id=$1 FOR UPDATE',
        [intent.invoice_id]);
      invoice = result.rows[0];
      if (!invoice) fail('INVOICE_NOT_FOUND', 404);
      if (invoice.customer_id !== intent.customer_id) fail('INVOICE_CUSTOMER_MISMATCH');
      if (decimal(invoice.grand_total, 2, 'invoice total') <= 0n) fail('INVOICE_NOT_PAYABLE');
      const due = decimal(invoice.balance_due, 2, 'invoice balance');
      if (due === 0n) fail('INVOICE_ALREADY_PAID');
      if (amount > due) fail('PAYMENT_EXCEEDS_BALANCE');
    }
    const customer = await client.query(
      'SELECT id FROM customers WHERE id=$1 AND is_active=true FOR UPDATE', [intent.customer_id]);
    if (!customer.rowCount) fail('CUSTOMER_NOT_FOUND', 404);
    let invoiceBalances;
    if (invoice) {
      await requireReconciledInvoice(client, invoice.id);
      const balance = decimal(invoice.balance_due, 2, 'invoice balance') - amount;
      const paid = decimal(invoice.amount_paid, 2, 'invoice paid') + amount;
      decimal(format(paid), 2, 'invoice paid');
      invoiceBalances = (await client.query(
        `UPDATE invoices SET balance_due=$1,amount_paid=$2,status=$3 WHERE id=$4
         RETURNING balance_due AS invoice_balance_due,amount_paid AS invoice_amount_paid`,
        [format(balance), format(paid), balance === 0n ? 'paid' : 'partial', invoice.id])).rows[0];
    }
    const receipt = await postPayment(client, {
      customerId: intent.customer_id, invoiceId: intent.invoice_id, payment: intent.payment,
      paymentDate: intent.payment_date, notes: intent.notes, userId,
    });
    return { status: 201, body: { success: true, data: { ...receipt, ...invoiceBalances } } };
  });
}

// ─── getPaymentsByCustomer ────────────────────────────────────────

async function getPaymentsByCustomer(customerId, { from, to, page = 1, limit = 20 } = {}) {
  const conditions = ['p.customer_id = $1'];
  const values = [customerId];
  let idx = 2;

  if (from) {
    conditions.push(`p.payment_date >= $${idx++}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`p.payment_date <= $${idx++}`);
    values.push(to);
  }

  const whereClause = 'WHERE ' + conditions.join(' AND ');

  // Total count
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM payments p ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Paginated results
  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const result = await pool.query(
    `SELECT ${PAYMENT_CUSTOMER_COLUMNS}
     FROM payments p
     LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN users u ON u.id = p.created_by
     ${whereClause}
     ORDER BY p.payment_date DESC, p.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    values
  );

  return {
    payments: result.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

// ─── getPaymentsByInvoice ─────────────────────────────────────────

async function getPaymentsByInvoice(invoiceId) {
  const result = await pool.query(
    `SELECT ${PAYMENT_COLUMNS}
     FROM payments p
     WHERE p.invoice_id = $1
     ORDER BY p.payment_date DESC, p.created_at DESC`,
    [invoiceId]
  );

  const payments = [];
  for (const row of result.rows) {
    const payment = { ...row };

    if (row.mode === 'mixed') {
      const detailResult = await pool.query(
        `SELECT id, mode, amount, reference_no
         FROM payment_modes_detail
         WHERE payment_id = $1
         ORDER BY id`,
        [row.id]
      );
      payment.modes_detail = detailResult.rows;
    }

    payments.push(payment);
  }

  return payments;
}

// ─── listAllPayments ──────────────────────────────────────────────

async function listAllPayments({ from, to, mode, page = 1, limit = 20 } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (from) {
    conditions.push(`p.payment_date >= $${idx++}`);
    values.push(from);
  }
  if (to) {
    conditions.push(`p.payment_date <= $${idx++}`);
    values.push(to);
  }
  if (mode) {
    conditions.push(`p.mode = $${idx++}`);
    values.push(mode);
  }

  const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

  // Total count
  const countResult = await pool.query(
    `SELECT COUNT(*) FROM payments p ${whereClause}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  // Paginated results
  const offset = (page - 1) * limit;
  values.push(limit, offset);

  const result = await pool.query(
    `SELECT ${PAYMENT_WITH_JOINS_COLUMNS}
     FROM payments p
     LEFT JOIN customers c ON c.id = p.customer_id
     LEFT JOIN invoices i ON i.id = p.invoice_id
     LEFT JOIN users u ON u.id = p.created_by
     ${whereClause}
     ORDER BY p.payment_date DESC, p.created_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    values
  );

  return {
    payments: result.rows,
    total,
    page,
    limit,
    totalPages: Math.ceil(total / limit),
  };
}

module.exports = {
  recordPayment,
  getPaymentsByCustomer,
  getPaymentsByInvoice,
  listAllPayments,
};
