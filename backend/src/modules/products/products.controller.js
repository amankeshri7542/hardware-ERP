const productsService = require('./products.service');

/**
 * GET /products
 */
async function listProducts(req, res, next) {
  try {
    const {
      search,
      category,
      is_active,
      low_stock_only,
      page = 1,
      limit = 20,
    } = req.query;

    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const { products, total } = await productsService.getAllProducts({
      search: search || undefined,
      category: category || undefined,
      isActive: is_active !== undefined ? is_active === 'true' : undefined,
      lowStockOnly: low_stock_only === 'true',
      page: parsedPage,
      limit: parsedLimit,
    });

    return res.json({
      success: true,
      data: {
        products,
        pagination: {
          total,
          page: parsedPage,
          limit: parsedLimit,
          totalPages: Math.ceil(total / parsedLimit),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /products/:id
 */
async function getProduct(req, res, next) {
  try {
    const product = await productsService.getProductById(req.params.id);
    if (!product) {
      return res.status(404).json({
        success: false,
        error: 'Product not found',
        code: 'PRODUCT_NOT_FOUND',
      });
    }
    return res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /products
 */
async function createProduct(req, res, next) {
  try {
    const result = await productsService.createProduct(req.body, req.user.id, req.get('Idempotency-Key'));
    return res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
}

/**
 * PUT /products/:id
 */
async function updateProduct(req, res, next) {
  try {
    const product = await productsService.updateProduct(req.params.id, req.body, req.user?.id);
    return res.json({ success: true, data: product });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /products/:id — soft delete
 */
async function deleteProduct(req, res, next) {
  try {
    const result = await productsService.softDeleteProduct(req.params.id);
    return res.json({
      success: true,
      data: { message: 'Product deactivated', id: result.id },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /products/:id/stock-ledger
 */
async function getStockLedger(req, res, next) {
  try {
    const { from, to, page = 1, limit = 20 } = req.query;
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const { entries, total } = await productsService.getProductStockLedger(
      req.params.id,
      { from, to, page: parsedPage, limit: parsedLimit },
    );

    return res.json({
      success: true,
      data: {
        entries,
        pagination: {
          total,
          page: parsedPage,
          limit: parsedLimit,
          totalPages: Math.ceil(total / parsedLimit),
        },
      },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /products/low-stock
 */
async function getLowStock(req, res, next) {
  try {
    const products = await productsService.getLowStockProducts();
    return res.json({
      success: true,
      data: { products, count: products.length },
    });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /products/:id/price-history
 */
async function getPriceHistory(req, res, next) {
  try {
    const entries = await productsService.getProductPriceHistory(req.params.id);
    return res.json({ success: true, data: { entries } });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /products/:id/suppliers
 */
async function getProductSuppliers(req, res, next) {
  try {
    const suppliers = await productsService.getProductSuppliers(req.params.id);
    return res.json({ success: true, data: { suppliers } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /products/:id/suppliers
 */
async function linkProductSupplier(req, res, next) {
  try {
    const result = await productsService.linkProductSupplier(req.params.id, req.body);
    return res.status(201).json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

/**
 * GET /products/:id/unit-conversions
 */
async function getUnitConversions(req, res, next) {
  try {
    const conversions = await productsService.getUnitConversions(req.params.id);
    return res.json({ success: true, data: { conversions } });
  } catch (err) {
    next(err);
  }
}

/**
 * POST /products/:id/unit-conversions
 */
async function createUnitConversion(req, res, next) {
  try {
    const conversion = await productsService.createUnitConversion(req.params.id, req.body);
    return res.status(201).json({ success: true, data: conversion });
  } catch (err) {
    next(err);
  }
}

/**
 * DELETE /products/unit-conversions/:conversionId
 */
async function deleteUnitConversion(req, res, next) {
  try {
    await productsService.deleteUnitConversion(req.params.conversionId);
    return res.json({ success: true, data: { message: 'Unit conversion deleted' } });
  } catch (err) {
    next(err);
  }
}

module.exports = {
  listProducts,
  getProduct,
  createProduct,
  updateProduct,
  deleteProduct,
  getStockLedger,
  getLowStock,
  getPriceHistory,
  getProductSuppliers,
  linkProductSupplier,
  getUnitConversions,
  createUnitConversion,
  deleteUnitConversion,
};
