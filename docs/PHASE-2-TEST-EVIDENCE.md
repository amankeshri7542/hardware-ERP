# Phase 2 local financial evidence

> Final result: local and remote engineering gates pass for source `e84f7b81`; the full release remains blocked. The final remote section below supersedes earlier pending CI notes.

This records synthetic local evidence on 2026-10-09. It is not production certification. All new HTTP financial tests authenticate through the real application and use a restricted PostgreSQL role; a separate owner connection creates fixtures and inspects results. No live environment files, disclosed credentials, production database, deployed endpoint or worker were used.

## Frozen baseline before repair

The staged Phase 1 tree `0e0a2c19acac02660fd4981765f5426059f14197` was archived to `/private/tmp/hardware-phase2-baseline`. Its backend lockfile was installed independently with Node 24.21.0/npm 11.17.0. Source in that archive remained frozen while the worktree changed. Historical migrations 001–011 and 013 created `hardware_phase2_baseline_test` on loopback PostgreSQL 16.15, port 55432.

The original release-blocker suite ran unchanged under the preloaded loopback guard: **11 tests, 2 pass, 9 fail, zero skipped**. Every failure reached its intended assertion: FIN-01 stock 99 instead of 98; FIN-02 stored cost 999 instead of 30; FIN-03/05/06/07/08 HTTP 201 instead of 422; FIN-04 debt 0 instead of 200; FIN-09 different invoice IDs. The full run is in `/private/tmp/hardware-phase2-original-baseline.log`.

Two new catalog tests were copied, with their test-only helper, into the frozen archive before testing the repaired catalog source. Both failed for the intended reasons: an explicit price edit did not append history, and an injected history failure did not abort the edit. The parent separately recorded two calculation failures against the old implementation: selected-unit box pricing and fractional percentage-discount rounding.

## Local isolation

`scripts/run-local-tests.cjs` sets an absolute preload in inherited `NODE_OPTIONS` before spawning application/test code. `scripts/local-only-network.cjs` permits literal loopback TCP only, forces deterministic loopback DNS lookup, and denies other DNS, UDP and IPC/fd connect requests. The regression includes TCP/TLS/HTTP/HTTPS/fetch, callback/promise/resolver DNS, a child Node process, an allowed loopback HTTP canary and a local redirect to a reserved external hostname. **2/2 pass.** This is Node transport containment, not an OS firewall or a native-process egress proof. Browser contexts have their own route/WebSocket containment before navigation.

`hardware_phase2_backend_test` and `hardware_phase2_frontend_test` were created separately through migration 014 and given explicit runtime grants. Dependency installation is a tooling step before the application guard, because it requires registry access. Backend package scripts now use the guarded launcher; CI also wraps migration, TLS and nginx Node tests. CI configuration is authored here; this evidence does not claim remote CI ran.

## Invoice and catalog checks

`backend/tests/phase2/invoices.test.js`: **21/21 pass**. Coverage includes authoritative name/HSN/GST/cost/base quantity; unchanged catalog prices/history during sales; selected-unit pricing and cost; registered and anonymous Quick Bills; exact tender posting; invalid precision/coercion/discount/date/customer/unit cases with no writes; repeated-product stock aggregation; quote freshness and rollback; concurrent oversell rejection; concurrent retry replay after catalog changes; injected late tender failure rolling back invoice/items/stock/ledger/receipt/reservation; cashier quote/post denial; five shared rounding fixtures persisted through wholesale HTTP; provisional anonymous quotes; zero-value walk-ins; and three overlapping requests against one customer.

The last concurrency test holds the customer row and observes all three application requests waiting on PostgreSQL locks before release. Two sales on different products plus an advance finish with three correct running ledger balances and a cached balance of 350. No timing sleep substitutes for observing overlap.

`backend/tests/phase2/catalog.test.js`: **3/3 pass**. Explicit price updates append a complete actor-attributed history snapshot and close the preceding interval. An injected audit-insert failure rolls back the catalog price update. A third test observes two concurrent edits waiting on the product row, then verifies complete successive snapshots and contiguous effective intervals.

The unchanged invariant assertions in `backend/tests/release-blockers/financial.test.js` now report **8 pass / 3 fail, zero skipped**. Only valid fixture setup changed: required due date and request key, deterministic unique customer phone, consistent opening stock, and restricted-role application access. FIN-06/07/08 still return HTTP 201 instead of 422 after successful invoice setup. They remain Phase 3 blockers; unrelated validation errors have not hidden the defects.

