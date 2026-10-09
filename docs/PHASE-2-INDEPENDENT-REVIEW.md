# Phase 2 independent review

## Environment and invoice specialist review

The reviewer implemented the independent database/HTTP regressions and did not implement the financial application source or migration 014. Read-only review covered invoice normalization/calculation, quote/create transaction boundaries, migration 014, catalog price history and the explicit grant script. The integration assertions exercised the real authenticated application as the restricted runtime role.

No unresolved Phase 2 defect was found in those reviewed paths. The review found one integration defect during implementation: the new quote route returned 403 for an admin because it was absent from the central permission allowlist. The coordinator fixed the route capability. Regression coverage now proves admin quote success and cashier quote/post denial, preserving cost visibility boundaries.

Evidence assessed:

- Client names/HSN/tax/cost/base quantities cannot become accounting authority; product rows and sales conversions are loaded under transaction locks. Selected-unit quantities and rates reconcile with base-unit stock and cost. Five independent expected rounding fixtures persist exactly through wholesale HTTP, including a negative margin.
- Submitted normalized intent reaches idempotency before mutable catalog lookup. Replays survive later catalog edits; changed intent conflicts; a stale reviewed quote returns 409 and rolls back its reservation. Authentication/authorization run before the handler.
- Repeated products aggregate stock demand. Product IDs lock in ascending order before the customer. Tests prove one successful sale when two requests compete for the final stock and correct serialized running balances for two different-product sales plus a customer advance.
- A deliberately failing late tender insert leaves no invoice, items, stock movement, receipt, customer ledger/cache change or key reservation. Recovery with the same key then succeeds. Invoice posting does not alter catalog prices/history.
- Explicit catalog price edits lock the product and commit the full actor-attributed price snapshot with the edit. Injected history failure rolls everything back. Concurrent partial edits were observed waiting on the row, then produced complete snapshots and contiguous, non-reversed effective intervals.
- Migration 014 adds request identity and the nullable notes field, widens profit percentage storage and replaces the customer-ledger cache trigger for future inserts. It does not recalculate historical financial rows. A populated Phase 1 clone retained every original value in 20 existing tables and all 59 existing grants; explicit grants are required for the new table. Migration repeat, checksum rejection, interruption rollback, journal locking and untracked-schema refusal remain covered.

This conclusion is limited to the reviewed scope and local evidence. The original FIN-06/07/08 return invariants still fail with HTTP 201, and remain Phase 3 release blockers. No Docker container execution, live database reconciliation, production credential rotation or deployment was verified by this reviewer. The network policy proves guarded Node transport behavior; it does not constitute an OS/native-process firewall.

Reviewed source SHA-256 values (the final report must identify any later source changes):

- `backend/src/modules/invoices/invoiceCalculation.js`: `7d80ce6d2c0daabb78b4c7fcfda9f50958643ddd4a0b5f80fbb5200ef84eb26e`
- `backend/src/modules/invoices/invoices.service.js`: `f2153458158a781e56903295f7c84c1d6110b109562b80c8e52dbd177fb57113`
- `backend/src/modules/products/products.service.js`: `d86c5e0d2aa1924223b5e6e75bb712e8dbc4098005c43ac52a3551a7f9dbd364`
- `db/migrations/014_authoritative_billing_payments.sql`: `d2cc89dcad672281b1d05d586777d67f05f5c03ead523b672f4bd14c745a7467`

### Base-unit snapshot follow-up

The reviewer also examined the forward-only migration 015 and its invoice delta. Before implementation, two new API regressions failed with `undefined` instead of `piece`: the quote omitted the base-unit label, and the issued invoice reader omitted its unit snapshot after a catalog unit change. Both now pass. The quote derives `base_unit` from the locked product; invoice creation saves that exact value with its base quantity; invoice reads use the saved field instead of today's catalog unit. The quoted snapshot hash includes the unit meaning. Input normalization does not accept a client-supplied base-unit authority.

Migration 015 adds a nullable `invoice_items.base_unit_snapshot` only. A separate populated Phase 1 clone applied 014 and 015, preserving every original value across the same 20 tables and all 59 grants; all 13 historical invoice items retained null snapshots, with no guessed backfill. The repository migration regression now checks 013, 014 and 015 separately, including exact historical invoice-item values plus only the new null snapshot field. Repeat/checksum/lock/rollback coverage and lint pass. No unresolved finding arose from this delta.

