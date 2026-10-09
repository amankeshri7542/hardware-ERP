const express = require('express');
const router = express.Router();
const authenticateJWT = require('../../middleware/authenticateJWT');
const validate = require('../../middleware/validate');
const { createProductSchema, updateProductSchema } = require('./products.validation');
const controller = require('./products.controller');
const searchService = require('./products.search.service');

// All routes require authentication
router.use(authenticateJWT);

// ─── Static routes MUST come BEFORE /:id ───────────────────────────

// Search: GET /products/search?q=cement&limit=8  OR  ?barcode=123456
router.get('/search', async (req, res, next) => {
  try {
    const { q, barcode, limit = 8 } = req.query;

    if (barcode) {
      const product = await searchService.searchByBarcode(barcode);
      const products = product
        ? [{ ...product, stock_status: product.current_stock > 0 ? 'in_stock' : 'no_stock' }]
        : [];
      return res.json({ success: true, data: { products, searchType: 'barcode' } });
    }

    if (q && q.trim().length >= 2) {
      const results = await searchService.searchByName(q.trim(), parseInt(limit, 10) || 8);
      const products = results.map((p) => ({
        ...p,
        stock_status: p.current_stock > 0 ? 'in_stock' : 'no_stock',
      }));
      return res.json({ success: true, data: { products, searchType: 'name', query: q } });
    }

    return res.json({ success: true, data: { products: [], searchType: 'name', query: q || '' } });
  } catch (err) {
    next(err);
  }
});

// Low stock products
router.get('/low-stock', controller.getLowStock);

// Barcode scanner shortcut: GET /products/barcode/:code
router.get('/barcode/:code', async (req, res, next) => {
  try {
    const product = await searchService.searchByBarcode(req.params.code);
    if (!product) {
      return res.json({ success: true, data: { products: [], searchType: 'barcode' } });
    }
    return res.json({
      success: true,
      data: {
        products: [{ ...product, stock_status: product.current_stock > 0 ? 'in_stock' : 'no_stock' }],
        searchType: 'barcode',
      },
    });
  } catch (err) {
    next(err);
  }
});

// ─── CRUD routes ───────────────────────────────────────────────────

// List products
router.get('/', controller.listProducts);

// Create product
router.post('/', require('../../middleware/requireFinancialActor'), createProductSchema, validate, controller.createProduct);
router.post('/:id/stock-adjustments', require('../../middleware/requireFinancialActor'), require('../../utils/asyncHandler')(async (req,res) => {
  const result=await require('./catalogPosting').adjustStock(req.params.id,req.body,req.user.id,req.get('Idempotency-Key'));
  res.status(result.status).json(result.body);
}));

// Get single product (must be AFTER all static routes)
router.get('/:id', controller.getProduct);

// Update product
router.put('/:id', updateProductSchema, validate, controller.updateProduct);

// Soft delete product
router.delete('/:id', controller.deleteProduct);

// Stock ledger for a product
router.get('/:id/stock-ledger', controller.getStockLedger);

// Price history for a product
router.get('/:id/price-history', controller.getPriceHistory);

// Product suppliers
router.get('/:id/suppliers', controller.getProductSuppliers);
router.post('/:id/suppliers', controller.linkProductSupplier);

// Unit conversions
router.get('/:id/unit-conversions', controller.getUnitConversions);
router.post('/:id/unit-conversions', controller.createUnitConversion);
router.delete('/unit-conversions/:conversionId', controller.deleteUnitConversion);

module.exports = router;
