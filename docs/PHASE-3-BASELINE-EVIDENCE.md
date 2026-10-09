# Phase 3 baseline evidence

Baseline captured on 2026-10-09 before Phase 3 application changes. The original release suite reproduces FIN-06/07/08 at the intended business assertions. Full production release remains **BLOCKED**.

The first backend run passed **82/84**, with two existing concurrency checks failing. Separate diagnostic reruns passed **84/84**; those reruns do not erase the first result or establish its cause. Frontend auth/unit tests passed **12/12**, and browser suites passed **13/13**. Every run had **zero skips**.

## Source identity and preservation

- Worktree: `/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp`.
- Starting HEAD: `724dc8e3e4dc7c7667388d5fedfb0cbd9d8b9dee`.
- Starting tree: `16023de750151cecf9f52eaf0d26fb55ea9be1af`.
- Starting `git status --short`: empty.
- Frozen verification archive: `/private/tmp/hardware-phase3-baseline-724dc8e3`, created with `git archive` from that HEAD.
- Machine-readable evidence and complete logs: `/private/tmp/hardware-phase3-baseline-724dc8e3-evidence`.
- All **267** archived tracked-file SHA-256 hashes matched after installation, build, and all baseline/diagnostic runs. The archive began without backend/frontend `node_modules` or frontend `dist`.

No application source, test, configuration, migration, lockfile, history, prior evidence, or Git ref was changed by this baseline task. This document is its only repository edit. The original dirty checkout at `/Volumes/T7-MacSSD/Codes/uma-erp/hardware-erp` was not used. No reset, clean, stash, reclone, commit, push, merge, or deployment occurred.

## Local environment

The documented disposable PostgreSQL cluster was stopped when inspected. Only that cluster was started:

```sh
rtk proxy /opt/homebrew/bin/pg_ctl -D /private/tmp/hardware-phase1-pg-5r5p2izn/data -l /private/tmp/hardware-phase1-pg-5r5p2izn/server.log -o '-k /private/tmp/hardware-phase1-pg-5r5p2izn/socket -h 127.0.0.1 -p 55432' -w start
```

- PostgreSQL: **16.15**, confirmed `listen_addresses=127.0.0.1`, `port=55432`.
- Node: **24.21.0**, npm: **11.17.0**, from `/private/tmp/hardware-phase1-runtime/node_modules/.bin`.
- Browser cache: `/private/tmp/hardware-phase1-browsers`.
- Docker CLI: **unavailable** (`shutil.which("docker")` returned null). No Docker or Compose runtime proof is claimed.
- Existing Phase 1/2 databases were inventoried and preserved. No existing database was dropped, reset, or migrated.
- Two previously absent databases were created: `hardware_phase3_backend_baseline_test` and `hardware_phase3_frontend_baseline_test`.
- The owner role `phase1_owner` handles fixtures and migrations. Runtime role `phase1_app` is not a superuser and cannot create roles or databases.

Both new databases applied exactly `001`–`011`, `013`, `014`, and `015`, followed by the unchanged `db/grants.sql` with `app_role=phase1_app`. There is no migration `012`. Recorded journals include each migration's name and checksum. The backend helper switches application connections to the restricted role before loading the app; browser application connections use that role from startup, with separate fixture-owner credentials.

Runtime tests preload the archived `scripts/local-only-network.cjs` before application/test imports. The package launcher preserves the absolute preload in child Node processes. Browser harnesses block nonlocal routes, redirects, WebSockets, and service workers before navigation. This is Node/browser transport containment, not proof of an operating-system firewall.

No live `.env` file or disclosed credential was loaded. All database passwords, account fixtures, and session secrets were synthetic. Runtime used explicit loopback database configuration, `NODE_ENV=test`, `CORS_ORIGIN=http://localhost:5173`, `TRUST_PROXY=127.0.0.1/32,::1/128`, and `STORAGE_DRIVER=disabled`. Workers, PDFs, attachments, and cashier billing stayed disabled. Dependency installation was a separate tooling step before the runtime guard.

## Commands and results

An external runner, `/private/tmp/hardware-phase3-baseline-step.py`, records exact command argv, exit code, elapsed seconds, and full output for every step. It derives from the preserved Phase 2 runner but points only at the new Phase 3 baseline databases. The command form is:

```sh
rtk proxy python3 /private/tmp/hardware-phase3-baseline-step.py /private/tmp/hardware-phase3-baseline-724dc8e3 LABEL DIRECTORY COMMAND ARGUMENTS
```

| Label | Directory / command | Result |
|---|---|---|
| `install-backend` | `backend`: `npm ci --no-audit --no-fund` | Exit 0; 417 packages |
| `install-frontend` | `frontend`: `npm ci --no-audit --no-fund` | Exit 0; 241 packages |
| `migrate-backend` | `backend`: `npm run migrate` | Exit 0; 14 migrations |
| `migrate-frontend` | `backend`: `npm run migrate` | Exit 0; 14 migrations in frontend database |
| `frontend-build` | `frontend`: `npm run build` | Exit 0; explicitly `NODE_ENV=production` |
| `backend-full` | `backend`: `npm test` | **82 passed, 2 failed, 0 skipped** |
| `frontend-auth` | `frontend`: `npm run test:auth` | **4 passed, 0 failed, 0 skipped** |
| `frontend-financial` | `frontend`: `npm run test:financial` | **8 passed, 0 failed, 0 skipped** |
| `browser-financial` | `frontend`: `npm run test:financial-browser` | **9 passed, 0 failed, 0 skipped** |
| `browser-baseline` | `frontend`: `npm run test:browser` | **4 passed, 0 failed, 0 skipped** |
| `release-blockers` | `backend`: `npm run test:release-blockers` | **8 passed, 3 failed, 0 skipped** |

