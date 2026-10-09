# Phase 4 forward migration evidence

Local synthetic verification on 2026-10-09; no production adoption, historical financial repair or inferred snapshot backfill.

The starting schema ended at 017. Added, in order:

| ID | Purpose |
|---|---|
| 018 | Immutable settlement/application/tender, supplier payable, anonymous liability and day-close records; explicit shop timezone and new issued party snapshots |
| 019 | Correct anonymous snapshot field to existing `customer_name_walkin`; immutable modern receipt/tender evidence and close boundary |
| 020 | Close-boundary checks on child evidence inserts, preventing late tender/items/application rows from changing closed facts |
| 021 | Explicit supplier-payable recognition reason, preserving unknown historical values |

No applied SQL bytes or migrations 001–017 were changed. No 012 was invented. Migration 019 is a forward correction to 018, not an edited applied file.

Rehearsal harness: `/private/tmp/hardware-phase4-upgrade-021-proof.cjs`. Evidence directory: `/private/tmp/hardware-phase4-upgrade-021-evidence`; full output `/private/tmp/phase4-migration-rehearsal.log`.

Fresh `hardware_phase4_fresh_021_test` applied all twenty migrations through 021, then repeated with zero work. Populated `hardware_phase4_upgrade_021_test` was restored from a synthetic through-017 database and applied only 018–021. All **10,763 original rows across 22 tables**, 24 existing sequence states, 64 old table-grant entries and old migration checksums were preserved. New historical party/payment snapshots stayed null, and new settlement tables remained empty. Existing disposable source database was preserved.

After current `db/grants.sql`, the restricted role can lock immutable financial rows through column-specific `UPDATE(id)` permission, but actual id updates hit append-only triggers; amount updates/deletes are denied. Existing invoice/purchase/return/ledger immutability and negative-stock protections remain. The runtime role cannot change finance timezone configuration.

Fault harnesses created temporary **022** SQL files only in external rehearsal directories, never repository migrations. An injected SQL failure (42703), cancelled migration (57014), and competing runner were verified. Partial tables/columns/data/journal entries did not survive; prior rows and sequence states were unchanged; repeat run did no work. Normal application rollbacks can leave sequence gaps and must not reclaim them.

Command (synthetic owner credentials supplied as in the test evidence):

```sh
rtk proxy env PATH=/private/tmp/hardware-phase1-runtime/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin NODE_OPTIONS=--require=/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/scripts/local-only-network.cjs NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=55432 DB_USER=phase1_owner DB_PASSWORD=synthetic-phase1-owner-local-only TEST_APP_DB_USER=phase1_app TEST_APP_DB_PASSWORD=synthetic-phase1-app-local-only node /private/tmp/hardware-phase4-upgrade-021-proof.cjs
```

Live backup/restore, schema adoption, grants and transport remain operator gates. Recovery must preserve immutable source/application/refund/debit/cash/ledger and idempotency evidence. Use compatible forward fixes; do not revert to earlier posting code that ignores settlement evidence or closed periods.
