# Phase 2 report — authoritative billing and payments

Phase 2 implementation and final verification of the frozen source are complete. Full production release remains **BLOCKED**. This work does not declare Phase 1 complete or authorize deployment.

## Candidate and scope

- Existing isolated worktree: `/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp`.
- Branch: `codex/phase-1-security-baseline`.
- Starting committed HEAD: `5404f98b27eb8c326aa3ebc603ee43efe6394404`.
- Preserved Phase 1 staged tree: `0e0a2c19acac02660fd4981765f5426059f14197` (129 staged paths, no unstaged changes).
- Frozen Phase 2 source/test tree: `e84f7b81374e5c852ab18dc82835c548ea95b231`.

Both trees are retained locally under `refs/codex/phase-1-starting-candidate` and `refs/codex/phase-2-tested-source` so Git garbage collection cannot discard these recovery snapshots. Only the requested branch is pushed.

No reset, clean, stash, reclone or branch checkout occurred. The original checkout's separate AI/mobile/UI work remains untouched. The user authorized committing and pushing the combined candidate on this branch. The final response records the actual commit and remote reference after delivery; there is no deployment authorization.

The [contract](BILLING-PAYMENT-CONTRACT.md) defines submitted inputs, safe compatibility for legacy derived fields, units, precision, rounding, discounts, payment/debt rules, transaction boundaries and retry recovery. The [change manifest](PHASE-2-CHANGE-MANIFEST.md) separates Phase 2 changes from the preserved Phase 1 tree.

## Delivered behavior

New ordinary invoices derive product identity, tax, stock quantity and purchase-cost snapshots from locked active records. Scaled-integer decimal calculations price the selected sale unit while using base quantity for stock and cost. Exactly one fixed-per-unit or percentage discount is accepted. Distinct lines remain distinct and stock demand is aggregated per product.

Retail, wholesale and registered-customer Quick Bills share customer ledger rules. A walk-in name does not identify an account. Anonymous Quick Bills require full payment; customer debt requires a valid due date. Checkout and standalone receipts share exact tender validation, ownership checks and explicit overpayment rejection. Existing customer advances remain supported without introducing allocation or refunds. Historical invoice inconsistencies reject further payment with a reconciliation error rather than rewriting old records.

Invoice headers/items, payment/tender rows, customer postings, stock movements and the successful idempotency result commit together. Locks follow a documented order. Concurrent same-key submissions produce one effect; changed intent conflicts. The canonical hash uses submitted intent rather than mutable catalog values. Authorization precedes replay, and an original-actor header prevents another tab's replacement session from turning a retry into a new sale or payment.

Frontend previews use shared decimal fixtures. The server quote is reviewed before posting and checked again under locks. Durable operation keys, payloads and original actors survive lost responses, reloads and session expiry. Ambiguous results keep the draft locked for explicit recovery. Cross-tab Web Locks and storage updates prevent parallel mutations of one pending intent. Issued stock-unit snapshots remain stable after catalog changes.

Sales no longer change catalog prices. Explicit authorized product price edits lock the product and atomically write attributed price history. Cashier billing, PDF generation and supplier attachments remain disabled. No FIFO, moving-average valuation, statutory tax certification or new accounting engine was introduced; the supported valuation remains current product purchase cost per base unit. Credit limits remain advisory.

## Migrations and data preservation

- `014_authoritative_billing_payments.sql`: durable idempotency, serialized future customer ledger postings, invoice notes, disabled PDF status and sufficient precision for legitimate negative profit percentages.
- `015_invoice_base_unit_snapshot.sql`: authoritative base-unit snapshots for new invoice lines. Historical rows remain null rather than being inferred from today's catalog.

Historical migrations 001–011 and 013 are unchanged; no migration 012 was fabricated. The populated synthetic upgrade preserved data across 20 tables and 59 grants. Thirteen existing invoice-item base-unit snapshots stayed null; a second migration run applied zero migrations. Application integration tests use the restricted application role. No issued invoices, ledger history or historical balances were rewritten.

