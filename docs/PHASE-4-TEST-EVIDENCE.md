# Phase 4 local test evidence

Executed on 2026-10-09 in the retained isolated worktree. No production data, live dotenv, external payment provider or old external API was used. Node runtime egress guard was preloaded before tests/build/API startup; browser route/redirect/WebSocket/service-worker guards preceded navigation. Synthetic owner credentials were limited to disposable database setup, migrations and failure injection; API operations used restricted `phase1_app`.

## Preserved baseline and source

Starting complete tree `10f8cb81b2a87174a5750f5c6e8a54bbe34827c5` matched delivered Phase 3, including untracked source. Retained HEAD was `724dc8e3e4dc7c7667388d5fedfb0cbd9d8b9dee`; HEAD alone omitted Phase 3. `/private/tmp/hardware-phase4-start` records the 289-file snapshot, status, index checksum and unchanged recovery refs. The real index stayed unstaged during implementation.

| Baseline actually rerun | Result / evidence |
|---|---|
| Backend | 193/193, `/private/tmp/phase4-baseline-backend.log` |
| Original financial release | 11/11 from the frozen starting-tree archive, `/private/tmp/phase4-baseline-original-release.log`; exact archive command in `/private/tmp/hardware-phase4-start/original-release-command.json` |
| Frontend auth/unit | 40/40; `/private/tmp/phase4-baseline-frontend-{auth,unit}.log` |
| Browsers | **32/33**: original4/4, financial9/9, Phase3 19/20. Metadata stale-reload timed out waiting for exact OK at then-line428. Unchanged isolated case1/1 and diagnostic subset3/3 passed; cause is not proven. Full logs/source hashes in `/private/tmp/phase4-baseline-frontend-evidence.md` and adjacent source-build JSON |

The earlier Phase 3 baseline **82/84** concurrency failures are separately preserved in `PHASE-3-BASELINE-EVIDENCE.md`. Neither later green runs nor improved lock diagnostics establish their original causes.

## Before and after evidence

- Missing customer/supplier commands were exercised with authenticated successful modern source fixtures before implementation. The resulting missing-service500s are missing-feature acceptance evidence, not proof of a repaired validation invariant. Customer red logs: `/private/tmp/phase4-customer-red-http.log`; supplier: `/private/tmp/hardware-phase4-supplier-before-authenticated.log`.
- Anonymous paid returns initially returned `ANONYMOUS_RETURN_SETTLEMENT_REQUIRED`. The old blanket denial was replaced only for proven sellable paid returns by positive liability/refund/no-customer-account tests plus legacy/overconsumption denials. The safety requirement remains traceable owned liability; documents/cashier denials were not changed.
- Missing day-close handlers failed after a valid mixed receipt (`phase4-day-close-before.log`). A later direct late-tender INSERT genuinely succeeded against a closed day (`phase4-day-child-before.log`); forward migration020 now rejects it. Future confirmed payment initially returned201 (`phase4-future-receipt-before.log`), now explicitly rejects without receipt effects.
- Initial complete backend candidate had one failure: the concurrent return fixture dated Jan16 raced a Jan17 receipt. Captured responses were return422 `BACKDATED_SETTLEMENT_UNSUPPORTED`, payment201, invoice836/payment346 (`phase4-full-backend-first.log`). The fixture now puts concurrent events on the same business date while preserving the original paid/due assertions. A separate test proves the earlier-date rejection and no effects. This documented Phase4 policy change is not a claim to explain earlier baseline flakes.
- Frontend receipt/recovery acceptance began with 31 failures and 8 controls (`phase4-frontend-unit-before.log`). Independent review then found and fixed supplier reversal payloads, receipt party filtering/paging, definitive-rejection recovery, stale day-date responses and unverified sales summary labeling. Actual Excel regressions were also reproduced (`phase4-export-before.log`, `phase4-export-null-before.log`): unpaid-invoice count1 exported0 and unknown balance exported0 instead of blank. Both are repaired and asserted by workbook tests. Early Phase4 browser logs remain: the first run6/14 exposed anonymous fixture type mistakes and missing accessible control names; the subsequent19/23 run exposed specific icon/hidden-tab locators and denial wording. Fixes retain intended recovery assertions; no broad retry/sleep/skip was added.

All referenced abbreviated log filenames above live under `/private/tmp/` unless stated otherwise.

## Measured backend and infrastructure gates

