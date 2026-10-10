# Checkpoint5A test evidence

Executed locally on macOS, 2026-10-09. Coordinator ran tests; independent reviewer performed static read-only review only. Synthetic PostgreSQL16 at loopback port55432; API uses restricted `phase1_app`, owner is confined to fixture creation/migrations/failure injection. Node24.21.0/npm11.17.0. Every Node test/build/API process preloads `scripts/local-only-network.cjs`; browser routes deny external origins/redirects/WebSockets and block service workers before navigation. No live dotenv, old external API, external provider, cloud driver or privileged host service was used.

## Exact source and build

Starting tree `4a7ed30e31c4b95e40e9135c5e2ab700645f02cc`; tested tree `4d5ddbb51523cd2dba883177faee3e2a9b3399c9`; HEAD unchanged `aebf06579d5c577ecde0837de7fe68ef59b675cf`. Temporary-index manifest includes all new source. Tested manifest directory: `/var/folders/y1/5qgpl44s7w5_6cx9hmsh969h0000gn/T/hardware-phasefive-tested-_uumk2v3`.

Tested non-Markdown file manifest SHA256: `c6bf075af93ca0a7f569f450f2383e11d5a851b6ee96949846c44a610b6b6e79`. Build manifest SHA256: `032e77e2af1bb3e5f7540a6c3ff1e8d9c543b38b02535e9469413adc2e72c7a5`. Main `index-2ZzZeVe6.js` SHA256 `a8701dcfa2e4e38c84ece203297c3a392c6655cb3814d669d0887374fbef5c3f`; `dist/index.html` SHA256 `63f3e8a91b86e52af541e437989f2dbd7d869fea0d23cd662d7f1761376262f5`. All final suites ran after the final executable/test/workflow changes and clean installs; all browsers served this exact build. Later edits are documentation only, verified by per-file comparison.

Evidence root below is `/private/tmp/hardware-phase5-start-4zbkw4fh` (machine-local historical evidence path, not a runnable portability requirement). Every command result has a paired JSON containing argv, cwd/database, exit and duration. External local adapters `/private/tmp/phase5-run.py`, `phase5-full-backend.py`, `phase5-local-extra.py` generated/sanitized environment and retained logs; no generated session secret is printed. Long-lived temp evidence is not remote CI artifact retention: preserve approved sanitized copies before clearing host temp storage.

## Final results

| Gate | Result / log |
|---|---|
| Clean locked backend/frontend installs | PASS, `npm ci --offline --no-audit --no-fund`; `final-backend-install.log`, `final-frontend-install.log`. No dependency/lock changes; npm unapproved lifecycle-script warnings retained. Offline install is not an advisory audit |
| Full backend | **264/264**, environment5 + security12 + containment13 + financial234, zero skips; `final-backend.log` |
| Complete original financial invariants | **11/11**, zero skips; `final-release.log` |
| Frontend auth/financial units | **88/88**, zero skips; `final-units.log` |
| Full browsers | **61/61**, zero skips/cancellations, 123.319s command time; `final-browsers.log`; includes two newly controlled schedules and all original59 |
| Corrupt/clean restricted cash control | **1/1**; `final-cash-control.log` |
| Real failure-artifact/redaction control | **1/1**; `final-evidence-control.log`; three intentional child failures (body, teardown, failed password fill) are expected exit1 and validated, not ignored failures |
| Backend/frontend lint and syntax | PASS; `final-backend-lint.log`, `final-frontend-lint.log`, `final-syntax.log` |
| Frontend build | PASS; `final-build.log`; large chunk warning remains, main JS1,582.49kB / gzip488.87kB |
| Native PostgreSQL TLS / nginx | **1/1 each**; `final-tls.log`, `final-nginx.log`; loopback synthetic services only |
| Migration runner and actual upgrades | PASS within final environment suite: fresh/repeat/checksum/failure/cancellation/concurrent runner, populated historical011→021 preservation and unknown snapshots. Browser/control databases separately replay all real migrations/grants. No applied SQL bytes changed |
| Clean reconciliation | `hardware_phase4_clean_dfe0056ba5_test`: zero unexplained discrepancies, closing cash3800; separate `hardware_phase4_corrupt_dc22f9d153_test` detects deliberate corruption |
| Candidate scan | Zero findings on complete temporary-index candidate including untracked source; `tested-secret-scan.log`; final documentation-inclusive scan repeated at delivery |
| History scan | **FAIL /2 findings**, `history-secret-scan.log`: historical PAT and JWT disclosures; no values published or live rotation performed |
| Linux final-source full workflow | **BLOCKED**, no installed Docker/Podman/Colima/Lima/QEMU and no authorized remote dispatch |
| Current remote CI | Reviewed HEAD run37937154546 failed. No new remote run for unstaged bytes |
| Current image/Compose, cloud storage, printer | Unverified; no build/runtime/physical proof claimed |

Final backend parent database `hardware_phase4_phasefive_final_59f7653370_test`; full browser database `hardware_phase4_browser_a199fcca31_test` is a different migrated book. Its sanitized runner artifacts are `browser-artifacts/run-k4XKxw`. The parent fixture database remains untouched by browser provisioning. Final clean/corrupt control databases: `hardware_phase4_cash_clean_8f9c6802d8_test` / `hardware_phase4_cash_corrupt_b9317c5bbc_test`; corrupt payment1 stays header10/details8 and returns422 with request ID `d285aa48-a72a-4805-992a-4d933ab24595`. Restricted role cannot delete customer ledger or create databases.

