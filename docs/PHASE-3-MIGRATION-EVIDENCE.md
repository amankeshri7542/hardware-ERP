# Phase 3 migration evidence

Verified on 2026-10-09 in the isolated worktree `/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp`. Working-database application, fresh installation, populated upgrade, repeat execution, permissions, failure rollback, cancellation, and concurrent-runner rejection **passed** through migration 017. This is synthetic migration evidence, not production release approval.

## Source identities

| Source | SHA-256 |
|---|---|
| `016_original_line_sales_returns.sql` | `da720dba18479d02f89d4ced5c0b0ada40d6291c8094a8f1940d7fe9699f4d69` |
| `017_purchase_and_stock_contract.sql` | `de9b77b97ed9d40b3c6d01b4fe57c6a50ee715b4187397067476f76e14fbd70d` |
| `db/grants.sql` used for 016/017 | `aba8e1143cbce7a9dcd8c0aa41977ea4423e4bcdebb6c4ce63e923f2677e9d54` |
| `db/migrations/index.js` | `23d0dafd4d1d4381f31a9d1456894eb914ee28a67df74de5a8321b046ce997e9` |
| `scripts/local-only-network.cjs` | `b9d7a6e4330e55d89a228f1c0df272b9bcaf64b97ee1e156df5477d9674e82bd` |

The rehearsal froze all 16 actual SQL migrations (`001`–`011`, `013`–`017`) in an external evidence directory. All source checksums still matched afterward. Migration 016 was not rewritten after application; earlier migration journals were preserved. No migration 012 was fabricated. The temporary injected failure/cancellation fixtures are not repository migrations.

## Databases and commands

PostgreSQL 16.15 remained on the documented disposable cluster at `127.0.0.1:55432`. Node 24.21.0/npm 11.17.0 came from `/private/tmp/hardware-phase1-runtime/node_modules/.bin`. No live dotenv or disclosed credential was loaded.

| Database | Use and result |
|---|---|
| `hardware_phase3_backend_test` | Fresh working database through 015; applied 016, then 017; each second run applied none |
| `hardware_phase3_frontend_test` | Same staged migration and repeat results |
| `hardware_phase3_fresh_017_test` | Fresh rehearsal: all 16 migrations applied; repeat applied none |
| `hardware_phase3_upgrade_017_test` | Restored populated synthetic baseline through 015; applied only 016/017; repeat applied none |

The existing Phase 1/2 databases and both Phase 3 baseline databases were preserved. The populated rehearsal copied `hardware_phase3_backend_baseline_test` with `pg_dump --format=custom --no-owner`, then `pg_restore --no-owner --exit-on-error` into the new upgrade database. Both commands explicitly specified loopback host, port 55432, owner `phase1_owner`, and the respective database. The dump and its SHA-256 are retained in the evidence directory.

The exact migration argv, in the worktree root, were `node db/migrations/index.js --through=016` and subsequently `node db/migrations/index.js --through=017`, each repeated after applying grants. The shell equivalent of a recorded guarded working-database invocation is:

```sh
rtk proxy env PATH=/private/tmp/hardware-phase1-runtime/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=55432 DB_NAME=hardware_phase3_backend_test DB_USER=phase1_owner DB_PASSWORD=synthetic-phase1-owner-local-only NODE_OPTIONS=--require=/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/scripts/local-only-network.cjs node db/migrations/index.js --through=017
```

The same invocation used `DB_NAME=hardware_phase3_frontend_test` for the frontend database; boundary 016 used `--through=016`. Each database then received the current grants using:

```sh
rtk proxy env PGPASSWORD=synthetic-phase1-owner-local-only /opt/homebrew/bin/psql -h 127.0.0.1 -p 55432 -U phase1_owner -d hardware_phase3_backend_test -At -v ON_ERROR_STOP=1 -v app_role=phase1_app -f /Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/db/grants.sql
```

The frontend command changed only the database name. Native PostgreSQL tools are explicitly directed to loopback; the Node transport guard does not provide an operating-system firewall.

The external rehearsal harness was syntax-checked, then run with the guard before imports:

```sh
rtk proxy /private/tmp/hardware-phase1-runtime/node_modules/node/bin/node --check /private/tmp/hardware-phase3-upgrade-017-proof.cjs
rtk proxy env PATH=/private/tmp/hardware-phase1-runtime/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=55432 DB_USER=phase1_owner DB_PASSWORD=synthetic-phase1-owner-local-only TEST_APP_DB_USER=phase1_app TEST_APP_DB_PASSWORD=synthetic-phase1-app-local-only NODE_OPTIONS=--require=/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/scripts/local-only-network.cjs node /private/tmp/hardware-phase3-upgrade-017-proof.cjs
```

