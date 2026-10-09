const router = require('express').Router();
const authenticateJWT = require('../../middleware/authenticateJWT');
const validate = require('../../middleware/validate');
const requireFinancialActor = require('../../middleware/requireFinancialActor');
const { createInvoiceSchema, returnInvoiceSchema } = require('./invoices.validation');
const ctrl = require('./invoices.controller');

// All invoice routes require authentication
router.use(authenticateJWT);

// Create invoice
router.post('/', requireFinancialActor, createInvoiceSchema, validate, ctrl.createInvoice);
router.post('/quote', ctrl.quoteInvoice);

// List invoices with filters
router.get('/', ctrl.listInvoices);

// Get single invoice
router.get('/:id', ctrl.getInvoice);

// Check PDF generation status
router.get('/:id/pdf-status', ctrl.getPdfStatus);

// Get pre-signed PDF download URL
router.get('/:id/pdf', ctrl.getPdf);

// Regenerate PDF (manual retry)
router.post('/:id/regenerate-pdf', ctrl.regeneratePdf);

// Process sales return (credit note)
router.post('/:id/return/quote', ctrl.quoteReturn);
router.post('/:id/return', requireFinancialActor, returnInvoiceSchema, validate, ctrl.processReturn);

module.exports = router;
