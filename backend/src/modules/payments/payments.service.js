const { pool } = require('../../config/db');
const { decimal, format, fail, positiveId } = require('../../utils/financial');
const { withIdempotency } = require('../../utils/idempotency');
const { normalizePaymentIntent, postPayment } = require('./paymentPosting');
const { requireReconciledInvoice } = require('../../utils/invoiceReconciliation');

// ─── Column lists (no SELECT *) ───────────────────────────────────

const PAYMENT_COLUMNS = `
  p.id, p.customer_id, p.invoice_id, p.amount, p.mode,
  p.payment_date, p.reference_no, p.notes, p.created_by, p.created_at
`;

const PAYMENT_WITH_JOINS_COLUMNS = `
  p.id, p.customer_id, p.invoice_id, p.amount, p.mode,
  p.payment_date, p.reference_no, p.notes, p.created_at,
  COALESCE(p.customer_snapshot->>'name','Unknown issued customer') AS customer_name,
  p.customer_snapshot->>'phone' AS customer_phone,
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
      await require('../settlements/customer').requireInvoiceDate(client, invoice.id, intent.payment_date);
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

async function listAllPayments({ from, to, mode, customer_id, page = 1, limit = 20 } = {}) {
  const conditions = [];
  const values = [];
  let idx = 1;

  if (customer_id !== undefined) {
    conditions.push(`p.customer_id = $${idx++}`);
    values.push(positiveId(customer_id));
  }

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
     ORDER BY p.payment_date DESC, p.created_at DESC, p.id DESC
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