The harness uses only the two named rehearsal databases and frozen SQL files. Its SHA-256 is `b9995193a8ca1f912a3467cfe91516d72ded684e96bf3679ede2b0305dcb4c05`. Commands were captured by external Python subprocess wrappers with explicit environment, exit code, and logs; the shell forms above express those same arguments and guard configuration. All operations completed with exit 0 except deliberately denied permission probes and deliberately injected failures.

## Preservation and permissions

The populated upgrade compared every original column value, with deterministic row serialization, before and after migration. It preserved **1,169 rows across 21 tables**, **23 existing sequence states**, **62 existing table-grant entries** before regranting, and every preexisting migration-journal entry. Per-table counts and SHA-256 hashes are retained. Existing invoice, receipt, tender, stock, customer-ledger, return, and debit-note values were not rewritten.

New historical document identity/source/allocation fields remained null. Newly introduced purchase-item return counters and product versions were zero; no historical identity or valuation was inferred. `sales_return_applications` began empty. Existing historical base-unit snapshots were preserved as originally stored. Source quantity checks deliberately remain `NOT VALID` for existing history; this proof does not certify or repair that history.

Direct connections as `phase1_app` verified `sales_return_applications` SELECT and INSERT allowed, UPDATE and DELETE denied with SQLSTATE **42501**, and sequence USAGE allowed. Actual zero-row operations inside rolled-back transactions matched the privilege metadata in both working databases. Customer/stock ledgers retained SELECT/INSERT and denied UPDATE/DELETE. Purchase, purchase-item, purchase-return, return-item, supplier-debit, and product tables retained SELECT/INSERT/UPDATE and denied DELETE; modern-evidence update restrictions are enforced by row triggers.

The fresh and upgraded rehearsal databases each passed these transactional fixture probes, with no persisted fixture rows and no advancement of existing sequences:

- Five modern purchase/return/debit evidence UPDATE attempts rejected by immutability triggers; five application-role DELETE attempts denied by grants; five owner DELETE attempts rejected by the same evidence triggers.
- Purchase notes and source-line `qty_returned` updates remained allowed. Negative and excessive returned quantities were rejected by `purchase_returned_bounds`.
- A stock change incremented only `stock_version`; a price change incremented only `catalog_version`. Negative stock was rejected.
- Schema inspection confirmed the new constraints, posted purchase-return status, and enabled modern-evidence/product-version triggers. Migration 016's credit/application triggers remained enabled.

Fixtures used an owner transaction with explicit unused negative IDs, then `SET LOCAL ROLE phase1_app` for restricted-role mutation probes. Owner trigger probes used `RESET ROLE`; the transaction was rolled back. Independent permission metadata/zero-row probes used actual application-role connections.

## Failure and recovery proof

In the populated copy, a temporary next-migration fixture created a table, inserted a row, added a purchase column, changed existing stock, then referenced a missing column. The runner rejected SQLSTATE **42703**. The table and column disappeared, and every existing row, sequence state, and journal entry matched the pre-failure snapshot.

A separate temporary fixture created a table, changed stock, and reached a controlled `pg_sleep`. A second runner was rejected while the first held its advisory lock. Cancelling the first backend produced SQLSTATE **57014** and rolled back its table/data changes. No failed or cancelled migration was journaled. The normal frozen runner then applied **zero** migrations, demonstrating recovery after both failure paths.

## Retained evidence and limits

- `/private/tmp/hardware-phase3-working-database-setup`: initial through-015 working-database setup and journals.
- `/private/tmp/hardware-phase3-migration-016-evidence`: 016 application/repeat logs, source hashes, journals, schema, and permission probes.
- `/private/tmp/hardware-phase3-migration-017-evidence`: 017 application/repeat logs, source hashes, journals, schema, and privilege metadata.
- `/private/tmp/hardware-phase3-upgrade-017-evidence`: frozen migrations, populated dump/hash, complete harness log, per-database proof JSON, original-column row hashes/counts, sequence/grant counts, injected failure/cancellation SQL, and final migration integrity manifest.

These are local synthetic rehearsals. They do not prove live-schema compatibility, real backup recovery, production grants/TLS, container runtime, operator credential rotation, application-level financial correctness, or a down-migration path. Rollback proof covers atomic failure of a forward migration, not reversal of already committed migrations. The first baseline's 82/84 concurrency result remains recorded separately and is not waived by this evidence. PostgreSQL and all evidence databases remain available for coordinated Phase 3 work. No application source, migration, or prior document was edited for this verification.
