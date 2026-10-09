# Inventory and return contract (Phase 3)

Final supported contract: `phase3-v1`. Verification is recorded in
`PHASE-3-REPORT.md`; settlement boundaries are in `PHASE-4-HANDOFF.md`.

## API and compatibility summary

All paths below are under `/api`. Existing session/capability checks remain in
force. Every new posting requires `Idempotency-Key` and `Idempotency-Actor`;
quotes and ordinary metadata updates do not reserve financial operations.

| Operation | Review / posting | Submitted intent |
|---|---|---|
| Sales return | `POST /invoices/:id/return/quote`, then `POST /invoices/:id/return` | `items: [{invoice_item_id, qty_returned}]`, `date`, `reason`, `disposition: "sellable"`, reviewed `quote_hash` |
| Purchase receipt | `POST /purchases/quote`, then `POST /purchases` | `supplier_id`, `date`, optional `notes`, `items: [{product_id, qty, unit, cost_price}]`, reviewed `quote_hash` |
| Supplier return | `POST /purchases/:id/returns/quote`, then `POST /purchases/:id/returns` | `items: [{purchase_item_id, qty_returned}]`, `return_date` (or matching `date`), `reason`, reviewed `quote_hash` |
| Product opening | `POST /products` | Explicit catalog fields, opening `current_stock`, optional complete `conversions` |
| Physical count | `POST /products/:id/stock-adjustments` | `counted_stock`, `expected_stock`, `expected_stock_version`, `date`, `reason` |
| Catalog edit | `PUT /products/:id` | Only changed fields; price or conversion changes also require `expected_catalog_version` |

Purchase `cost_price` is the agreed **price per selected unit**. For old purchase
callers only, computed `line_total`, `base_qty`, product-name fields and header
`total_amount` are accepted and discarded before normalization and intent
hashing. They cannot alter posted values. The new frontend omits them. This
compatibility policy does not extend to return assertions: conflicting original
product, cost, unit or quantity evidence is rejected.

A product edit reads product, conversions and version in one database snapshot.
The complete conversion replacement carries explicit boolean `is_sales_unit`
and `is_purchase_unit` flags; unchanged entries retain IDs. The old individual
conversion create/delete endpoints reject with `ATOMIC_CATALOG_UPDATE_REQUIRED`.
A stale price/conversion edit returns a conflict; reloading and reviewing is
required. Metadata forms omit unchanged loaded prices, conversions and stock.

The physical count is an immediate count of one product's single supported
stock pool. Both expected stock and monotonic stock version must still match,
including when intervening movements return stock to the same quantity. It is
not a long-running stocktake or a multi-location count; those need a separately
designed reconciliation workflow. Existing unexplained stock/ledger differences
fail with `STOCK_RECONCILIATION_REQUIRED` rather than being overwritten.

Frontend recovery validates each operation's receipt and original target.
Recovery after an unknown result uses the stored actor, payload and key. A later
domain rejection cannot erase earlier uncertainty. An operation opened on the
wrong document links back to its original document before editing; it does not
silently clear the saved intent. A lost response is recoverable, not permission
to submit a replacement operation.

This contract governs new supported postings. It does not authorize historical
repairs, cash refunds, cross-invoice credit allocation, supplier settlement,
FIFO/average costing, document rendering or deployment. Existing issued facts and
append-only history remain evidence. Unsupported cases fail before business writes.

## Identity, inputs and precision

Sales returns identify the original invoice and invoice item, a positive selected-
unit `qty_returned`, calendar return date, reason and explicit `sellable` disposition.
Duplicate original-line IDs are rejected; different original lines for one product
remain distinct. Optional submitted product/value assertions must agree with the
original evidence, or fail specifically. They never authorize another product or
replace issued values. Damaged/quarantine dispositions are unsupported.

Use the Phase 2 decimal helpers: selected/base quantities have three decimals,
conversion factors four, money two and IDs positive int32. Numeric strings are
normalized deliberately; invalid, nonfinite, out-of-range and excess-precision
inputs fail. Stock is never rounded: original base quantity × requested selected
quantity / original selected quantity must be exactly representable in thousandths.

New invoices have explicit sale/credit document identity independent of total sign.
A zero-value credit is still a credit and cannot itself be returned. New credits
link their source invoice and every source line. New purchase receipts similarly
record their calculation contract, selected unit/quantity/price and base-stock facts.

Historical null unit snapshots are not inferred from the current catalog, dates or
ID ranges. A Phase 2 sale is interpretable only with nonnull issued unit snapshots,
consistent original amounts and successful saved `invoice.create` evidence that
matches those issued facts. Otherwise require reconciliation. Unexplained old
return movements/counters or contradictory linked returns also require reconciliation;
do not reset counters, associate old notes by amount or rewrite old records.

## Sales return allocation and eligibility (3A)

The original `qty/unit` and `rate/discount_amount` refer to the selected sale unit;
`base_qty/base_unit_snapshot` and purchase-cost rate refer to the stock unit. Never
multiply a selected-unit selling rate by base-stock quantity.

For each verified original line, let Q be issued selected quantity and R cumulative
returned selected quantity, both integer thousandths. Recover original gross cents
as rounded rate × quantity; discount cents are gross minus issued taxable cents;
cost cents are issued taxable minus issued line profit and must match the cost
snapshot calculation. For each nonnegative component M (taxable, discount, GST,
cost), cumulative allocation is `round(M × R / Q)` with half-away-from-zero rounding.
The next return receives the new cumulative allocation minus the prior allocation.
Derive gross = taxable + discount, credit = taxable + GST and profit = taxable − cost.
Do not independently allocate gross and taxable and subtract their deltas: that
can create negative discount slices. Persist allocated line amounts, including
gross/discount evidence, rather than reinterpreting per-unit discount as a line total.
The last eligible return therefore receives residual cents and exactly exhausts
the original quantities and values; earlier partial returns never exceed them.

