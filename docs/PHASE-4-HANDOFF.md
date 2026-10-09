# Phase 4 handoff

Phase 3 is implemented and locally verified, but **production release remains BLOCKED**. This document does not authorize Phase 4 implementation, committing/pushing, deployment, production access, live secret rotation or data/history rewriting. Keep PDFs, supplier attachments and cashier billing disabled.

## Preserve the delivered candidate

Continue only in `/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp`, branch `codex/phase-1-security-baseline`. HEAD remains `724dc8e3e4dc7c7667388d5fedfb0cbd9d8b9dee`; Phase 3 is uncommitted/unstaged. Preserve current files, temporary-index snapshot evidence, `refs/codex/phase-3-starting-candidate` and earlier recovery refs. Do not reset/reclone or touch the original checkout's separate AI/mobile work. Read `PHASE-3-REPORT.md`, `PHASE-3-TEST-EVIDENCE.md`, `PHASE-3-CHANGE-MANIFEST.md`, `INVENTORY-RETURN-CONTRACT.md`, `RELEASE-BLOCKERS.md` and `SECURITY-RUNBOOK.md` before new work.

The next migration ID must follow the actual repository list (currently 017). Do not invent 012, edit applied SQL or stamp an untracked historical database. Synthetic 016/017 upgrade proof is in `PHASE-3-MIGRATION-EVIDENCE.md`; it does not authorize live migration.

## Facts later settlement must preserve

- Ordinary invoice: original issued total = actual allocated cash receipts + proven linked return credits applied to that invoice + remaining due. Do not reduce original total or rewrite amount paid to imitate a refund.
- A registered-customer return posts its full credit once. `sales_return_applications` records applied versus unapplied credit; application does not post a second ledger credit. Unapplied customer credit is traceable and unallocated, not cash refunded.
- Supplier returns bind original receipt lines and cumulative quantities/value. Their stock movement is already posted; the linked debit note is outstanding. Settlement must not deduct stock again.
- Original selected-unit quantity/price, base-stock quantity/unit, tax, discount and cost snapshots are immutable evidence. Cumulative partial allocations exhaust original cents exactly; do not replace them with current catalog values or independently rounded slices.
- New purchase value is exact at its stored scales; current per-base cost is rounded and follows last-posted receipt (including backdated posting). Stock is fungible, with no lot-level claim.
- Stock counts are immediate single-product/single-pool commands with expected stock and monotonic version. Metadata must never resubmit an absolute stock balance. Longer/multi-location stocktakes need a new reviewed contract.

## Phase 4 decisions before implementation

Define settlement ownership, permitted tenders, overapplication rules, dates, authorization, reversals and exact ledger effects for customer refunds, anonymous return liabilities, cross-invoice credit/advance allocation and supplier debit settlement. Keep unsupported cases blocked until each complete transaction is designed and tested. Do not turn existing unapplied credit into a payment, automatically net unrelated invoices, or represent an outstanding supplier debit as settled.

Retain `utils/idempotency.js`: authenticate/capability-check and compare original `Idempotency-Actor` before reservation or saved replay. Normalize submitted business intent/target, not mutable remaining credit/catalog data. Save all effects and the operation-specific receipt in one transaction. Preserve successful results; same intent/key returns them, changed intent conflicts, rollback leaves no permanent reservation. Frontend recovery must persist the original actor/key/payload/target before dispatch and validate the exact new receipt shape. A lost response or account switch is not permission to replace the operation.

Keep deterministic lock ordering: reservation → existing source document → sorted source lines → sorted products → customer/supplier. If allocation will involve multiple invoices/accounts, explicitly extend and test the order before coding. Preserve `requireReconciledInvoice` evidence checks and ledger append-only triggers; do not merely loosen guards to permit unexplained history.

Add valid controls, intended rejection codes and no-effect assertions first. Test payment/return/allocation overlaps with real PostgreSQL contention, same-key races, changed intent, actor switching, failure after each required write, committed lost responses and browser reload recovery. Re-run inherited 11 original invariants plus all supported Phase 1–3 checks; a narrow Phase 4 suite cannot replace them.

## Investigation and recovery

Use `db/reconciliation/phase-3.sql` read-only on an authorized copy. Separate receipts, applied/unapplied customer credits, supplier debit liabilities, original-line counters and stock movement sums. Ambiguous/null historical snapshots, unlinked notes and ledger gaps require independent evidence and a separately approved forward repair; never infer them from dates/IDs/current catalog, invent openings, reset counters or patch balances merely to pass a check.

Preserve logs and original pending financial intent during recovery. Retry the same uncertain operation under its original actor; do not clear it because a later request rejects. Wrong-target recovery must link back to its original document. Known rejected stale quotes/counts may be reviewed and submitted as a deliberately new operation. Failed forward migration must roll back and remain unjournaled; after a committed migration, use a compatible forward fix. Do not restore pre-Phase-3 posting code over modern evidence or the old JWT/document paths.

## Remaining release work

Local Phase 3 evidence: 193 backend, 11 original release, 40 frontend unit/auth and 33 browser tests passed; migrations and clean installs passed. The initial frozen baseline concurrency failures remain honestly recorded as unexplained despite later unchanged green reruns. Current-source scanning is separate from unresolved historical credential disclosures.

Mandatory operator gates remain: credential revocation/rotation and access-event review; live TLS/proxy/private networking/grants; real backup/restore and historical schema verification; current immutable-image/Compose runtime; remote CI/protected checks/provenance and explicit release approval. Docker CLI was unavailable locally and no Phase 3 remote run exists. Earlier starting-commit image builds are not runtime proof. No live `.env` or old external API may be used for investigation; preserve the earlier incident report's known facts and uncertainty. Document reactivation, cashier rollout and statutory certification need separate reviewed scope.