## Before/after and retained failures

1. Read-only GitHub `ci-run.json`, `ci-job.json` and `ci-job-sanitized.log` establish actual commit/job failure. `ci-job-private.log` is restricted and **must not be published**. Later skipped steps are not passes.
2. `baseline-sequence.json`, `sequence-backend.log`, `sequence-browsers.log` retain the unchanged native backend→browser attempt. Backend264/264 passed. Browser attempt was interrupted after452.367s after repeated Dashboard-heading readiness failures; do not label it a complete suite or assign an unproven cause. Raw historical browser log is private because old diagnostics may contain synthetic cookie headers.
3. `contaminating-payments.json` records native sequence payment22/customer40/invoice35/actor21 (10 mixed,4+4); payment23/customer41/invoice37/actor21 (10 cash,no details); payment61/customer122/no invoice/actor31 (100 advance,no details). First two are retained negative fixtures in financial/payments.test.js135–159; third phase4/customer.test.js279–283. These are native reproduction IDs, not original CI database IDs.
4. `isolated-browser-controls.log`: original two report cases plus CSV statement case **3/3 pass** on a separate migrated book, unchanged financial assertions. `cash-isolation-proof-fixed.log`: actual authenticated report422 on corruption plus restricted clean-book proof1/1. First `cash-isolation-proof.log` reached correct422 but then failed42501 because the helper had changed DB_USER before a second CREATE DATABASE; both databases are now created before that mutation, without broadening grants.
5. `failure-evidence-proof*.log`, `nested-runner-probe.log`, `direct-evidence-canary.log` retain harness development failures: inherited NODE_TEST_CONTEXT skipped nested tests, missing HTML Content-Type caused a locator timeout, and incorrect trace field expectation used apiName instead of installed class/method. Corrected through actual runner tracing. These are not financial root causes.
6. `recovery-schedules.log`: first new schedule **0/2**. `browser-artifacts/run-cBeyn0/failure-BdCTHX` and `failure-AGm5Kl` capture both completed tabs, one successful idempotency row and one durable effect; the second Playwright click waited for a Retry control already removed by first completion. Keys were `60c6d08a-9bc2-4625-a05b-0f50a3407037` (advance) and `6c6018a1-a20b-4a37-afac-6b128d73acc6` (supplier reversal). No duplicate posting. Hold the actual201 until both click actions enter the test schedule; `recovery-schedules-gated.log` **2/2** and final full61 pass. No force click, blanket sleep, expanded timeout or retries-to-green.
7. Two read-only review findings (uncaptured teardown assertions, generated password values in runner logs) were fixed. `failure-evidence-review-proof.log` and final self-check prove first-failure DOM/trace, exact nonzero child outcome and no synthetic credential canary anywhere in published artifacts or runner stdout. Raw trace ZIP is never in publishable root.
8. The first documentation-inclusive scan flagged renderer-comparison prose as generic-api-key (`documentation-scan-before-final-secret-scan.log`, tree b4b4d181244308d4b8578bd4173ebabaa42be169). The passage was reworded; no scanner rule, exclusion or baseline was weakened. Final scan result is retained separately.

The old customer-advance response wait and supplier-refund-reversal second retry do not have sufficient original failure-time DOM for attribution. The separate Phase3 baseline82/84 concurrency and Phase4 inherited32/33 metadata timeout remain unresolved. Passing current schedules is additional evidence, not a retrospective causal explanation or self-issued waiver.

## Portable reproduction

Use the synthetic loopback owner/app setup in `LOCAL-DEVELOPMENT.md`, Node24.21.0/npm11.17.0 and an installed matching local browser. Supply generated session secret privately, owner role via DB_USER/DB_PASSWORD for disposable provisioning, and separate TEST_APP_DB_USER/TEST_APP_DB_PASSWORD. DB_NAME must end `_test`; never use a real/shared development book. No live .env. From repository root run each command with `NODE_OPTIONS=--require=<absolute-repository>/scripts/local-only-network.cjs` already in its environment:

```sh
rtk npm ci --prefix backend --offline --no-audit --no-fund
rtk npm ci --prefix frontend --offline --no-audit --no-fund
rtk npm run lint --prefix backend
rtk npm run check:syntax --prefix backend
rtk npm run lint --prefix frontend
rtk npm test --prefix backend
rtk npm run test:release-blockers --prefix backend
rtk npm run test:auth --prefix frontend
rtk npm run test:financial --prefix frontend
rtk proxy env NODE_ENV=production npm run build --prefix frontend
rtk proxy node scripts/run-local-tests.cjs --test scripts/test-cash-fixture-isolation.cjs
rtk proxy node scripts/run-local-tests.cjs --test scripts/test-browser-evidence.cjs
rtk npm run test:browser-all --prefix frontend
rtk proxy sh scripts/test-db-tls.sh
rtk proxy node scripts/run-local-tests.cjs --test scripts/test-nginx.js
```

When DB_USER is the restricted role, supply separate FIXTURE_DB_USER/FIXTURE_DB_PASSWORD for browser provisioning. BROWSER_ARTIFACT_ROOT may be a validated absolute directory; otherwise platform temp is used. TLS requires existing PostgreSQL binaries; nginx uses installed binary or NGINX_BIN. Do not install/start privileged host services to bypass missing runtime.

The workflow now runs isolated browsers, self-checks evidence and uploads only sanitized artifacts on failure/success. No push/dispatch is authorized. A Linux maintainer must still execute the exact candidate setup; current macOS execution cannot satisfy that mandatory acceptance.