The complete guarded backend `npm test`, after the catalog concurrency, base-unit and operation-actor regressions, passed environment **5**, security **12**, containment **13** and financial **54** tests (**84 total**, zero skipped). Backend lint passed. The latest immutable-candidate proof is recorded below for tree `e84f7b81374e5c852ab18dc82835c548ea95b231`.

`backend/tests/phase2/base-unit.test.js`: **2/2 pass** after **2/2 intended red failures** before implementation. The authoritative quote includes the current base-unit label, and an issued invoice retains `base_unit_snapshot='piece'` after its product changes to `kg`. Migration 015 was applied to both disposable backend and frontend databases before these checks.

The operation-actor follow-up requires `Idempotency-Actor` on invoice/payment POSTs, checked against the authenticated actor before idempotency. The invoice regression proves missing/invalid headers return 400, a shared-cookie account switch returns 409 without a second financial effect, and the original actor can recover its committed response. The payment specialist recorded the equivalent failing case before the guard and verified the repair. The earlier fresh archive at `/private/tmp/hardware-phase2-final-a02e7336` is superseded by this additional defect and must not be presented as the final candidate.

## Forward migration preservation

A separate `hardware_phase2_upgrade_test` was cloned from the populated frozen Phase 1 database. Migration 014 applied alone. Every original column and row across **20 existing tables** compared identically before/after, including 12 invoices/credit notes, 13 invoice lines, 12 customer ledger entries, 16 stock ledger entries and receipt/return history. All **59 existing table grants** were unchanged. The new idempotency table had no automatic runtime insert permission before explicit grants. After `db/grants.sql`, the runtime role could read idempotency data while user mutation, ledger mutation/deletion and migration-journal access remained denied. Re-running migrations applied zero files. The local proof script is `/private/tmp/hardware-phase2-upgrade-proof.cjs`.

A second separate clone, `hardware_phase2_upgrade_015_test`, applied both 014 and 015 to the same frozen populated Phase 1 source. All 20 table snapshots and 59 existing grants again matched; all 13 historical invoice-item base-unit snapshots remain null. Its local proof script is `/private/tmp/hardware-phase2-upgrade-015-proof.cjs`.

The repository migration test now explicitly applies 013, 014 and 015 to populated historical rows. Its comparison permits exactly the added nullable invoice `notes` and invoice-item `base_unit_snapshot` columns while requiring every existing value to remain equal. It retains repeat/checksum rejection, interrupted migration rollback, advisory locking, untracked-schema refusal, append-only ledger and negative-stock checks.

## Earlier clean candidate verification (3c23c1cf)

**Tested tree: `3c23c1cf6dd268c728467c136ac21b64f8462f22`.** It was exported with `git archive` into `/private/tmp/hardware-phase2-final-3c23c1cf`. Before installation, the archive contained **267 source files, zero `node_modules` directories and no `frontend/dist`**. Independent pinned `npm ci` runs installed 417 backend packages and 241 frontend packages. Node was 24.21.0 and npm 11.17.0. Both installs reported the same two moderate advisories already documented; no dependency versions or lockfiles were changed to suppress them.

Every Node application/test process had the absolute archive guard in `NODE_OPTIONS` before startup. Tests used `NODE_ENV=test`, synthetic loopback PostgreSQL 16.15 at port 55432 and `CORS_ORIGIN=http://localhost:5173`. Both real-browser suites ran as `phase1_app` against the separate frontend test database, with `FIXTURE_DB_USER=phase1_owner` for fixture creation and assertions. `TRUST_PROXY=127.0.0.1/32,::1/128` allowed the harness's distinct synthetic client addresses. The frontend production build explicitly used `NODE_ENV=production`; the guard remained enabled.

| Gate and command | Final result |
|---|---|
| Backend `npm ci`; frontend `npm ci` | Both pass from empty dependency directories |
| Backend `npm run lint` and `npm run check:syntax` | Pass |
| Frontend `npm run lint` | Pass |
| Frontend `NODE_ENV=production npm run build` | Pass; Vite 7.3.7, 3,129 modules |
| Backend `npm test` | **84 pass:** environment 5, security 12, containment 13, financial 54 |
| Frontend `npm run test:auth` | **4 pass** |
| Frontend `npm run test:financial` | **8 pass** |
| Frontend `npm run test:financial-browser` | **9 pass**, real Chromium and restricted application role |
| Frontend `npm run test:browser` | **4 pass**, run serially after the financial browser server closed |
| `sh scripts/test-db-tls.sh` | **1 pass**, real PostgreSQL certificate/hostname verification |
| `node scripts/run-local-tests.cjs --test scripts/test-nginx.js` | **1 pass**, real nginx serving the production bundle |
| Backend `npm run test:release-blockers` | **8 pass, 3 expected Phase 3 failures**, process exits 1 |

