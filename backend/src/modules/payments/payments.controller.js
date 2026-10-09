const asyncHandler = require('../../utils/asyncHandler');
const paymentsService = require('./payments.service');

/**
 * POST /payments
 * Record a new payment (optionally linked to an invoice).
 */
const recordPayment = asyncHandler(async (req, res) => {
  const result = await paymentsService.recordPayment(req.body, req.user.id, req.get('Idempotency-Key'));
  res.status(result.status).json(result.body);
});

/**
 * GET /payments
 * List all payments with optional filters.
 */
const listPayments = asyncHandler(async (req, res) => {
  const { from, to, mode, customer_id, page, limit } = req.query;
  const result = await paymentsService.listAllPayments({
    from,
    to,
    mode,
    customer_id,
    page: parseInt(page, 10) || 1,
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 20)),
  });
  res.json({ success: true, data: result });
});

/**
 * GET /payments/invoice/:invoiceId
 * Get all payments for a specific invoice.
 */
const getInvoicePayments = asyncHandler(async (req, res) => {
  const payments = await paymentsService.getPaymentsByInvoice(
    parseInt(req.params.invoiceId, 10)
  );
  res.json({ success: true, data: { payments } });
});

module.exports = { recordPayment, listPayments, getInvoicePayments };
