const { body } = require('express-validator');

// The service normalizes the complete business intent before any database writes.
const createInvoiceSchema = [];

const returnInvoiceSchema = [
  // NOTE: original_invoice_id comes from URL params (:id), NOT from body.
  // The controller adds it to data after validation runs, so do NOT validate it here.

  body('items')
    .isArray({ min: 1 }).withMessage('At least one return item is required'),

  body('items.*.invoice_item_id')
    .isInt({ min: 1 }).withMessage('Invoice item ID must be a positive integer'),

  body('items.*.product_id')
    .isInt({ min: 1 }).withMessage('Product ID must be a positive integer'),

  body('items.*.qty_returned')
    .isFloat({ min: 0.001 }).withMessage('Return quantity must be greater than 0'),

  // unit and rate are NOT sent by the frontend — the service reads them from
  // the original invoice item. Do not require them here.

  body('reason')
    .optional()
    .isString().withMessage('Reason must be a string')
    .isLength({ max: 500 }).withMessage('Reason must be under 500 characters'),
];

module.exports = { createInvoiceSchema, returnInvoiceSchema };
