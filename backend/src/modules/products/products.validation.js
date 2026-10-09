const { body } = require('express-validator');

const VALID_GST_RATES = [0, 5, 12, 18, 28];
const VALID_UNITS = ['piece', 'kg', 'box', 'metre', 'litre', 'set'];

const createProductSchema = [
  body('name')
    .trim()
    .notEmpty().withMessage('Product name is required')
    .isLength({ max: 200 }).withMessage('Name must be under 200 characters'),

  body('category')
    .trim()
    .notEmpty().withMessage('Category is required')
    .isLength({ max: 100 }).withMessage('Category must be under 100 characters'),

  body('brand')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Brand must be under 100 characters'),

  body('unit')
    .isString().withMessage('Unit must be a string')
    .notEmpty().withMessage('Unit cannot be empty'),

  body('hsn_code')
    .optional()
    .trim()
    .isLength({ max: 20 }).withMessage('HSN code must be under 20 characters'),

  body('gst_rate')
    .isFloat({ min: 0, max: 28 }).withMessage('GST rate must be between 0 and 28')
    .custom((value) => {
      if (!VALID_GST_RATES.includes(Number(value))) {
        throw new Error(`GST rate must be one of: ${VALID_GST_RATES.join(', ')}`);
      }
      return true;
    }),

  body('mrp')
    .isFloat({ min: 0 }).withMessage('MRP is required and must be >= 0'),

  body('wholesale_price')
    .isFloat({ min: 0 }).withMessage('Wholesale price is required and must be >= 0'),

  body('purchase_price')
    .isFloat({ min: 0 }).withMessage('Purchase price is required for profit calculation'),

  body('sku')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('SKU must be under 50 characters')
    .matches(/^[a-zA-Z0-9-]*$/).withMessage('SKU must be alphanumeric with hyphens only'),

  body('barcode')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Barcode must be under 100 characters'),

  body('min_stock')
    .optional()
    .isFloat({ min: 0 }).withMessage('Min stock must be >= 0'),

  body('is_active')
    .optional()
    .isBoolean().withMessage('is_active must be a boolean'),
];

const updateProductSchema = [
  body('name')
    .optional()
    .trim()
    .notEmpty().withMessage('Product name cannot be empty')
    .isLength({ max: 200 }).withMessage('Name must be under 200 characters'),

  body('category')
    .optional()
    .trim()
    .notEmpty().withMessage('Category cannot be empty')
    .isLength({ max: 100 }).withMessage('Category must be under 100 characters'),

  body('brand')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Brand must be under 100 characters'),

  body('unit')
    .optional()
    .isString().withMessage('Unit must be a string')
    .notEmpty().withMessage('Unit cannot be empty'),

  body('hsn_code')
    .optional()
    .trim()
    .isLength({ max: 20 }).withMessage('HSN code must be under 20 characters'),

  body('gst_rate')
    .optional()
    .isFloat({ min: 0, max: 28 }).withMessage('GST rate must be between 0 and 28')
    .custom((value) => {
      if (!VALID_GST_RATES.includes(Number(value))) {
        throw new Error(`GST rate must be one of: ${VALID_GST_RATES.join(', ')}`);
      }
      return true;
    }),

  body('mrp')
    .optional()
    .isFloat({ min: 0 }).withMessage('MRP must be >= 0'),

  body('wholesale_price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Wholesale price must be >= 0'),

  body('purchase_price')
    .optional()
    .isFloat({ min: 0 }).withMessage('Purchase price must be >= 0'),

  body('sku')
    .optional()
    .trim()
    .isLength({ max: 50 }).withMessage('SKU must be under 50 characters')
    .matches(/^[a-zA-Z0-9-]*$/).withMessage('SKU must be alphanumeric with hyphens only'),

  body('barcode')
    .optional()
    .trim()
    .isLength({ max: 100 }).withMessage('Barcode must be under 100 characters'),

  body('min_stock')
    .optional()
    .isFloat({ min: 0 }).withMessage('Min stock must be >= 0'),

  body('is_active')
    .optional()
    .isBoolean().withMessage('is_active must be a boolean'),

  // Custom: at least one field must be present
  body().custom((value, { req }) => {
    const updatableFields = [
      'name', 'category', 'brand', 'unit', 'hsn_code', 'gst_rate',
      'mrp', 'wholesale_price', 'purchase_price', 'sku', 'barcode',
      'min_stock', 'is_active', 'base_unit', 'conversions',
    ];
    const hasAtLeastOne = updatableFields.some((field) => req.body[field] !== undefined);
    if (!hasAtLeastOne) {
      throw new Error('At least one field must be provided for update');
    }
    return true;
  }),
];

module.exports = { createProductSchema, updateProductSchema };