| Gate | Final measured result |
|---|---|
| Complete backend `npm test` | **264/264**, zero skips: environment5 + security12 + containment13 + financial234; `/private/tmp/phase4-full-backend-complete.log` |
| Original release invariants | **11/11**, zero skips; `/private/tmp/phase4-original-release-complete.log` |
| Backend lint / syntax | PASS; `/private/tmp/phase4-backend-{lint,syntax}-final.log` |
| Real PostgreSQL TLS / nginx | 1/1 each; `/private/tmp/phase4-db-tls.log`, `/private/tmp/phase4-nginx.log` |
| Fresh/populated migration, repeat/failure/cancellation/concurrent runner | PASS through021; `PHASE-4-MIGRATION-EVIDENCE.md` |
| Clean offline locked installs | Both PASS, frontend241 packages; `/private/tmp/hardware-phase4-clean-install-nrwqxh9w/evidence`; empty npm configs, no inherited auth environment |
| Docker/images/Compose | BLOCKED: Docker CLI unavailable; no current local image execution claim |
| Current full candidate secret scan | Temporary-index scan including untracked source:0 findings. Final scan/tree identities are recorded in the change manifest |
| Historical credential scan | **FAIL:2 retained disclosures**, redacted `phase4-history-secrets.log`. No live credential use/rotation attempted |

Backend tested source manifest: `/private/tmp/phase4-tested-backend-manifest.json`, 161 files, SHA256 `7576799aa29090e9924240bd9e6b88fc23f84b8a0ac2331f13e01692ba329770`. Final candidate comparison must preserve these backend/database/script hashes; frontend source/build evidence is recorded after its final verification.

Regression coverage includes same-customer multi-target allocations, no second receipt/ledger credit, partial refunds, anonymous liability discharge, supplier payable/debit/payment/refund/reversal, exact decimal/tender validation, source/party errors, as-of balances, statement opening/running/pagination, filtered exports, corruption warnings, real database source races/opposite lock order, same-key replay/conflict/actor checks, write-stage rollback and original-key retry, close-versus-posting contention, frozen closed evidence and later-period correction. Inherited invoice/payment/purchase/return/stock writers explicitly reject closed periods before any durable effects.

## Clean scenario and separate corruption proof

Final full backend run created clean database `hardware_phase4_clean_9bc497fbbf_test` and separate corruption database `hardware_phase4_corrupt_1e853c2dd0_test`. `backend/tests/phase4/clean-scenario.test.js` executes API journeys and `db/reconciliation/phase-4.sql` under the restricted role:

- Advance5000 + invoice8000 + allocation5000 leaves due3000; original incoming money remains5000.
- Paid return credit500 → allocation300 + refund200 leaves source0 and target due2700, no duplicate credit/receipt.
- Anonymous paid100 → liability100 → refunds40+60 leaves source0 and no invented customer account.
- Payable1000 → debit application200 + payment800 leaves0; another paid1000 → later return claim200 → supplier refund200 leaves0. Only the two original supplier stock-return movements exist.
- Product stock7; explicit opening100; closes4700 then3800, discrepancy0. Read-only reconciliation returns **zero unexplained discrepancies** and zero unknown-history counts.
- Separate corruption database contains deliberately unproven stock5; exactly one `stock_projection` discrepancy is detected. The fixture-rich shared database is never certified clean.

## Exact command environment

Runtime Node24.21.0/npm11.17.0 at `/private/tmp/hardware-phase1-runtime/node_modules/.bin`; PostgreSQL16.15 on `127.0.0.1:55432`, retained disposable cluster `/private/tmp/hardware-phase1-pg-5r5p2izn/data`. Backend fixture database `hardware_phase4_test`. Synthetic passwords below are local fixture values, not live credentials.

```sh
rtk proxy env PATH=/private/tmp/hardware-phase1-runtime/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin NODE_OPTIONS=--require=/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/scripts/local-only-network.cjs NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=55432 DB_NAME=hardware_phase4_test DB_USER=phase1_owner DB_PASSWORD=synthetic-phase1-owner-local-only DB_SSL=false TEST_APP_DB_USER=phase1_app TEST_APP_DB_PASSWORD=synthetic-phase1-app-local-only SESSION_SECRET=synthetic-phase4-session-secret-local-only-at-least-32 STORAGE_DRIVER=disabled CORS_ORIGIN=http://localhost:5173 TRUST_PROXY=127.0.0.1/32,::1/128 npm test
```

Run from isolated `backend/`; the same environment ran `npm run test:release-blockers`, `npm run lint`, `npm run check:syntax` and targeted `node ../scripts/run-local-tests.cjs --test tests/phase4/*.test.js`. The full command output is retained in the logs above. Root nginx used `NGINX_BIN=/private/tmp/hardware-phase1-nginx/sbin/nginx node --test scripts/test-nginx.js`; TLS used `sh scripts/test-db-tls.sh` with `/opt/homebrew/opt/postgresql@16/bin` prepended. Both inherited the Node guard.