The two browser suites ran serially because both bind loopback port 5173. The first full backend run overlapped the financial browser run, which used a separate database. This ordering is recorded; it is not established as the cause of either backend failure.

The production build emitted `index-ii5Cd8FD.js`, 1,508.41 kB / 467.89 kB gzip, SHA-256 `d7430b3e6d1f2abe949b2c1af966052305f79d6a4dc91e45f6f06e0b6f93f999`, matching the delivered Phase 2 artifact. Its existing large-chunk warning remains. Fresh installs also reported dependency deprecation and pending install-script approval warnings; no dependency or approval configuration was changed.

### Original release assertions

The unchanged release suite ran **11** tests. FIN-01–05, FIN-09, negative-stock protection, and append-only customer-ledger protection passed. The following exact desired-behavior assertions failed:

| Test | Intended assertion | Actual baseline result |
|---|---|---|
| FIN-06 | Duplicate full sales-return lines reject atomically with HTTP 422 | HTTP **201** at `financial.test.js:85` |
| FIN-07 | A valid invoice-item ID cannot authorize a different product; HTTP 422 | HTTP **201** at `financial.test.js:94` |
| FIN-08 | An unrelated purchase-return product and client-chosen cost cannot create supplier debit; HTTP 422 | HTTP **201** at `financial.test.js:104` |

The sales invoice setup assertions succeeded before FIN-06/07 reached the return mutation. FIN-08 successfully created its synthetic original purchase/items before posting the return. Authentication, restricted grants, origin checks, fixture setup, connectivity, and invoice key/actor headers therefore did not mask these three failures. Assertions were not weakened, skipped, inverted, or changed.

### Unexpected concurrency results and diagnosis

The first `backend-full` run passed environment **5/5**, security **12/12**, containment **13/13**, and financial **52/54**. Its failures were:

1. `tests/financial/idempotency.test.js:62`: the eight same-key payment requests reached the overlap barrier, but `results.every(result => result.status === 201)` failed. The original test did not print the individual HTTP statuses/codes, so the failing response's exact status/code is **unknown**. Read-only inspection of that test's first synthetic customer, ID 4, found exactly **one payment, one tender, one ledger entry, outstanding balance -10.00**. This proves one financial effect in that fixture, not successful handling of every original response.
2. `tests/phase2/catalog.test.js:55`: the test did not observe two product-query lock waiters before its five-second deadline. The original run did not capture the observed waiter count or connection state. No claim is made that this was a catalog accounting defect or solely a setup defect.

The following bounded diagnosis preserved every frozen source/test byte:

| Label | Command after runner directory `backend` | Result |
|---|---|---|
| `isolate-idempotency` | `node ../scripts/run-local-tests.cjs --test tests/financial/idempotency.test.js` | **10/10 passed** |
| `isolate-catalog` | `node ../scripts/run-local-tests.cjs --test tests/phase2/catalog.test.js` | **3/3 passed** |
| `diagnostic-financial` | `npm run test:financial` | **54/54 passed** |
| `diagnostic-backend-full` | `npm test` | **84/84 passed** |

Only the last two labels add `/private/tmp/hardware-phase3-baseline-diagnostics.cjs` after the network preload. That external diagnostic wrapper logs response method/path/status/code/result IDs and reads lock-wait observations; it does not change route logic, test assertions, or database writes. Its timing effects mean these passing runs are diagnostic evidence, not a replacement for the original failure.

Both diagnostic payment cases captured eight HTTP **201** responses with the same result ID (39 and 65 respectively). The catalog barrier reached two waiters in both runs. Owner-side `pg_stat_activity` reads could see restricted-role waiters, including their queries and blocking PIDs. The financial-only run observed **10** database/role lock waiters at the eight-request barrier; that predicate is not scoped to this test's specific operation and can count concurrent test activity. This is a test-observation limitation, not a proven explanation for the initial non-201 response. No baseline repair was made.

## Evidence boundaries and handoff

- Initial 82/84 and later diagnostic 84/84 are both retained; the initial concurrency failure cause remains unresolved.
- `source-identity.json`, `source-hashes.json`, `source-integrity-after.json`, `test-counts.json`, `runtime-and-bundle.json`, `diagnostic-observations.json`, per-step JSON/logs, grant logs, migration journals, and database inventory are in the evidence directory.
- Native TLS/nginx checks, current/historical secret scans, populated-upgrade rehearsal, Docker/Compose/application-image runtime, and live operator gates were outside this baseline assignment. Previous evidence for those checks is preserved, not represented as a new Phase 3 run.
- No listener remained on port 5173 after both browser suites. Their browser/server processes closed. The owned PostgreSQL cluster remains running for coordinated Phase 3 work; both new synthetic databases and all prior data/evidence remain available.
- Passing baseline engineering checks do not waive the original return failures, unresolved first-run concurrency results, historical credential rotation, deployment controls, or production release gates.