All test groups reported **zero skips**. The production JavaScript artifact is `frontend/dist/assets/index-CwMW-mQ8.js`, 1,508.38 kB (467.87 kB gzip), SHA-256 `3eed2980fee476fc2938fadc8a56768335b6c12bd28298e5362f7febd1d7b650`. The existing large-chunk warning remains visible. All 267 archived source-file hashes matched their initial manifest after installation, build and every test. Later changes are documentation/evidence updates; the coordinator owns the final commit reference.

Raw per-command logs, exit codes, the source hash manifest, archive metadata and `summary.json` are in `/private/tmp/hardware-phase2-final-3c23c1cf-evidence`. The native nginx binary was `/private/tmp/hardware-phase1-nginx/sbin/nginx`; Chromium used the existing isolated `/private/tmp/hardware-phase1-browsers` cache. Registry/tool installation preceded runtime containment. No Docker executable was available.

Cleanup verified ports 5173 and 55433 closed and no owned `erp-nginx-test-` process remained. Browser test teardown closed Chromium, the HTTP server and both database pools. The long-lived disposable PostgreSQL at `/private/tmp/hardware-phase1-pg-5r5p2izn/data` was deliberately left for coordinator-owned shutdown after all agents finished.

### Harness findings and final corrections

The earlier `bad954af` archive's first financial-browser attempt passed four journeys, then five login-dependent cases timed out because the external runner omitted `TRUST_PROXY`: all synthetic client addresses shared the same rate-limit bucket, and the sixth login returned 429. This failure was retained in `/private/tmp/hardware-phase2-final-bad954af-evidence/browser-financial-missing-proxy.log`. The final runner and CI browser step now supply the explicit loopback proxy setting. No rate limit was disabled or increased. The final exact-tree run passed all nine journeys.

Read-only CI review also found that its global test environment leaked into the frontend build and that the baseline browser command retained the owner runtime role. Final CI explicitly sets production mode for the build and supplies the restricted runtime role plus separate owner fixtures for **both** browser suites. Compared with `bad954af`, final tree `3c23c1cf` changed only `.github/workflows/phase-1.yml` and report/handoff documents; application, tests, migrations and lockfile bytes were unchanged. The complete clean-archive proof was nevertheless repeated on the final tree.

### Original release assertions retained

The original test names and final outcomes are:

| Exact test name | Final outcome |
|---|---|
| FIN-01: base quantity must be derived from the sale, never trusted from the client | PASS |
| FIN-02: cost snapshots must come from the authoritative product cost | PASS |
| FIN-03: a discount exceeding the item rate is rejected without writes | PASS |
| FIN-04: Quick Bill customer receivables must match the customer ledger | PASS |
| FIN-05: payment split must equal amount paid before any invoice writes | PASS |
| FIN-06: duplicate sales-return lines cannot exceed the original quantity | FAIL — original HTTP 201 versus required 422; Phase 3 |
| FIN-07: a sales return must bind the product to its original invoice item | FAIL — original HTTP 201 versus required 422; Phase 3 |
| FIN-08: purchase returns must bind quantity and product to the purchase | FAIL — original HTTP 201 versus required 422; Phase 3 |
| FIN-09: repeating an idempotency key creates exactly one invoice | PASS |
| existing negative-stock protection rejects an oversized invoice atomically | PASS |
| existing append-only customer ledger protection remains active | PASS |

### Secret-scan disposition

The coordinator reran the tracked and historical scans from the managed Git worktree using the pinned scanner, without printing credential values:

```sh
rtk proxy env GITLEAKS_BIN=/private/tmp/hardware-erp-gitleaks/gitleaks python3 scripts/scan-secrets.py
rtk proxy env GITLEAKS_BIN=/private/tmp/hardware-erp-gitleaks/gitleaks python3 scripts/scan-secrets.py --history
```

Tracked files: **0 findings**. History: **2 known disclosures**, at `.context/KNOWN_ISSUES.md` in commit `8b4234c…` and `backend/.env` in commit `82bc3e7…`; neither finding was suppressed or presented as rotation evidence. The history scan remains a release blocker. The coordinator also verified that the original checkout HEAD and its pre-existing AI/mobile/UI change list were unchanged. No production credentials were used and no live rotation was claimed.

## Final verification after the CI accessibility repair