- `db/migrations/015_invoice_base_unit_snapshot.sql`: `5424cb00f1dff35a90a293232ff7562cce27ec4bcdb51d1e7dfcb34d5977d8f9`

## Cross-agent review findings awaiting the final browser run

The payment/idempotency specialist independently reviewed the frontend. Findings included a typed precommit 404 leaving the operation trapped, and a stale keyboard-effect closure resetting the displayed draft while its persisted intent remained locked. The frontend specialist implemented fixes; their final combined browser rerun is pending at this point.

The frontend specialist independently reviewed backend payment and idempotency handling, including transaction ownership, authorization and request hashing before replay. That review reported no blocking backend defect. The payment/idempotency specialist also reviewed authentication and durable replay boundaries.

The coordinator's independent frontend review identified uncertain retries being cleared on some 4xx responses, a cross-tab storage race, missing base-unit labels, unintended repricing when switching units, and malformed HTTP 200 responses being marked completed. Fixes are present, with the final eight financial browser flows and four baseline browser flows still awaiting their consolidated rerun. This section records review findings and repair status; it does not claim that pending verification passed. The final coordinator report will record that outcome.

## Operation actor binding follow-up

A later coordinator review identified a cross-tab account-change race: an uncertain operation still displayed under actor A could be retried with the shared browser cookie now belonging to actor B. Because request keys are intentionally scoped per actor, that retry could create a second effect under B. The payment specialist captured the defect as an actual HTTP 201 where HTTP 409 was required; the frontend specialist separately captured the browser regression before repair.

The repair requires `Idempotency-Actor` on invoice and payment POSTs. The middleware verifies a canonical positive integer actor ID and equality with the authenticated session actor before validation, idempotency lookup or financial writes. Existing authentication and authorization run first. Missing/invalid actor headers return 400 `INVALID_OPERATION_ACTOR`; a different session actor returns 409 `OPERATION_ACTOR_MISMATCH`. This binds the persisted UI operation to its original actor without changing the valid independent-key scope for deliberately new operations by another actor.

The environment reviewer read the middleware and both route integrations, adapted the real HTTP fixtures and added an invoice regression for absent/invalid headers, account switching and original-actor recovery. That regression passes. The complete guarded backend command now passes 84 tests (environment 5, security 12, containment 13, financial 54), with zero skips. Final frontend and immutable-candidate verification remain a separate pending gate; the earlier `a02e7336` candidate proof is superseded by this repair.

Actor-binding source SHA-256 values:

- `backend/src/middleware/requireFinancialActor.js`: `ab89598d891edbc67262107e0eeb1723808cb6131118aa15f374e89d9d8cd691`
- `backend/src/modules/invoices/invoices.router.js`: `d77781b1ac2c3ccc5f7467a3eab62b4c1d87cfa61a4fa8cd43e0343d8a669e50`
- `backend/src/modules/payments/payments.router.js`: `c8c2aaf340308ea0451cab8d6c2f884ecc9c800f31ea8ad58a20790cf52e6cdf`

## Final review disposition

All described repair verification is now complete for tested tree `3c23c1cf6dd268c728467c136ac21b64f8462f22`. The final clean archive passed backend 84, frontend unit 12, real browser 13, PostgreSQL TLS 1 and nginx 1 tests with zero skips. The original release suite still has the same three deliberate Phase 3 return failures. There is no remaining Phase 2 blocker identified by these independent reviews; this does not authorize production release.

The security specialist independently reviewed the final CI configuration. Production mode is limited to the frontend build, both browser commands use the restricted runtime role with separate owner fixture credentials, proxy trust is limited to explicit loopback entries, application network preloads remain in place, authentication/authorization precede financial actor validation, and no deployment job was added. No blocking issue remained in that review.

The CI findings were substantiated during verification: an omitted loopback proxy setting caused five browser login failures after four passing journeys in an earlier archive, and a global test environment produced the wrong frontend build mode. The final runner/configuration supplies those settings explicitly, keeps rate limiting enabled and passed all nine financial browser journeys plus the four baseline journeys from the final exact tree. The source/test/migration/lockfile delta between the repaired application freeze and final tree was empty; only CI configuration and documents changed. All 267 files inside the final archive retained their original hashes after verification. Evidence logs are in `/private/tmp/hardware-phase2-final-3c23c1cf-evidence`.

Remaining limitations are unchanged: Docker execution is unavailable locally; historical credential disclosures, return invariants, production reconciliation and operator-controlled deployment gates remain open. The final commit may add documentation-only evidence updates after this tested source tree.