## Reproduction and verification

The original release suite ran against the preserved Phase 1 tree with synthetic authentication and real PostgreSQL: **11 tests, 2 passed, 9 failed, 0 skipped**. Failures reached their intended financial assertions; authentication, grants, fixtures and connectivity were working.

| Original tests | Phase | Result after repair |
|---|---|---|
| FIN-01 base quantity; FIN-02 cost snapshots; FIN-03 excessive discount | 2 | Pass with authoritative calculation and atomic rejection |
| FIN-04 Quick Bill receivables; FIN-05 tender mismatch | 2 | Pass with common ledger/payment posting |
| FIN-09 duplicate invoice retry | 2 | Pass with durable one-effect replay |
| FIN-06 duplicate sales-return quantities; FIN-07 wrong-product sales return | 3 | Still fail: invalid requests are accepted |
| FIN-08 unbound purchase return | 3 | Still fails: product/quantity/cost are not bound to original purchase |
| Existing negative-stock and append-only ledger protections | Retained safeguards | Pass |

The full release suite remains **8 passed, 3 failed, 0 skipped**. The three return failures remain visible, with their original desired-behavior assertions. Fixture changes transparently supply due dates, actor/key headers, restricted-role access and synthetic opening stock. No assertions were deleted, skipped or inverted. Classification follows the requested phase boundary and asserted invariant; it is not based on implementation difficulty.

Regression tests were added before repairs. Recorded red cases included box pricing of 2000 instead of 200, fractional discount rounding of 0.16 instead of 0.15, forged snapshots, malformed/excess tenders, numeric-string payments, historical reconciliation drift, failed price-history writes, missing unit snapshots and duplicate retry effects. The last review reproduced an account-switch retry creating two invoices under different users; the fixed browser journey rejects the switched-account retry and recovers the original invoice after signing back in.

Final clean-install verification of tree `e84f7b81374e5c852ab18dc82835c548ea95b231` passed: backend **84** (5 environment, 12 security, 13 containment, 54 financial), frontend unit/auth **12**, browser **13** (9 financial, 4 Phase 1), native database TLS **1** and nginx fallback **1**, all with **0 skips**. Fresh `npm ci` installed 417 backend and 241 frontend packages; lint, syntax and the production build passed. Application source, tests, migrations and lockfiles were unchanged during verification; subsequent finalization changes only documentation.

Exact commands, logs, counts and source identities are in [test evidence](PHASE-2-TEST-EVIDENCE.md) and [frontend evidence](PHASE-2-FRONTEND-EVIDENCE.md). The [independent review](PHASE-2-INDEPENDENT-REVIEW.md) records financial, concurrency, retry, permission and frontend/backend findings and dispositions. All in-scope blocking findings were fixed before the source freeze. Final CI review also corrected production build mode, restricted-role browser execution and the synthetic loopback proxy setting; independent review confirmed that guards, permissions and the no-deployment boundary remain intact.

## Final gates

| Gate | Status and limits |
|---|---|
| A. Phase 2 billing/payment gates | **PASS** for the supported contract: real PostgreSQL/API transactions, restricted-role execution, concurrency, retries and browser recovery. This does not certify returns or production release. |
| B. Inherited Phase 1 runtime/operator gates | Native TLS, nginx, session, permissions and containment regressions pass. Remote engineering CI and both API/web image builds pass on code commit `726af321e7828390a10cb30413260084ef0fe934`. Docker remains unavailable locally; Compose, application-image runtime and Redis integration remain unverified. Live credential rotations, real TLS/networking/grants, backup restore and release governance remain pending. |
| C. Remaining financial/return/document blockers | FIN-06/07/08 remain Phase 3 failures. Documents and cashier billing remain intentionally disabled. Historical secret rotation remains an operator action. |
| D. Full production release | **BLOCKED** |

