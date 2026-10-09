# Phase 2 candidate boundary

- Worktree: /Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp
- Branch: codex/phase-1-security-baseline
- Committed baseline: 5404f98b27eb8c326aa3ebc603ee43efe6394404
- Phase 1 starting staged tree: 0e0a2c19acac02660fd4981765f5426059f14197
- Initial state: 129 staged paths, no unstaged changes. Phase 1 is in this tree,
  not in the baseline commit. No reset, stash, clean or checkout was performed.

Coordinator owns the billing contract, exact calculations, invoice posting,
migration 014 and final integration. Specialists own payment/idempotency code,
frontend flows, and real database/browser regression evidence respectively.
Changes will be enumerated against the starting tree at handoff.

Sequence: reproduce original financial invariants; agree contract; write failing
regressions; implement billing/payment and frontend together; verify restricted
role, concurrency and retries; independent review; report remaining Phase 3 and
inherited operator gates; commit and push the current candidate as authorized.

FIN-01/02/03/04/05/09 belong to Phase 2. FIN-06/07/08 assert sales/purchase return
binding and belong to Phase 3 under the current explicit phase boundary.
Their earlier broad Phase 2 labels do not justify removing or weakening tests.

## Phase 2 changed paths

61 paths differ from the preserved Phase 1 tree. The frozen source/test tree is `e84f7b81374e5c852ab18dc82835c548ea95b231`; final evidence updates after this freeze affect documentation only. Migration 014 provides posting/idempotency support; 015 preserves new invoice base-unit snapshots. Historical migrations 001–011 and 013 are unchanged.

```text
M	.context/API.md
M	.context/DATABASE.md
M	.context/FRONTEND.md
M	.context/MODULES.md
M	.github/workflows/phase-1.yml
M	backend/package.json
M	backend/src/middleware/authorize.js
A	backend/src/middleware/requireFinancialActor.js
A	backend/src/modules/invoices/invoiceCalculation.js
M	backend/src/modules/invoices/invoices.controller.js
M	backend/src/modules/invoices/invoices.router.js
M	backend/src/modules/invoices/invoices.service.js
M	backend/src/modules/invoices/invoices.validation.js
A	backend/src/modules/payments/paymentPosting.js
M	backend/src/modules/payments/payments.controller.js
M	backend/src/modules/payments/payments.router.js
M	backend/src/modules/payments/payments.service.js
M	backend/src/modules/payments/payments.validation.js
M	backend/src/modules/products/products.service.js
A	backend/src/utils/financial.js
A	backend/src/utils/idempotency.js
M	backend/tests/environment/migrations.test.js
A	backend/tests/environment/network-guard.test.js
A	backend/tests/financial/idempotency.test.js
A	backend/tests/financial/payments.test.js
A	backend/tests/helpers/financial.js
A	backend/tests/phase2/base-unit.test.js
A	backend/tests/phase2/calculation.test.js
A	backend/tests/phase2/catalog.test.js
A	backend/tests/phase2/invoices.test.js
M	backend/tests/release-blockers/financial.test.js
A	db/migrations/014_authoritative_billing_payments.sql
A	db/migrations/015_invoice_base_unit_snapshot.sql
A	docs/BILLING-PAYMENT-CONTRACT.md
A	docs/PHASE-2-CHANGE-MANIFEST.md
A	docs/PHASE-2-FRONTEND-EVIDENCE.md
A	docs/PHASE-2-INDEPENDENT-REVIEW.md
A	docs/PHASE-2-REPORT.md
A	docs/PHASE-2-TEST-EVIDENCE.md
A	docs/PHASE-3-HANDOFF.md
M	docs/RELEASE-BLOCKERS.md
M	frontend/package.json
M	frontend/src/api/invoices.api.js
M	frontend/src/api/payments.api.js
A	frontend/src/components/InvoiceReview/InvoiceReview.jsx
M	frontend/src/components/PaymentModal/PaymentModal.jsx
M	frontend/src/components/ProductSearch/ProductSearch.jsx
M	frontend/src/hooks/useBilling.js
A	frontend/src/hooks/useFinancialMutation.js
M	frontend/src/pages/Billing/BillingPage.jsx
M	frontend/src/pages/Billing/QuickBillPage.jsx
M	frontend/src/pages/Invoices/InvoiceDetailPage.jsx
M	frontend/src/utils/billing.calculations.js
A	frontend/src/utils/financialIntent.js
M	frontend/tests/browser.test.js
A	frontend/tests/financial-browser.test.js
A	frontend/tests/financial.test.js
A	scripts/local-only-network.cjs
A	scripts/run-local-tests.cjs
M	scripts/test-db-tls.sh
A	shared/billing-fixtures.json
```
