# Phase 3 handoff: returns and inventory

Phase 2 repairs new sales and receipts. It does not certify returns, purchase
posting, inventory adjustments, historical financial data or document delivery.
Use PHASE-2-REPORT.md for the tested tree, exact results and commit state.

## Preserve the unresolved invariants

The original release suite is retained at
backend/tests/release-blockers/financial.test.js. Its fixture adaptation supplies
the new due-date/idempotency contract and uses the restricted application role;
the return assertions still expect rejection and still fail:

- FIN-06: duplicate full sales-return lines must not exceed the sold quantity.
- FIN-07: a returned product must match the referenced original invoice item.
- FIN-08: purchase returns must bind product, remaining quantity and historical
  cost to the original purchase.

These were labeled broadly as Phase 2 returns in the earlier blocker list. The
current user-approved boundary assigns them to Phase 3. They were not reclassified
because of test difficulty, removed, skipped or inverted into passing bug tests.

## Required design work

Bind returns to immutable original item snapshots, aggregate duplicate requests,
validate remaining returnable quantities under locks and define selected-unit
versus base-stock quantities explicitly. New Phase 2 invoice lines store qty/unit
as the selected sales unit, rate/discount per selected unit, base_qty for stock,
and purchase cost per base unit. New base_unit_snapshot records the stock unit;
historical null snapshots must not be inferred from the current catalog.
Pre-Phase 2 issued snapshots may use different
semantics: do not infer or overwrite them without evidence.

Reconcile credit notes, stock restoration, invoice debt and customer credit under
concurrent returns. Preserve legitimate negative credit documents. The current
return code retains known binding/concurrency problems and has not adopted
durable idempotency. Payments conservatively reject historical invoices that fail
header/receipt/tender/ledger reconciliation; do not remove that guard to hide a
return or historical inconsistency.

Adopt utils/idempotency.js only after normalizing the original submitted return
intent, authenticating/authorizing, and placing result plus all business writes in
its transaction. Do not hash mutable newly recalculated cost data. Test duplicate,
conflicting and concurrent keys, rollback and a committed response lost in transit.

Lock ordering for Phase 2 is key, existing invoice where relevant, sorted product
IDs, then customer. Extend one consistent order across inventory/returns; tests
must exercise overlapping products and customers. The new ledger trigger
serializes customer postings and sets only the new running balance/cache from
ledger rows. It does not repair historical balances or return calculations.

## Boundaries and operators

Do not rewrite migration bytes or ledger history. Continue with the next available
forward migration after the delivered Phase 2 migration(s); do not invent 012.
Rehearse an upgrade on populated synthetic data with actual restricted grants.
Use db/reconciliation/phase-2.sql read-only; discrepancies are evidence to
investigate, not permission for automatic corrections.

Keep cashier billing, PDF rendering and supplier attachments disabled. Advance
allocation, refunds and supplier settlement remain Phase 4 work. Historical secret
rotation, live TLS/networking, image runtime, backup restoration and release
approvals remain operator gates. No deployment is authorized by this handoff.

## Retry actor binding

Invoice/payment mutations now require `Idempotency-Actor` to match the authenticated user before any key lookup or financial write. The frontend stores that original actor with the exact pending intent; a cookie replaced by another tab must not rebind the operation. Future return/purchase adoption must retain this guard after authorization and test lost-response recovery across a cross-tab account switch. Those operations are not protected by this mechanism yet.