Require active source products and registered customer, with the current stock
unit matching the original stock-unit snapshot. Price, tax and alternate-conversion
changes do not change return value. Inactive records require an explicit operator
decision/reactivation; a changed stock-unit meaning requires reconciliation.
The supported first version rejects anonymous returns with a specific settlement-
required error, including zero-value anonymous documents. It supports registered-
customer zero-value sales and credits with durable document identity.

Lock and reconcile the source before posting; counter quantities must agree with
durable linked credit items. A forward, nonvalidating historical counter constraint
and conditional bounded counter update protect new writes without repairing old
rows. Return quotes show remaining eligibility and authoritative allocations.
Posting rechecks the submitted quote hash under locks; stale material facts require
review. Requests without a quote still receive the same server validation.

## Receipts, applied credit and liability (3A)

Preserve original issued totals and actual cash/tender receipts. Every registered-
customer credit, including a Quick Bill credit, posts the entire credit to the
customer ledger once. Persist one immutable linked application per credit document:
total credit = applied to original invoice + unapplied customer credit. Applying
credit does not post a second ledger credit and does not imply a refund.

Apply at most the original invoice's current due under its lock. Excess remains a
traceable unapplied customer credit. For a supported sale, original total must equal
actual allocated receipts + proven linked applied credits + remaining due. Keep all
existing ownership, tender and historical-reconciliation checks; extend them to
verify the credit document, source items, application and matching ledger entry.
An invoice of 1000, paid 400, then credited 200 has 400 due and can receive that final
400 payment. Credit documents display issued/applied/unapplied credit, never a
cash-refund assertion. Cross-invoice application and cash refunds remain Phase 4.

## Receipts, supplier returns and stock commands (3B)

Purchase inputs are active supplier/product IDs, date, selected supported purchase
unit/quantity, and an explicitly agreed price per selected unit. The server derives
line/header totals and base quantity. Snapshot original unit/conversion, price and
amount for later supplier returns. Never store a box price as a per-piece current
cost. Current per-base cost is the agreed selected-unit price divided by the issued
conversion, rounded to cents; receipt totals retain their independent exact posted
amount. This is the existing last-posted-receipt policy, not a stock valuation engine.
Backdated receipts still update current cost when posted. If several receipt lines
concern one product, their explicit submitted order determines the final current
cost; each line retains its own issued value. Record the justified cost/history and
supplier-link changes in the receipt transaction.

Supplier returns require original `purchase_item_id` and selected return quantity.
Supplier/product/cost and base movement come from the original receipt. Use the
same cumulative amount allocation/exact stock proportionality rules; bind optional
assertions and reject conflicts. Bound cumulative source quantities and aggregate
stock demand per product before checking availability. Stock is fungible: no claim
is made that physically returned goods came from a tracked lot. A posted supplier
return atomically records its debit note as outstanding and its stock effect as
posted, not an unprocessed pending action. No supplier settlement is performed.

New product opening stock and its actor-attributed opening movement are atomic.
Do not manufacture openings for existing balances. Ordinary metadata edits cannot
write stock, and unchanged loaded prices must not be resent as price decisions.
Price/conversion changes must be explicit, authorized and checked against a catalog
version. Replace conversion sets atomically under the product lock, preserving
unchanged entries and explicit sales/purchase flags. Reject casual base-unit changes
when stock or history exists. A sale and a conversion change serialize on the same
product lock; a stale reviewed sale is rejected.

An explicit stock-count command requires a reason, actor, expected stock quantity
and monotonic stock version. A stale count conflicts instead of overwriting a sale.
It is an immediate count of this one supported stock location, not a prolonged or
multi-location stocktake. Unreconciled legacy stock requires investigation; it is
not repaired by inventing an opening movement. Reconciliation separates historical
gaps from opening + receipts + sales returns − sales − supplier returns ± adjustments.

## Transactions, locks and recovery (all checkpoints)

Authenticate and authorize first; compare `Idempotency-Actor` with the actual session
before reservation or saved-result replay. The actor header grants no authority.
Use one durable idempotency transaction for every new purchase, return and explicit
stock-affecting command. Hash normalized submitted operation/target/intent, not
newly read catalog or remaining-balance values. Same key/intent replays the original
successful result; changed intent conflicts; rollback releases the reservation.

Global order: reservation → existing source document → its source lines sorted by
ID → products sorted by ID → customer/supplier account. Sales without an existing
source start at products; payments use invoice then customer. Conversion edits and
stock commands lock product before dependent rows. Read immutable linked credit
evidence without taking a later reverse-order credit-header lock. All headers,
items, counters, stock movements, account postings/applications/debit notes, audit
changes and the successful response commit together.

The frontend persists original actor, operation, target IDs, exact payload and key
before dispatch. Each operation has its own successful-receipt validator. Lost
responses, reloads and account switches retain the original intent for explicit
recovery. Uncertain completion never becomes a replacement operation merely because
a later retry fails. No automatic mutation replay follows login. Preview/receipt
screens distinguish selected/base units, remaining eligibility, applied/unapplied
credit and actual balances. PDF/attachments and cashier billing stay disabled.
