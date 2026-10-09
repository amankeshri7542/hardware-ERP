const express = require('express');
const authenticateJWT = require('../../middleware/authenticateJWT');
const validate = require('../../middleware/validate');
const {
  createSupplierSchema,
  updateSupplierSchema,
  createPurchaseSchema,
} = require('./purchases.validation');
const controller = require('./purchases.controller');

// ─── SUPPLIERS ROUTER ─────────────────────────────────────────────
const suppliersRouter = express.Router();
suppliersRouter.use(authenticateJWT);

suppliersRouter.post('/', createSupplierSchema, validate, controller.createSupplier);
suppliersRouter.get('/', controller.listSuppliers);
suppliersRouter.get('/:id', controller.getSupplier);
suppliersRouter.put('/:id', updateSupplierSchema, validate, controller.updateSupplier);
suppliersRouter.get('/:id/products', controller.getSupplierProducts);
suppliersRouter.get('/:id/debit-notes', controller.getSupplierDebitNotes);

// ─── PURCHASES ROUTER ────────────────────────────────────────────
const purchasesRouter = express.Router();
purchasesRouter.use(authenticateJWT);

purchasesRouter.post('/', createPurchaseSchema, validate, controller.createPurchase);
purchasesRouter.get('/', controller.listPurchases);
purchasesRouter.get('/:id', controller.getPurchase);
purchasesRouter.put('/:id/notes', controller.updatePurchaseNotes);
purchasesRouter.post('/:id/returns', controller.createPurchaseReturn);
purchasesRouter.get('/:id/returns', controller.getPurchaseReturns);
purchasesRouter.post('/:id/invoice', controller.uploadInvoiceFile);
purchasesRouter.get('/:id/invoice', controller.getInvoiceFileUrl);

module.exports = { suppliersRouter, purchasesRouter };
