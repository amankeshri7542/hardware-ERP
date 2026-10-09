# Phase 4 — operational settlement and day close

Implemented admin-only customer advances/credit allocation/refunds, anonymous return liabilities, supplier payable/debit settlement, full explicit reversals, statements/aging, concrete-tender reporting and daily cash close. This is operator-confirmed local recordkeeping, not provider execution or accountant/statutory certification. **Production release remains BLOCKED.**

## Preserved work and boundary

Worktree `/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp`, branch `codex/phase-1-security-baseline`. Retained HEAD `724dc8e3e4dc7c7667388d5fedfb0cbd9d8b9dee`; complete starting tree `10f8cb81b2a87174a5750f5c6e8a54bbe34827c5` exactly matched the delivered uncommitted Phase 3 candidate. Temporary-index snapshots include untracked source without altering the real index or recovery refs. Phase 4 changes are measured against that tree, not HEAD. No reset/clean/stash/reclone/history rewrite or original-checkout edits occurred.

The final instruction explicitly authorizes commit/push, superseding the earlier no-commit sentence in the same request. Final commit includes the preserved uncommitted Phase 3 delivery plus Phase 4; `PHASE-4-CHANGE-MANIFEST.md` isolates Phase 4 changes. No deployment or Phase 5 work is authorized or performed.

## Checkpoints delivered

- **4A:** contract before posting code; reusable exact-money/idempotency and shared period gate; forward migrations018–021, explicit immutable source/application/tender/reversal evidence. Shop timezone is Asia/Kolkata. Historical unknown party identities remain null rather than being reconstructed.
- **4B:** same-customer multi-invoice advance/return-credit allocation, partial/full available-credit refunds, anonymous source-linked liabilities and discharge, direct receipt/event reversals. Allocation creates no money or duplicate account credit; source locks serialize competing consumption. Original issued totals/stock/cost evidence stays unchanged.
- **4C:** explicit acknowledged supplier payable recognition, same-supplier debit application/payment/refund/reversal; effective-date statements, as-of availability and aging, full filtered summary/export datasets, formula-safe CSV/XLSX, separate sales/returns/profit/collections/refunds. Day opening uses an explicit float; close stores immutable cash components/count/discrepancy and blocks old/new backdated writers. No balancing entry is fabricated.
- **4D:** PostgreSQL restricted-role concurrency/rollback/replay checks, clean scenario distinct from corruption fixtures, fresh/populated upgrades, guarded browser recovery, independent read-only review and operator handoff. Final browser/build results are recorded in `PHASE-4-TEST-EVIDENCE.md`.

Screens preserve intent before dispatch, including actor/key/exact payload/source/targets. Lost response, reload or actor switch recovers the same result. A definite first rejection can be reviewed again; a later rejection does not erase an earlier uncertain attempt. Quotes show current source/target values and stale data rejects at confirmation. Reversals require explicit full opposite evidence on a later open date; allocated/consumed sources require explicit dependency reversal first.

## Verification and review

Complete backend **264/264** and original release **11/11** pass; backend lint/syntax, native TLS/nginx, locked offline installs, fresh/populated migrations and current source scans pass. Detailed commands, intermediate failures, manifests and frontend/browser results are in the test evidence and change manifest.

The clean scenario proves the requested5000/8000 advance,500 return-credit split, anonymous100 refund and supplier1000/200 examples, ending stock7 and closing cash3800 with zero unexplained discrepancies. A separate corruption database is detected. This is not a certificate for the accumulated fixture database or historical shop records.

Three specialists had distinct ownership: customer backend/tests; supplier/report backend/tests; frontend/recovery/browser. Coordinator owned shared contracts/migrations/periods/day-close/integration. A separate read-only reviewer inspected integrity, locks, permissions and recovery. Five actionable findings were fixed and statically re-reviewed: unusable supplier reversal payloads; receipt party filtering/pagination; definitive rejection recovery; stale day-date responses; missing unknown-invoice warning. Integration also aligned customer-dues report DTO/filter semantics. Reviewer ran no tests and made no edits; coordinator/specialist test evidence is separately attributed.

Inherited baseline failures remain visible: Phase3 initial82/84 concurrency and Phase4 initial32/33 metadata browser timeout. Later passes do not prove the original causes. A new dated concurrency-fixture failure was separately diagnosed and transparently adapted to the documented monotonic-date contract, retaining all original balance assertions plus a no-effect backdating regression.

Final frontend verification measured **88/88 unit/auth tests**, guarded lint/build success, and **59/59 complete browser cases** on a fresh database. A subsequent one-page customer posting-balance DTO correction passed a failing-before/passing-after affected browser journey (1/1) and repeated units/lint/build; full-suite versus later affected-check identities are explicit in the test evidence. The final locked clean build matches all six browser build files byte-for-byte. Independent static re-review resolved the balance finding and found no weakened assertions. Both historical recovery timeouts remain open.

## Limits and recovery

No general ledger, multicurrency, provider integration, automatic advance netting, write-offs, fees, non-trading cash movement, partial/cascading reversal, stock costing redesign or historical repair. Full source verification can be slow on fixture-heavy reports. Unknown historical obligations/receipts, damaged/quarantine returns and unsupported correction policies remain visibly blocked. See `FINANCIAL-SETTLEMENT-CONTRACT.md` and `PHASE-4-OPERATIONS.md` for supported commands and recovery.

Preserve all original source/application/refund/debit/cash/ledger rows and successful idempotency results. Recover using original actor/key/payload and compatible forward fixes. Do not revert to older posting code that ignores new settlement/period evidence or reintroduces insecure auth/documents. PDFs, supplier attachments and cashier billing remain disabled.

Final gate summary is recorded with the final verification manifest. Runtime images/Compose remain blocked by missing Docker; current remote CI needs candidate-specific evidence; historical credential disclosures, live transport/private-network/grants, backup/restore, protection/release approval and accountant acceptance remain mandatory pending gates. A push is not production approval.

## Gate status

A. **Phase 4 supported local workflow acceptance: BLOCKED.** The complete guarded browser suite passed 59/59, but earlier customer-advance response-wait and supplier-refund-reversal second-retry timeouts remain unexplained. No failure-time DOM was captured for those occurrences. Observed-promise, teardown and accessibility improvements do not prove their causes. No duplicate financial effect was demonstrated, but recovery reliability cannot yet be declared fully accepted. The final customer-history display correction has separate affected verification in the test evidence.

B. **Inherited checks:** current measured results and baseline failures are retained in the test evidence. The recurrent product-edit failure later captured a loading icon changing the accessible button name and received a stable-label repair; that does not explain the separate historical PostgreSQL concurrency failures.

C. **Runtime/remote/operator/credential/accountant gates:** native synthetic checks and forward migrations verified; Docker image/Compose execution unavailable; candidate remote CI requires its own result; two historical disclosures, live infrastructure/credential actions, backup/restore, financial-history reconciliation, report-scale performance and accountant acceptance remain pending.

D. **Full production release: BLOCKED.** Commit/push preserves a coherent reviewed candidate with the exact remaining blockers. No deployment or Phase5 work is performed.
