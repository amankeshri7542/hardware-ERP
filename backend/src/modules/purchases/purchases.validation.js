const { body } = require('express-validator');

const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;

const createSupplierSchema = [
  body('name')
    .trim()
    .notEmpty().withMessage('Supplier name is required')
    .isLength({ max: 200 }).withMessage('Name must be under 200 characters'),

  body('phone')
    .optional()
    .trim()
    .matches(/^\d{10}$/).withMessage('Phone must be exactly 10 digits'),

  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Invalid email format'),

  body('gstin')
    .optional()
    .trim()
    .isLength({ min: 15, max: 15 }).withMessage('GSTIN must be exactly 15 characters')
    .matches(GSTIN_REGEX).withMessage('Invalid GSTIN format'),

  body('address')
    .optional()
    .trim()
    .isLength({ max: 500 }).withMessage('Address must be under 500 characters'),

  body('payment_terms')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Payment terms must be under 100 characters'),
];

const updateSupplierSchema = [
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Name cannot be empty')
    .isLength({ max: 200 }),

  body('phone')
    .optional()
    .trim()
    .matches(/^\d{10}$/).withMessage('Phone must be exactly 10 digits'),

  body('email')
    .optional()
    .trim()
    .isEmail().withMessage('Invalid email format'),

  body('gstin')
    .optional()
    .trim()
    .isLength({ min: 15, max: 15 }).withMessage('GSTIN must be exactly 15 characters')
    .matches(GSTIN_REGEX).withMessage('Invalid GSTIN format'),

  body('address')
    .optional()
    .trim()
    .isLength({ max: 500 }),

  body('payment_terms')
    .optional()
    .trim()
    .isLength({ max: 100 }),
];

// Posting validates selected units and exact decimals against authoritative rows.
const createPurchaseSchema = [];

module.exports = {
  createSupplierSchema,
  updateSupplierSchema,
  createPurchaseSchema,
};