**Latest tested tree: `e84f7b81374e5c852ab18dc82835c548ea95b231`.** The clean archive is `/private/tmp/hardware-phase2-final-e84f7b81`; all logs, command exit codes, metadata, `source-manifest.json` and `summary.json` are in `/private/tmp/hardware-phase2-final-e84f7b81-evidence`. Its initial state again had 267 source files, no dependency directories and no build output. Pinned Node 24.21.0/npm 11.17.0 installed 417 backend and 241 frontend packages from the unchanged lockfiles.

The coordinator inspected remote CI run **37908823765**: backend and unit gates passed, but the payment-recovery browser case could not locate the exact accessible name `Done` while Ant Design's loading spinner contributed to the button name. The financial recovery and database assertions had already passed. The frontend specialist reproduced the accessibility defect before repair, then added explicit `aria-label` and `aria-busy` props and strengthened the existing browser case. No financial algorithm, request identity or backend behavior changed.

A source-manifest comparison against `3c23c1cf` found exactly two non-documentation changes: `frontend/src/components/PaymentModal/PaymentModal.jsx` and `frontend/tests/financial-browser.test.js`. The new browser assertion holds a real committed replay response, verifies the pending button's stable accessible name, disabled state and `aria-busy=true`, then checks `Done` is no longer busy and the refreshed invoice summary/history shows exactly one receipt. The same case still proves the original key, actor, payload and one committed payment.

The complete clean runner was repeated with the same explicit loopback proxy trust, network preloads, separate browser fixture owner, restricted browser runtime, disposable PostgreSQL and production build mode described above:

| Final exact-tree gate | Result |
|---|---|
| Both fresh `npm ci` installs | Pass, 417 backend / 241 frontend packages |
| Backend lint and syntax; frontend lint | Pass |
| Explicit production frontend build | Pass, Vite 7.3.7 / 3,129 modules |
| Backend `npm test` | **84 pass, 0 fail, 0 skipped** |
| Frontend auth + financial unit suites | **12 pass, 0 fail, 0 skipped** |
| Strengthened financial browser suite | **9 pass, 0 fail, 0 skipped** |
| Baseline browser suite | **4 pass, 0 fail, 0 skipped** |
| Real PostgreSQL TLS; real nginx production SPA | **1 pass each** |
| Original release-blocker suite | **8 pass / 3 original Phase 3 failures / 0 skipped**, exit 1 |

Production bundle: `frontend/dist/assets/index-ii5Cd8FD.js`, **1,508.41 kB / 467.89 kB gzip**, SHA-256 `d7430b3e6d1f2abe949b2c1af966052305f79d6a4dc91e45f6f06e0b6f93f999`. The large-chunk warning and two moderate npm advisories per package remain visible. Every one of the 267 source-file hashes remained unchanged after all commands. Ports 5173 and 55433 were closed afterward; no owned nginx test process remained. The browser harness closed its Chromium instance, server and database pools. The main disposable PostgreSQL was left for coordinator-owned shutdown.

This is local verification of the new exact source tree. The next remote CI run follows the next push and was not yet claimed to pass in this evidence. Docker remains unavailable locally. Full release remains blocked by the three original return invariants and the documented operational/security gates.

## Limits and remaining gates

Docker is unavailable locally, so final container build/execution remains unverified here. Native Redis and the document worker were not started. Phase 3 return defects, live credential rotation, live TLS/networking, historical reconciliation, operator approvals and production deployment remain outside this local evidence. Refer to the final Phase 2 report for the eventual frozen candidate revision and complete payment, frontend, build and security gate totals.

## Final remote verification (supersedes earlier pending CI notes)

Source tree `e84f7b81374e5c852ab18dc82835c548ea95b231` is code commit `726af321e7828390a10cb30413260084ef0fe934`. Remote run [37910576845](https://github.com/amankeshri7542/hardware-ERP/actions/runs/37910576845) completed: engineering job **PASS**, including all browser journeys and both API/web Docker image builds. The production-release job **FAIL** is confined to the original FIN-06/07/08 return assertions (8 pass, 3 fail, 0 skip) and the two existing historical-credential findings. No deployment or application-image/Compose runtime verification occurred.

Read-only commands used the already configured repository-owner GitHub account for each process without changing the default account: `gh run view 37910576845 --repo amankeshri7542/hardware-ERP --json status,conclusion,jobs`; failed-release evidence was read with `gh run view 37910576845 --repo amankeshri7542/hardware-ERP --job 113755390829 --log-failed`. Only diagnostic lines were printed; credential values were not. The redacted release diagnostics are preserved in `/private/tmp/hardware-phase2-ci-37910576845-release.log`. See PHASE-2-REPORT.md for remaining runtime/operator gates.
