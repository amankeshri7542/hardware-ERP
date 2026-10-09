# Phase 4 change and source manifest

- Starting complete Phase3 candidate: `10f8cb81b2a87174a5750f5c6e8a54bbe34827c5` (289 files); retained HEAD `724dc8e3e4dc7c7667388d5fedfb0cbd9d8b9dee`.
- Frozen tested application candidate tree: `1c70bbd5134c8d8d566ffc64c4aeaa3600d86406` (336 files), captured through a temporary index at `/private/tmp/hardware-phase4-tested-source-r5qdcza3`. It includes untracked Phase3/4 source. Tests/review refer to the final application hashes below; subsequent assembly changes only documentation.
- Backend/database/scripts:161 files; manifest `/private/tmp/phase4-tested-backend-manifest.json`, SHA256 `7576799aa29090e9924240bd9e6b88fc23f84b8a0ac2331f13e01692ba329770`.
- Frontend source/build/tests/package:111 files; `/private/tmp/phase4-final-balance-frontend-source-build-tests.json`, aggregate `f32f56d6cdc4c279a874ffea3d7eb0254edb26d436e0140397ce12eb55a6ff82`.
- Real index SHA256 remained `1647977ad7aa6b41526735cb57910886f22f9a64ca0dc778018ab05eb5cf9bd6` until the final authorized staging/commit. Existing recovery refs remained unchanged. No original-checkout source was edited.

The final documentation-inclusive tree is captured separately before commit; its literal identity is delivered in the final session response and `/private/tmp/hardware-phase4-final-identity.json`. This document cannot contain its own Git tree hash without changing that hash. `git rev-parse HEAD^{tree}` resolves the delivered commit tree. Final staging is checked against that captured tree, and local/origin commit equality is checked after push. A combined commit includes the previously uncommitted Phase3 work; the comparison below isolates Phase4, not everything since HEAD.

## Scope

Reused Express/PostgreSQL modular services, React/Ant Design, exact scaled money, actor-scoped durable idempotency and existing local guards. New settlement source/application/tender/reversal evidence, original party snapshots, shared period gate, day close, admin operational UI/recovery, read-only diagnostics and full regression integration. No dependency or lockfile additions, document reactivation, provider calls, cashier privilege broadening, production operation, historical repair or Phase5 implementation.

The independent review and integration fixes include supplier reversal DTOs, customer-only receipt history, definitive error recovery, stale quote/day responses, unverified report/dashboard warnings, immutable/unknown export values, concrete tender labels, net-account versus invoice/credit semantics, and stable accessible action labels. Browser handler-drain fixes preserve all local-only network guards and release test gates before teardown.

## Forward migrations

Applied SQL is immutable; 001–017 are preserved and no012 exists. Fresh/populated/rollback/cancel/concurrent-runner evidence is in `PHASE-4-MIGRATION-EVIDENCE.md`.

| Migration | SHA256 |
|---|---|
| `018_operational_settlement.sql` | `ce190a99a583bf4fa5c7a8df571b19aa2f861d2d73eea3e697565d0bd2c6503b` |
| `019_receipt_snapshots_and_close_boundary.sql` | `655e20877605c431cb627c803f6e1192372cf066e721fc617cf64d34d0b89ad4` |
| `020_closed_period_child_evidence.sql` | `c5961fe62ca89732971b43a48d884b8425e04d2e0f4280a8cae5fa6f61140ca4` |
| `021_payable_recognition_reason.sql` | `63b6b563b946533e4cefc510c032515eb7614216d68acf427fe3e0236acf5d0a` |

## Phase4-specific paths

89 paths differ from the preserved starting tree, including this manifest. The full59 browser manifest predates only the final customer-history display correction and its extended regression; see the test evidence for the separate affected check. No backend/database/script bytes changed after their complete run.

