# Handoff after Phase 4 — no Phase 5 implementation authorized

Preserve this candidate and its migration journal. Read `PHASE-4-REPORT.md`, `PHASE-4-TEST-EVIDENCE.md`, `PHASE-4-CHANGE-MANIFEST.md`, `FINANCIAL-SETTLEMENT-CONTRACT.md` and `RELEASE-BLOCKERS.md` before further work. Phase 4 is local operational recordkeeping, not provider execution, statutory accounts or production approval.

Supported settlement commands use immutable source/application/tender/reversal evidence and original actor-scoped idempotency. The original unapplied credit/debit-note amount is not current availability. Registered returns already credit the account once; allocations must never credit it again. Advances retain their actual receipt date; supplier settlements do not move stock. Modern anonymous returns create explicit source-linked liabilities and no registered account. Unknown legacy evidence stays blocked.

Retain issued prices/tax/cost/party snapshots. Current costing remains last-posted receipt/current-cost snapshots; stock is fungible. No FIFO, average costing, lots or multi-location stock was introduced. Reversals are full, explicit later-period records; there is no hidden cascade, deletion or external bank cancellation. Closed days cannot accept backdated parent or child postings. A failed/uncertain response must recover with the saved original actor/key/payload, never a replacement key.

Mandatory next decisions/evidence:

- Resolve the open Phase4 customer-advance response-wait and supplier-refund-reversal recovery-test timeouts with operation/response/control evidence; later green reruns alone do not clear it. Preserve separate unexplained Phase3 baseline concurrency failures. The recurring metadata-browser case later captured an accessible loading-icon name defect and received a stable-label fix; do not conflate that with the database failures.
- Rehearse current images/Compose and restore/reconciliation in a safely isolated runtime. Native and image-build evidence cannot replace that check.
- Revoke/rotate the two disclosed historical credentials and related account/session secrets as appropriate, review provider access, and verify live HTTPS/DB TLS/private network/proxy/grants. No live action was performed here.
- Obtain accountant/business acceptance of explicit payable recognition, source eligibility, reversal/effective-date rules, cash opening/discrepancy handling and statement semantics. Do not invent or repair historical obligations.
- Resolve legacy financial/source/stock discrepancies with an independently approved evidence-based repair plan; no backfill or ledger rewriting as a test shortcut.
- Review aggregate account/report performance on realistic synthetic volume. Verification currently favors complete source checks; customer dues can be slow on fixture-heavy databases.
- Define any expanded non-trading cash movements, partial/cascading reversals, damaged/quarantine returns or other unsupported policies before implementation.
- Keep PDF rendering, supplier attachments and cashier billing disabled. A future document phase requires isolated safe rendering/attachment lifecycle and separate rollout review; on-screen records/CSV/XLSX are not permission to reactivate rendering.

Use `db/reconciliation/phase-4.sql` read-only. The clean end-to-end scenario and deliberately corrupt negative database are separate; never call the accumulated test-fixture database clean. Preserve successful operation results and immutable evidence during recovery. Do not deploy or start Phase 5 from this handoff alone.
