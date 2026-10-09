# Phase 3 change manifest

Relative to preserved HEAD `724dc8e3e4dc7c7667388d5fedfb0cbd9d8b9dee`.
All changes remain uncommitted and unstaged in the existing isolated worktree.
Exact source hashes/tree identity and scan results are in `PHASE-3-TEST-EVIDENCE.md`.

| Change | Path |
|---|---|
| Modified | `.github/workflows/phase-1.yml` |
| Modified | `backend/package.json` |
| Modified | `backend/src/middleware/authorize.js` |
| Modified | `backend/src/modules/invoices/invoices.controller.js` |
| Modified | `backend/src/modules/invoices/invoices.router.js` |
| Modified | `backend/src/modules/invoices/invoices.service.js` |
| Modified | `backend/src/modules/invoices/invoices.validation.js` |
| Added | `backend/src/modules/invoices/salesReturns.js` |
| Modified | `backend/src/modules/payments/payments.service.js` |
| Added | `backend/src/modules/products/catalogPosting.js` |
| Modified | `backend/src/modules/products/products.controller.js` |
| Modified | `backend/src/modules/products/products.router.js` |
| Modified | `backend/src/modules/products/products.service.js` |
| Modified | `backend/src/modules/products/products.validation.js` |
| Added | `backend/src/modules/purchases/purchasePosting.js` |
| Modified | `backend/src/modules/purchases/purchases.controller.js` |
| Modified | `backend/src/modules/purchases/purchases.router.js` |
| Modified | `backend/src/modules/purchases/purchases.service.js` |
| Modified | `backend/src/modules/purchases/purchases.validation.js` |
| Added | `backend/src/utils/invoiceReconciliation.js` |
| Modified | `backend/tests/environment/migrations.test.js` |
| Modified | `backend/tests/financial/idempotency.test.js` |
| Added | `backend/tests/helpers/lockWaiters.js` |
| Modified | `backend/tests/phase2/catalog.test.js` |
| Added | `backend/tests/phase3/products.test.js` |
| Added | `backend/tests/phase3/purchases.test.js` |
| Added | `backend/tests/phase3/sales-returns.test.js` |
| Modified | `backend/tests/release-blockers/financial.test.js` |
| Modified | `backend/tests/security/session-api.test.js` |
| Modified | `db/grants.sql` |
| Added | `db/migrations/016_original_line_sales_returns.sql` |
| Added | `db/migrations/017_purchase_and_stock_contract.sql` |
| Added | `db/reconciliation/phase-3.sql` |
| Added | `docs/INVENTORY-RETURN-CONTRACT.md` |
| Added | `docs/PHASE-3-BASELINE-EVIDENCE.md` |
| Added | `docs/PHASE-3-CHANGE-MANIFEST.md` |
| Added | `docs/PHASE-3-MIGRATION-EVIDENCE.md` |
| Added | `docs/PHASE-3-REPORT.md` |
| Added | `docs/PHASE-3-TEST-EVIDENCE.md` |
| Added | `docs/PHASE-4-HANDOFF.md` |
| Modified | `docs/RELEASE-BLOCKERS.md` |
| Modified | `frontend/package.json` |
| Modified | `frontend/src/api/invoices.api.js` |
| Modified | `frontend/src/api/products.api.js` |
| Modified | `frontend/src/api/purchases.api.js` |
| Added | `frontend/src/components/FinancialRecovery.jsx` |
| Modified | `frontend/src/components/PurchaseReturnModal/PurchaseReturnModal.jsx` |
| Modified | `frontend/src/components/ReturnModal/ReturnModal.jsx` |
| Added | `frontend/src/components/StockCountModal.jsx` |
| Modified | `frontend/src/pages/Invoices/InvoiceDetailPage.jsx` |
| Modified | `frontend/src/pages/Products/ProductDetailPage.jsx` |
| Modified | `frontend/src/pages/Products/ProductFormModal.jsx` |
| Modified | `frontend/src/pages/Purchases/NewPurchasePage.jsx` |
| Modified | `frontend/src/pages/Purchases/PurchaseDetailPage.jsx` |
| Modified | `frontend/src/utils/financialIntent.js` |
| Modified | `frontend/tests/browser.test.js` |
| Added | `frontend/tests/phase3-browser.test.js` |
| Added | `frontend/tests/phase3.test.js` |
| Modified | `frontend/vite.config.js` |

Migrations 016 and 017 are forward-only and frozen after application. Historical migrations 001–011 and 013–015 are unchanged; 012 is not fabricated.
No dependency version or lockfile changes, generated build artifacts, local credentials, database data or original-checkout AI/mobile files are included.