| Change | Path |
|---|---|
| M | `.github/workflows/phase-1.yml` |
| M | `backend/package.json` |
| M | `backend/src/app.js` |
| M | `backend/src/middleware/authorize.js` |
| M | `backend/src/modules/dashboard/dashboard.service.js` |
| M | `backend/src/modules/invoices/salesReturns.js` |
| M | `backend/src/modules/payments/payments.controller.js` |
| M | `backend/src/modules/payments/payments.service.js` |
| M | `backend/src/modules/products/catalogPosting.js` |
| M | `backend/src/modules/purchases/purchasePosting.js` |
| M | `backend/src/modules/reports/exports.controller.js` |
| M | `backend/src/modules/reports/exports.service.js` |
| M | `backend/src/modules/reports/reports.controller.js` |
| M | `backend/src/modules/reports/reports.service.js` |
| A | `backend/src/modules/settlements/cashMovements.js` |
| A | `backend/src/modules/settlements/customer.js` |
| A | `backend/src/modules/settlements/customerEvidence.js` |
| A | `backend/src/modules/settlements/customerIntent.js` |
| A | `backend/src/modules/settlements/dayClose.js` |
| A | `backend/src/modules/settlements/reporting.js` |
| A | `backend/src/modules/settlements/reportingAdapters.js` |
| A | `backend/src/modules/settlements/settlements.router.js` |
| A | `backend/src/modules/settlements/supplier.js` |
| A | `backend/src/utils/financialPeriod.js` |
| M | `backend/src/utils/idempotency.js` |
| M | `backend/src/utils/invoiceReconciliation.js` |
| M | `backend/tests/environment/migrations.test.js` |
| A | `backend/tests/helpers/disposableDatabase.js` |
| M | `backend/tests/phase3/sales-returns.test.js` |
| A | `backend/tests/phase4/clean-scenario.test.js` |
| A | `backend/tests/phase4/customer.test.js` |
| A | `backend/tests/phase4/dashboard.test.js` |
| A | `backend/tests/phase4/day-close.test.js` |
| A | `backend/tests/phase4/period-writers.test.js` |
| A | `backend/tests/phase4/receipt-history.test.js` |
| A | `backend/tests/phase4/reporting.test.js` |
| A | `backend/tests/phase4/supplier.test.js` |
| M | `db/grants.sql` |
| A | `db/migrations/018_operational_settlement.sql` |
| A | `db/migrations/019_receipt_snapshots_and_close_boundary.sql` |
| A | `db/migrations/020_closed_period_child_evidence.sql` |
| A | `db/migrations/021_payable_recognition_reason.sql` |
| A | `db/reconciliation/phase-4.sql` |
| A | `docs/FINANCIAL-SETTLEMENT-CONTRACT.md` |
| M | `docs/LOCAL-DEVELOPMENT.md` |
| A | `docs/PHASE-4-CHANGE-MANIFEST.md` |
| A | `docs/PHASE-4-MIGRATION-EVIDENCE.md` |
| A | `docs/PHASE-4-OPERATIONS.md` |
| A | `docs/PHASE-4-PLAN.md` |
| A | `docs/PHASE-4-REPORT.md` |
| A | `docs/PHASE-4-TEST-EVIDENCE.md` |
| A | `docs/PHASE-5-HANDOFF.md` |
| M | `docs/RELEASE-BLOCKERS.md` |
| M | `docs/SECURITY-RUNBOOK.md` |
| M | `frontend/package.json` |
| M | `frontend/src/App.jsx` |
| A | `frontend/src/api/finance.api.js` |
| M | `frontend/src/components/AppLayout.jsx` |
| M | `frontend/src/components/FinancialRecovery.jsx` |
| M | `frontend/src/components/ReturnModal/ReturnModal.jsx` |
| M | `frontend/src/pages/Customers/CustomerDetailPage.jsx` |
| M | `frontend/src/pages/Dashboard/DashboardPage.jsx` |
| M | `frontend/src/pages/Invoices/InvoiceDetailPage.jsx` |
| M | `frontend/src/pages/Products/ProductFormModal.jsx` |
| M | `frontend/src/pages/Reports/CollectionsReportPage.jsx` |
| M | `frontend/src/pages/Reports/CustomerDuesPage.jsx` |
| M | `frontend/src/pages/Reports/ReportsIndexPage.jsx` |
| M | `frontend/src/pages/Reports/SalesReportPage.jsx` |
| A | `frontend/src/pages/Settlements/AdvanceDialog.jsx` |
| A | `frontend/src/pages/Settlements/AnonymousLiabilitiesPage.jsx` |
| A | `frontend/src/pages/Settlements/DailyClosePage.jsx` |
| A | `frontend/src/pages/Settlements/MoneyFields.jsx` |
| A | `frontend/src/pages/Settlements/PartySettlementPage.jsx` |
| A | `frontend/src/pages/Settlements/ReceiptHistory.jsx` |
| A | `frontend/src/pages/Settlements/SettlementDialog.jsx` |
| A | `frontend/src/pages/Settlements/SettlementReportsPage.jsx` |
| A | `frontend/src/pages/Settlements/SettlementsPage.jsx` |
| A | `frontend/src/pages/Settlements/StatementPanel.jsx` |
| A | `frontend/src/pages/Settlements/financeUi.js` |
| M | `frontend/src/pages/Suppliers/SupplierDetailPage.jsx` |
| M | `frontend/src/utils/access.js` |
| M | `frontend/src/utils/financialIntent.js` |
| A | `frontend/src/utils/settlementIntent.js` |
| M | `frontend/tests/auth.test.js` |
| M | `frontend/tests/browser.test.js` |
| M | `frontend/tests/financial-browser.test.js` |
| M | `frontend/tests/phase3-browser.test.js` |
| A | `frontend/tests/phase4-browser.test.js` |
| A | `frontend/tests/phase4.test.js` |
