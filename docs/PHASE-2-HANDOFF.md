# Phase 2 handoff — do not start without a separate task

Base commit: `5404f98b27eb8c326aa3ebc603ee43efe6394404`.
Phase 1 branch: `codex/phase-1-security-baseline`; consult the final report for the
candidate diff and verification state. The original checkout's AI/mobile changes
are excluded and preserved. No Phase 2 financial repair is included.

Start with `docs/LOCAL-DEVELOPMENT.md`, `docs/PHASE-1-REPORT.md`,
`docs/RELEASE-BLOCKERS.md` and `backend/tests/release-blockers/financial.test.js`.
Run those assertions unchanged against disposable PostgreSQL; all nine identified
financial defects currently fail their desired-behavior checks.

## Contract work

- Define authoritative sale inputs: product identity, selected unit/quantity and
  allowed price/discount decisions. Server derives base quantity and purchase-cost
  snapshots inside the transaction. Preserve existing issued invoice snapshots.
- Decide Quick Bill customer/debt semantics explicitly. Reconcile invoice totals,
  payments, payment splits and append-only customer ledgers. Never patch balances
  merely to make a test green.
- Bind sales returns to original invoice item, product, remaining quantity and
  historical valuation. Aggregate duplicate lines before validation and handle
  concurrent returns transactionally. Bind purchase returns to purchase items.
- Define durable idempotency for all financial mutations before introducing any
  browser retry. Existing Phase 1 clients deliberately do not replay mutations.
- Keep cashier billing disabled until its cost/quantity API no longer needs private
  financial fields. Do not broaden roles to work around redaction or UI errors.

## Schema and evidence

Historical SQL migrations 001–011 are preserved. Migration 013 adds revocable
sessions and the conservative role boundary. The reserved 012 was not fabricated:
no confirmed schema gap requiring that migration was found. The new runner records
IDs/checksums, rolls back failures and locks concurrent application. Existing
untracked schemas require the documented verification/baselining process.

Use `db/reconciliation/phase-2.sql` only in a read-only transaction on an authorized
copy. It checks cached balances, invoice/item totals, returned quantities, payment
splits, purchase-return identity and latest ledger stock. Differences are leads,
not automatically repairable errors. Inventory opening balances and missing ledger
entries require independent evidence.

Preserve negative-stock constraints, append-only triggers, atomic transactions and
immutable snapshots. Add forward migrations for confirmed gaps; do not alter
historical migration bytes or reset real data. Regression tests must cover both
success and failure/concurrency behavior on real PostgreSQL. Revalidate browser
contracts and the release-blocking suite before requesting production approval.

## Containment and operational handoff

PDF generation, report PDF exports and supplier attachments are unavailable by
design. There is no environment flag to bypass this. Pure invoice HTML formatting
has escaped text and an allowlisted template, but is not a verified browser renderer.
Existing background workers must be stopped during any later controlled rollout.

Opaque HttpOnly sessions replace bearer tokens. Deploying old backend code again
would restore known security weaknesses; prefer forward fixes. See the security
runbook for session invalidation, TLS, secret rotation and recovery sequencing.
