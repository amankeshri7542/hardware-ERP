# Phase 2 billing and payment contract

This contract governs new ordinary sales and receipts. Existing issued invoices,
credit notes and append-only ledger history are not recalculated.

## Submitted intent and authority

An authenticated, authorized admin submits bill type (retail, wholesale or
quickbill), calendar date, registered customer ID or anonymous Quick Bill name,
and 1–500 lines: product ID, selected unit, selected-unit quantity and negotiated
selling rate per selected unit. Discount is either a fixed amount per selected
unit or a percentage, never both. Negotiated prices do not update the catalog.

IDs accept decimal integer strings. Money accepts finite numbers or plain decimal
strings with at most two fractional digits; quantities at most three, conversion
factors four, and percentages two. Scientific-notation strings, whitespace,
booleans, null numeric values, excess precision and values outside the existing
NUMERIC(12,2)/(12,3) storage ranges are rejected. Values are normalized before
hashing. Quantities are positive; rates and discounts nonnegative. Negative
ordinary sales are not credit notes.

The server locks and loads active products and active registered customers. It
derives names/HSN, GST from the product configuration, stock base quantity, and
cost from the product's current purchase_price per base unit. This preserves the
existing current-cost snapshot policy; it introduces no FIFO, average costing or
statutory tax engine. Product base_unit (fallback unit) defines stock units.
Alternate units must belong to that product, be enabled for sales and have a
positive conversion. Converted stock quantity must be exactly representable at
three decimals; unsupported fractions are rejected instead of silently rounded.
Quotes label the authoritative base unit. New invoice items preserve it in
base_unit_snapshot; migration 015 leaves historical rows null because today's
catalog cannot establish their original stock-unit meaning.

For compatibility, legacy client name/HSN/base_qty/cost/GST and computed-total
fields are explicitly discarded. They cannot affect calculations or retry
identity. Legacy alt_qty/alt_unit ambiguity is rejected: qty/unit now always
describe the selected selling unit. New frontend payloads omit derived fields.
Unsupported fields are rejected rather than becoming hidden accounting inputs.

## Rounding and persisted values

Arithmetic uses scaled integers (BigInt), never binary floating-point policy.
Rounding is half away from zero. Percentage discount first becomes a two-decimal
per-selected-unit discount; that discount cannot exceed rate. Gross line amount
and discounted taxable line amount are rounded to cents after multiplying by
selected quantity. Line discount is gross minus taxable, preserving reconciliation.
GST is rounded per line from taxable cents. Cost is purchase_price times base
quantity, rounded per line. Profit excludes GST and equals taxable minus cost.
Invoice totals sum rounded line amounts. Negative margins remain valid; a forward
migration widens profit percentage storage without changing historical values.

The frontend obtains an authoritative quote and explicitly reviews it before
posting. The quote includes selected units, stock quantity, tax and totals.
Posting rechecks its hash under transaction locks; changed catalog/quantity/tax
data returns QUOTE_CHANGED (409), requiring a new review. Older direct API clients
may omit a quote hash; their submitted price is an explicit negotiated decision.

## Customer and payment semantics

Retail/wholesale require an active registered customer. A walk-in name is not an
account. Anonymous Quick Bills must be fully paid, including zero-value sales.
Registered-customer Quick Bills use the same debit and credit ledger as every
other sale. Any unpaid balance requires a due date on or after invoice date.
Existing credit_limit remains advisory; this phase invents no new credit policy.

Checkout and standalone receipts share exact tender validation. Concrete modes
are cash, upi, bank and cheque; mixed is a derived header classification, never
a detail tender. Positive receipts need positive details whose cents sum exactly
to the header. Zero checkout payment has no tender rows. Unsupported excess
payment is rejected, never clamped; tendered cash/change is not implemented.
Invoice receipts require matching customer ownership and cannot exceed remaining
due or pay a negative credit note. Existing standalone receipts without an invoice
remain genuine customer advances, with a ledger credit; no allocation/refund
workflow is introduced.

## Atomicity, locks and retry behavior

One database transaction owns idempotency result, invoice/items, payments/tenders,
customer ledger/cache and stock/movements. Stock demand aggregates repeated
products, while invoice lines retain distinct prices/discounts. Lock order is
idempotency key, existing invoice (payments), product IDs ascending (sales), then
customer. Customer ledger insertion also serializes on that customer in a
database trigger, derives the balance from ledger rows, and sets the new row's
running balance and cache without rewriting prior ledger rows.

Every invoice/payment submission requires an Idempotency-Key scoped to actor and
operation and an Idempotency-Actor header identifying the originally captured
authenticated user. The server rejects a different current session actor before
posting or replay. This prevents another browser tab's login from turning a lost
response retry into a new operation under another account. The frontend retains
the original actor with its recovery state; a mismatch requires signing back in
as that account and retrying the same key, never silently rebinding the operation.
Canonical submitted business intent, including an optional quote hash,
is hashed before loading mutable catalog data. The unique reservation, successful
response and effects commit together. Same key/intent replays the original result;
changed intent returns 409. Concurrent copies wait and produce one effect.
Rollback releases the reservation. Authentication and authorization run before
replay. Keys have no automatic expiry in this phase. Direct API clients must also
send both headers; the actor ID is available from the authenticated session.

The frontend persists the key and exact submitted intent before sending, recovers
ambiguous completion with that same intent/key after reload, and starts a new
operation only for deliberately changed intent. Authentication expiry does not
automatically replay mutations. Purchases and returns are not yet idempotent;
later phases must normalize intent, authorize, then use the same transaction helper.

PDFs/attachments and cashier billing remain disabled. Returns, historical repairs,
advance allocation, supplier settlements and deployment remain outside this phase.