Tracked candidate secret scan: **0 findings**. History scan: **2 unresolved findings**, a historical GitHub PAT in `.context/KNOWN_ISSUES.md` and historical JWT in `backend/.env`; values were not printed. Removing current files is not evidence of revocation. Frontend build retains a large-bundle warning (about 1.508 MB JavaScript / 468 kB gzip). No configured typecheck exists for this plain-JavaScript project; lint, syntax checks and build were used.

## Runtime containment and recovery

Phase 2 test processes preload the local-only Node network guard before startup; browser contexts block external routes, WebSockets and service workers before navigation. Tests use synthetic credentials and no live `.env`. Dependency installation and documentation retrieval are separate tooling operations. The Phase 1 incident remains as recorded: an external request attempt using synthetic credentials cannot be ruled out and its outcome is unknown. No investigation contacted the old API.

If recovery is needed, stop posting while preserving the database and evidence. Keep committed idempotency results so users can retrieve completed operations. Do not reintroduce insecure sessions, rendering, catalog mutation during sales or history rewrites. Use read-only reconciliation to investigate discrepancies, then rehearse a reviewed forward fix on a populated copy. There is no automatic down migration or historical balance repair.

Continue only with the [Phase 3 handoff](PHASE-3-HANDOFF.md) when separately requested. Return/inventory repairs and Phase 4 allocations, refunds and supplier settlements were not implemented here.

## Local artifacts and shutdown

The tested archive is `/private/tmp/hardware-phase2-final-e84f7b81`; logs, source manifests and the machine-readable summary are in `/private/tmp/hardware-phase2-final-e84f7b81-evidence`. The final source manifest matched all 267 archived source files. The production bundle SHA-256 is `d7430b3e6d1f2abe949b2c1af966052305f79d6a4dc91e45f6f06e0b6f93f999`.

Browser, nginx and temporary TLS database processes were closed after tests. The coordinator then stopped only the owned disposable PostgreSQL cluster at `/private/tmp/hardware-phase1-pg-5r5p2izn/data` with `pg_ctl -m fast -w stop`; its synthetic databases and evidence remain available. Other local services were not stopped.

## Remote CI and delivery evidence

Code commit `726af321e7828390a10cb30413260084ef0fe934` is pushed to `origin/codex/phase-1-security-baseline`. [Remote CI run 37910576845](https://github.com/amankeshri7542/hardware-ERP/actions/runs/37910576845) completed with **engineering PASS**: real database migrations, restricted-role financial/auth tests, frontend units/build/browser journeys, TLS/nginx smoke checks, dependency gate, current tracked-secret scan, and both API/web Docker image builds. No images were pushed or deployed. Image builds do not establish Compose or application-image runtime readiness.

The separate production-release job **failed as expected** on the original desired-behavior assertions FIN-06, FIN-07 and FIN-08: **11 tests, 8 passed, 3 failed, 0 skipped**. Its historical-credential gate also failed on the same two redacted findings. The overall workflow is therefore red; this does not waive either release gate. The remote release log is saved locally at `/private/tmp/hardware-phase2-ci-37910576845-release.log`.

The first pushed code candidate (`ca8696b54db87bbc583c9f778374c0ef96b2f028`, CI run 37908823765) exposed a payment-button accessibility failure after all payment recovery/database assertions passed. Local browser snapshots showed `loading Done`; a held real replay response reproduced spinner contamination of `Retry original payment`. The original CI timeout did not reproduce naturally locally, so no broader timing cause is claimed. Explicit accessible label/busy attributes fix the demonstrated defect. The existing exact Done assertion remains, with added refreshed invoice balance/history checks before teardown. Five repeated payment journeys, both full browser suites, independent review, the final clean archive and remote CI passed afterward.

The final follow-up after this verified code revision contains documentation only. The final response identifies the delivered branch HEAD; the frozen source tree above and CI code commit identify exactly what was tested. The original checkout's separate work remains untouched.