Offline installs ran `rtk proxy python3 /private/tmp/hardware-phase3-clean-install-step.py /private/tmp/hardware-phase4-clean-install-nrwqxh9w backend install npm ci --offline --no-audit --no-fund`, then the same for frontend. Machine-readable records retain exact argv, sanitized environment, lock hashes and exit codes. Dependency advisories were not newly retrieved; reproducibility is not an advisory clearance.

Independent reviewer made no edits and ran no tests/migrations. Static re-review accepted all five findings; the added `REVERSAL_TENDER_MISMATCH` definitive rejection is included in frontend verification. No demonstrated source overconsumption/double posting/lock-order/permission defect remained in that review. Runtime, historical-data and human approval limits remain in `RELEASE-BLOCKERS.md`.

## Complete browser run and retained recovery uncertainty

The bounded selector-corrected complete suite passed **59/59**, zero skipped/cancelled/todo, exit 0 in 136.140 seconds, on fresh database `hardware_phase4_browser_selector_8a49cd2cfe_test`. Log: `/private/tmp/phase4-all-browser-selector.log`. It includes all inherited 33 cases and 26 Phase 4 cases. No asynchronous-activity, unhandled-rejection or disposed-context markers were present. The frozen 111-file frontend/source/build/test manifest `/private/tmp/phase4-selector-frontend-source-build-tests.json` remained unchanged throughout; aggregate SHA256 `91fec30806ce100fd35713f2298d745032d6f2f8c1b20e80160054028091c36f`.

The preceding complete attempt passed **58/59**, with one pre-submit anonymous-refund UPI locator failure: `/private/tmp/phase4-all-browser-acceptance.log`. The old global last-option selector reached a hidden/intercepted dropdown. The repaired helper scopes to the labeled combobox's visible `aria-controls` popup, checks unique exact option/selected text and collapse, and retains all financial/recovery assertions. One affected-case probe passed 1/1 before the full follow-up. No retries, sleeps, skipped cases or relaxed assertion timeouts were introduced.

Two earlier recovery failures are **unresolved**, independently of that diagnosed selector defect:

- `/private/tmp/phase4-all-browser-verified.log`: supplier-refund-reversal second retry timed out after wrong-actor409 (then recovery line270). Focused 2/2 and 1/1 reruns showed normal controls but do not prove the cause. No original failure-time DOM was captured.
- `/private/tmp/phase4-all-browser-complete.log`: customer-advance wrong-actor response wait timed out; its detached promise later produced an unhandled rejection. The wait/click now use observed promises together, and outstanding guarded handlers drain before teardown. Those corrections do not establish the original response timeout cause. Raw local logs may contain synthetic cookie headers and must not be published unredacted.

Future failure-only diagnostics capture original synthetic operation, request/key/actor/source/targets, saved intent, status/code and control DOM without live secrets. Earlier failures, the Phase3 baseline concurrency uncertainty and the original baseline metadata timeout remain preserved. Phase4 acceptance remains BLOCKED rather than treating a green rerun as root-cause proof.

## Frontend command and clean-build evidence

The 59-case run used the following command from `frontend/`:

```sh
rtk proxy env PATH=/private/tmp/hardware-phase1-runtime/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=55432 DB_NAME=hardware_phase4_browser_selector_8a49cd2cfe_test DB_USER=phase1_app DB_PASSWORD=synthetic-phase1-app-local-only FIXTURE_DB_USER=phase1_owner FIXTURE_DB_PASSWORD=synthetic-phase1-owner-local-only SESSION_SECRET=Synthetic-phase4-browser-K8mP2qN7vR4sT9wX6yL3zA5c CORS_ORIGIN=http://localhost:5173 TRUST_PROXY=127.0.0.1/32,::1/128 STORAGE_DRIVER=disabled PLAYWRIGHT_BROWSERS_PATH=/private/tmp/hardware-phase1-browsers NODE_OPTIONS=--require=/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/scripts/local-only-network.cjs node --test --test-concurrency=1 --test-reporter=tap tests/browser.test.js tests/financial-browser.test.js tests/phase3-browser.test.js tests/phase4-browser.test.js
```

