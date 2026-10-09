const purchasesService = require('./purchases.service');

// ─── SUPPLIER HANDLERS ────────────────────────────────────────────

async function createSupplier(req, res, next) {
  try {
    const supplier = await purchasesService.createSupplier(req.body);
    return res.status(201).json({ success: true, data: supplier });
  } catch (err) {
    next(err);
  }
}

async function listSuppliers(req, res, next) {
  try {
    const { search, is_active } = req.query;
    const suppliers = await purchasesService.getSuppliers({
      search: search || undefined,
      isActive: is_active !== undefined ? is_active === 'true' : undefined,
    });
    return res.json({ success: true, data: { suppliers } });
  } catch (err) {
    next(err);
  }
}

async function getSupplier(req, res, next) {
  try {
    const supplier = await purchasesService.getSupplierById(req.params.id);
    if (!supplier) {
      return res.status(404).json({
        success: false,
        error: 'Supplier not found',
        code: 'SUPPLIER_NOT_FOUND',
      });
    }
    return res.json({ success: true, data: supplier });
  } catch (err) {
    next(err);
  }
}

async function updateSupplier(req, res, next) {
  try {
    const supplier = await purchasesService.updateSupplier(req.params.id, req.body);
    return res.json({ success: true, data: supplier });
  } catch (err) {
    next(err);
  }
}

// ─── PURCHASE HANDLERS ───────────────────────────────────────────

async function createPurchase(req, res, next) {
  try {
    const result = await purchasesService.createPurchaseWithStockIn(req.body, req.user.id, req.get('Idempotency-Key'));
    return res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
}

async function listPurchases(req, res, next) {
  try {
    const { supplier_id, from, to, page = 1, limit = 20 } = req.query;
    const parsedPage = Math.max(1, parseInt(page, 10) || 1);
    const parsedLimit = Math.min(100, Math.max(1, parseInt(limit, 10) || 20));

    const { purchases, total } = await purchasesService.getPurchases({
      supplierId: supplier_id || undefined,
      from: from || undefined,
      to: to || undefined,
      page: parsedPage,
      limit: parsedLimit,
    });

    return res.json({
      success: true,
      data: {
        purchases,
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

async function getPurchase(req, res, next) {
  try {
    const purchase = await purchasesService.getPurchaseById(req.params.id);
    if (!purchase) {
      return res.status(404).json({
        success: false,
        error: 'Purchase not found',
        code: 'PURCHASE_NOT_FOUND',
      });
    }
    return res.json({ success: true, data: purchase });
  } catch (err) {
    next(err);
  }
}

async function updatePurchaseNotes(req, res, next) {
  try {
    const result = await purchasesService.updatePurchaseNotes(
      req.params.id, req.body.notes || ''
    );
    return res.json({ success: true, data: result });
  } catch (err) {
    next(err);
  }
}

// ─── SUPPLIER DETAIL HANDLERS ────────────────────────────────────

async function getSupplierProducts(req, res, next) {
  try {
    const products = await purchasesService.getSupplierProducts(req.params.id);
    return res.json({ success: true, data: { products } });
  } catch (err) {
    next(err);
  }
}

async function getSupplierDebitNotes(req, res, next) {
  try {
    const debitNotes = await purchasesService.getSupplierDebitNotes(req.params.id);
    return res.json({ success: true, data: { debit_notes: debitNotes } });
  } catch (err) {
    next(err);
  }
}

// ─── PURCHASE RETURN HANDLERS ───────────────────────────────────

async function createPurchaseReturn(req, res, next) {
  try {
    const result = await purchasesService.createPurchaseReturn(
      req.params.id, req.body, req.user.id, req.get('Idempotency-Key')
    );
    return res.status(result.status).json(result.body);
  } catch (err) {
    next(err);
  }
}

async function getPurchaseReturns(req, res, next) {
  try {
    const returns = await purchasesService.getPurchaseReturns(req.params.id);
    return res.json({ success: true, data: { returns } });
  } catch (err) {
    next(err);
  }
}

// ─── PURCHASE INVOICE UPLOAD ─────────────────────────────────────
async function uploadInvoiceFile(req, res, next) {
  try {
    if (!/^[1-9]\d*$/.test(req.params.id) || Number(req.params.id) > 2147483647) {
      return res.status(400).json({ success: false, code: 'INVALID_PURCHASE_ID', error: 'Invalid purchase ID' });
    }
    const purchase = await purchasesService.getPurchaseById(req.params.id);
    if (!purchase) {
      return res.status(404).json({ success: false, code: 'PURCHASE_NOT_FOUND', error: 'Purchase not found' });
    }
    throw require('../../utils/documentContainment').disabledDocumentError('ATTACHMENT');
  } catch (err) { next(err); }
}

const getInvoiceFileUrl = uploadInvoiceFile;
async function quotePurchase(req, res, next) {
  try { res.json({ success: true, data: await purchasesService.quotePurchase(req.body) }); }
  catch (error) { next(error); }
}
async function quotePurchaseReturn(req, res, next) {
  try { res.json({ success: true, data: await purchasesService.quotePurchaseReturn(req.params.id, req.body) }); }
  catch (error) { next(error); }
}

module.exports = {
  createSupplier,
  listSuppliers,
  getSupplier,
  updateSupplier,
  createPurchase,
  quotePurchase,
  listPurchases,
  getPurchase,
  updatePurchaseNotes,
  getSupplierProducts,
  getSupplierDebitNotes,
  createPurchaseReturn,
  quotePurchaseReturn,
  getPurchaseReturns,
  uploadInvoiceFile,
  getInvoiceFileUrl,
};