Frontend guarded ESLint and Vite build passed; auth/financial/Phase3/Phase4 unit tests passed **88/88**. Evidence: `/private/tmp/phase4-frontend-{lint,build,units}-acceptance.log`. Commands use the same PATH and NODE_OPTIONS as above, respectively `node node_modules/eslint/bin/eslint.js src`, `node node_modules/vite/bin/vite.js build`, and `node --test --test-reporter=tap tests/auth.test.js tests/financial.test.js tests/phase3.test.js tests/phase4.test.js`. Existing large-chunk warning remains; it is not suppressed.

A fresh offline locked frontend install built the same frozen source with the actual `vite.config.js`, including `envDir:false`. All six output files were byte-identical to the browser-tested build: `/private/tmp/phase4-clean-matched-build-comparison.json`. Exact sanitized build command/environment/exit are in `/private/tmp/hardware-phase4-clean-install-nrwqxh9w/evidence/frontend-clean-matched-config-build.{json,log}`. Earlier custom-inline-config and missing-config build attempts differed; those retained logs demonstrate mismatched verification setup, not an unexplained source change. The final customer-history display correction and its affected checks are recorded below separately.

## Final customer-history correction and independent review

After the complete 59/59 run, the separate read-only reviewer found a pre-existing customer-history DTO mismatch in a Phase4-touched screen: the API exposes `balance`, but the table read `running_balance` and rendered undefined as zero. The expanded existing statement/CSV browser journey first reproduced **expected ₹177.00, received ₹0.00** against a real API ledger entry whose `balance` was 177.00 and whose `running_balance` was absent: `/private/tmp/phase4-customer-balance-before-contract.log`, 1/1 failed. An earlier test-setup header locator failure is retained in `phase4-customer-balance-before.log`; it is not the defect proof.

The one-page fix reads `balance` and renders missing/null/blank/nonfinite values as “—”, preserving valid zero. The affected browser journey passed **1/1**, zero skips/cancellations, exit0 in 2.981 seconds, on `hardware_phase4_browser_customer_balance_5b63ecae54_test`: `/private/tmp/phase4-customer-balance-after.log`. It retains statement, pagination and CSV assertions, verifies the real ₹177 posting, and uses explicit invalid-display fixtures for unknown/zero edge cases. The same guarded browser environment above was used with this DB and `node --test --test-concurrency=1 --test-reporter=tap --test-name-pattern='Phase4 statements retain full-history' tests/phase4-browser.test.js`.

Final frontend units again passed **88/88** and lint/build exited0: `/private/tmp/phase4-frontend-{units,lint,build}-balance.log`, using the commands above. The final 111-file manifest is `/private/tmp/phase4-final-balance-frontend-source-build-tests.json`, aggregate SHA256 `f32f56d6cdc4c279a874ffea3d7eb0254edb26d436e0140397ce12eb55a6ff82`. Compared with the 59/59 manifest, only `CustomerDetailPage.jsx`, the extended existing browser test, rebuilt main JS and `dist/index.html` changed. The full59 run is not misrepresented as a second full run on these later bytes; unchanged workflows retain that evidence, and the affected path was rechecked.

The corrected source was also rebuilt from the fresh offline locked install. All six final dist files match byte-for-byte; no source/config differences: `/private/tmp/phase4-final-clean-build-comparison.json`. Exact sanitized command/environment/exit: `/private/tmp/hardware-phase4-clean-install-nrwqxh9w/evidence/frontend-final-clean-matched-build.{json,log}`. Final main asset `index-2ZzZeVe6.js`, SHA256 `a8701dcfa2e4e38c84ece203297c3a392c6655cb3814d669d0887374fbef5c3f`.

The independent reviewer statically rechecked the final selector, stable labels, report/recovery fixes and customer balance correction. No remaining finding in those patches; diagnostic catches rethrow, guards and financial assertions remain intact. The reviewer ran no tests or migrations. Historical customer-advance/supplier-refund-reversal failures remain open.

## Final candidate and publication boundary

Final tested-source tree: `1c70bbd5134c8d8d566ffc64c4aeaa3600d86406` (336 files), temporary index `/private/tmp/hardware-phase4-tested-source-r5qdcza3`. Later edits are documentation-only. The final documentation-inclusive tree is captured externally before staging; its identity, current complete-candidate secret-scan result and local/origin equality are delivered with the commit. The final stage must equal that captured tree. Current scans include new untracked source through the temporary index. History remains a separate FAIL with two disclosures; no scan or gate is weakened.

The final instruction authorizes commit/push only, not deployment or production operation. Remote CI remains pending until evidence for the new commit exists. Docker CLI is unavailable, so current image/Compose execution remains blocked. Operator credentials/infrastructure/backup/reconciliation/accountant actions remain in `RELEASE-BLOCKERS.md`.
