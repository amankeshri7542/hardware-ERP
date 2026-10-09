# Phase 3 test evidence

All evidence below is local and synthetic, dated 2026-10-09. No live dotenv, old external API, production credentials or production database was used. Keep baseline failures and intermediate logs; later green runs do not erase them. Starting source evidence is in `PHASE-3-BASELINE-EVIDENCE.md`.

## Runtime and source

Node 24.21.0 and npm 11.17.0: `/private/tmp/hardware-phase1-runtime/node_modules/.bin`. PostgreSQL 16.15: `127.0.0.1:55432`; existing disposable cluster `/private/tmp/hardware-phase1-pg-5r5p2izn/data`. Backend database `hardware_phase3_backend_test`; browser database `hardware_phase3_frontend_test`. Prior baseline databases were preserved. Synthetic owner `phase1_owner`; restricted runtime `phase1_app`.

Every Node test/build/app process preloads `scripts/local-only-network.cjs` through NODE_OPTIONS before imports/startup. Browser harnesses install route/redirect/WebSocket/service-worker guards before navigation. Native PostgreSQL tools explicitly target loopback. This is test-process containment, not an operating-system firewall or production network certification. Vite disables dotenv loading with `envDir:false`.

Final complete source snapshot and manifest are recorded in the source-identity section below. Browser source/build manifests independently record SHA-256 for 177 source, test, package, guard and built files:

- New 20-case browser run: `9d869b87c475a4620643ee29b38a101a7207b4bcbdbd22a45322284a554e290d`, `/private/tmp/phase3-frontend-browser-source-build.json`.
- Final inherited 13 browser cases: `f860f2d851cc8a0abff6c3bdb25c45803d1f0d769517e6088c768421e1fe7c8b`, `/private/tmp/phase3-frontend-browser-source-build-final.json`.

Only cashier redaction and the disabled-attachment assertion changed between these captures. Frontend source/dist and all new admin workflow code remained unchanged; the affected cashier/browser and complete backend suites reran after that repair. No redundant admin browser run is claimed.

## Backend commands and results

Working directory is the worktree's `backend`. Exact final invocation (all values synthetic):

```sh
rtk proxy env PATH=/private/tmp/hardware-phase1-runtime/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin NODE_OPTIONS=--require=/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/scripts/local-only-network.cjs NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=55432 DB_NAME=hardware_phase3_backend_test DB_USER=phase1_owner DB_PASSWORD=synthetic-phase1-owner-local-only DB_SSL=false TEST_APP_DB_USER=phase1_app TEST_APP_DB_PASSWORD=synthetic-phase1-app-local-only SESSION_SECRET=synthetic-phase3-session-secret-local-only-at-least-32 STORAGE_DRIVER=disabled CORS_ORIGIN=http://localhost:5173 TRUST_PROXY=127.0.0.1/32,::1/128 npm test > /private/tmp/phase3-backend-final.log 2>&1
```

Exit 0: environment **5/5**, security **12/12**, containment **13/13**, financial **163/163** = **193/193**; zero failed/skipped. HTTP handlers use the separately configured restricted application credentials. Owner credentials are for isolated fixtures/failure injection.

The exact same command/environment with `npm run test:release-blockers` replacing `npm test`, and log `/private/tmp/phase3-original-release-final.log`, exits 0: **11/11**, no skips. This final rerun includes the cashier fix. `npm run test:financial` includes Phase 2, Phase 3 and financial suites, while release blockers remain an independent CI gate.

The narrow cashier proof used the same environment with `node ../scripts/run-local-tests.cjs --test tests/security/session-api.test.js`: `/private/tmp/phase3-review-cashier-before.log` exits 1, **7/8**, missing public product ID (`undefined` versus fixture ID). Full final backend includes its green assertion. Earlier review red proofs are `/private/tmp/phase3-review-price-before.log` (missing version accepted) and `/private/tmp/phase3-review-catalog-snapshot-before.log` (non-atomic detail DTO).

## Frontend and browser commands

Working directory is the worktree's `frontend`:

```sh
rtk proxy env PATH=/private/tmp/hardware-phase1-runtime/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin NODE_OPTIONS=--require=/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/scripts/local-only-network.cjs node ../scripts/run-local-tests.cjs --test tests/auth.test.js tests/financial.test.js tests/phase3.test.js > /private/tmp/phase3-frontend-unit-final.log 2>&1
```

Exit 0: **40/40** (auth 4, existing financial 8, new recovery 28), no skips.

Exact browser invocation template below was run sequentially, changing only the test file/log as listed. Port 5173 is shared, so suites must not run concurrently.

```sh
rtk proxy env PATH=/private/tmp/hardware-phase1-runtime/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin NODE_ENV=test DB_HOST=127.0.0.1 DB_PORT=55432 DB_NAME=hardware_phase3_frontend_test DB_USER=phase1_app DB_PASSWORD=synthetic-phase1-app-local-only FIXTURE_DB_USER=phase1_owner FIXTURE_DB_PASSWORD=synthetic-phase1-owner-local-only SESSION_SECRET=Synthetic-phase3-browser-K8mP2qN7vR4sT9wX6yL3zA5c CORS_ORIGIN=http://localhost:5173 TRUST_PROXY=127.0.0.1/32,::1/128 STORAGE_DRIVER=disabled PLAYWRIGHT_BROWSERS_PATH=/private/tmp/hardware-phase1-browsers NODE_OPTIONS=--require=/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/scripts/local-only-network.cjs node --test --test-reporter=tap tests/phase3-browser.test.js > /private/tmp/phase3-frontend-browser-final.log 2>&1
```

| Test file | Log in `/private/tmp` | Exit/result |
|---|---|---|
| `tests/phase3-browser.test.js` | `phase3-frontend-browser-final.log` | 0; **20/20**, 31.1 s |
| `tests/browser.test.js` | `phase3-original-browser-final.log` | 0; **4/4**, 3.7 s |
| `tests/financial-browser.test.js` | `phase3-original-financial-browser-final.log` | 0; **9/9**, 15.0 s |

Exact expanded commands and detailed selector/source findings are also retained in `/private/tmp/phase3-frontend-browser-evidence.md`. Initial new-suite failures were selector/interaction issues; purchase controls now use keyboard ArrowDown/Enter. A metadata timeout passed isolated and in the final suite without an application change; no unproven product root cause is claimed. Initial inherited suite **2/4** exposed the real cashier defect and outdated attachment wording, both repaired; its original log is retained. Containment remains tested with no file input/print reactivation.

## Static checks and build

From worktree root, each command below used the same PATH and NODE_OPTIONS as the frontend unit command, through `rtk proxy env`:

| Exact command suffix | Log in `/private/tmp` | Result |
|---|---|---|
| `npm run lint --prefix backend` | `phase3-backend-lint-final.log` | Exit 0 |
| `npm run check:syntax --prefix backend` | `phase3-backend-syntax-final.log` | Exit 0 |
| `npm run lint --prefix frontend` | `phase3-frontend-lint-final.log` | Exit 0 |
| From frontend: `node node_modules/eslint/bin/eslint.js tests/browser.test.js tests/phase3.test.js tests/phase3-browser.test.js` | `phase3-frontend-tests-lint.log` | Exit 0 |

Build from frontend, with dotenv explicitly disabled before build:

```sh
rtk proxy env PATH=/private/tmp/hardware-phase1-runtime/node_modules/.bin:/opt/homebrew/bin:/usr/bin:/bin NODE_OPTIONS=--require=/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/scripts/local-only-network.cjs VITE_API_URL=/api node --input-type=module -e 'import {build} from "vite"; import react from "@vitejs/plugin-react"; await build({configFile:false,envDir:false,plugins:[react()],define:{"import.meta.env.VITE_API_URL":JSON.stringify("/api")}});'
```

Exit 0; `/private/tmp/phase3-frontend-build.log`. Final bundle `index-CugHlZ_c.js`: 1,528.97 kB, gzip 474.08 kB. Inherited >500 kB chunk warning remains; no bundle-optimization scope was added. The browser manifests record exact built-file hashes. Context7 documentation was fetched for installed Vite 7.3.5 to verify `envDir:false`; no live environment values were loaded.

## Clean installation, migration and reconciliation

Clean directories held only copied manifests/locks. No existing worktree `node_modules` was changed by this proof. Guarded offline npm configuration excluded auth environment and used empty user/global npm configs:

```sh
rtk proxy python3 /private/tmp/hardware-phase3-clean-install-step.py /private/tmp/hardware-phase3-clean-install-ozxajycx backend install npm ci --offline --no-audit --no-fund
rtk proxy python3 /private/tmp/hardware-phase3-clean-install-step.py /private/tmp/hardware-phase3-clean-install-ozxajycx frontend-final install npm ci --offline --no-audit --no-fund
```

Both exit 0: **417 backend / 241 frontend** packages. All installed version/resolved/integrity entries match locks; omissions are optional packages only (5 backend/50 frontend). bcrypt hash/compare and esbuild transform probes passed. Initial frontend install also passed; final manifest was recopied/reinstalled after test-script changes. Final frontend manifest SHA-256 `e4d57a6baaffe9573fe380594800719ee21f9d216a2bfd672510cc6e038f515d`; lock `dd0bb0a48f713b923f4e7e68e0d86d150728ce1ca5b3687e8c9d313e7ca6aa29`. Full commands/runtime/native probes are in `/private/tmp/hardware-phase3-clean-install-ozxajycx/evidence/HANDOFF.md`. Existing deprecation/lifecycle notices remain; no new remote advisory audit is claimed.

Migration commands, source hashes, fresh/populated counts and permission/rollback/cancellation/concurrency proofs are in `PHASE-3-MIGRATION-EVIDENCE.md`. Historical SQL was not edited. Read-only reconciliation:

```sh
rtk proxy env PGPASSWORD=synthetic-phase1-app-local-only PGOPTIONS='-c default_transaction_read_only=on' /opt/homebrew/bin/psql -X -h 127.0.0.1 -p 55432 -U phase1_app -d hardware_phase3_backend_test -v ON_ERROR_STOP=1 -P pager=off -f /Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp/db/reconciliation/phase-3.sql
```

Exit 0, ROLLBACK. SQL SHA-256 `1c13d7f6857c1a0959377a66ac0f17c96c40832820929c432522d8c83dbd47e1`. Captured observation: 67 unknown invoice identities, 15 unknown purchase-line identities, 11 invoice-debt differences, six credits without applications, 14 sales-return counter/link differences, 12 stock/ledger differences. Zero customer-cache, purchase-counter or purchase-header/item-total differences. Four legacy pending supplier returns lacked modern item/debit evidence; 81 outstanding supplier debit notes remained visible. These counts precede later repeated tests and are not final database totals. Logs, IDs and deliberate-fixture provenance are in the clean-install evidence directory. No repairs ran and no clean dataset claim is made.

## Security and external gates

```sh
rtk proxy env GITLEAKS_BIN=/private/tmp/hardware-erp-gitleaks/gitleaks python3 scripts/scan-secrets.py --history
rtk proxy which docker
```

History scan: exit 1, **2 findings**, `/private/tmp/phase3-history-secrets.log`: historical GitHub PAT in `.context/KNOWN_ISSUES.md` at `8b4234c8957b867fc6440badfe94fb6ef5877876`; historical JWT in `backend/.env` at `82bc3e7cf5fd7546d8e49a30f635ab83a22650b7`. No values are printed. Docker lookup exits 1, unavailable. No image/Compose runtime or new remote CI run is claimed. Prior native TLS/nginx evidence is retained, not represented as rerun or live evidence.

Complete candidate scanning includes untracked new files via a temporary index; final result and snapshot identity follow below. Real index, HEAD and recovery refs remain unchanged. Historical disclosures/operator rotations remain blocking regardless of current-source result.

## Tested source identity and complete candidate scan

The source exercised by the final backend, unit and affected-browser runs is
captured in tree **`fefe2938f74348233e68c2e5de1ed533ff329a1d`**. This is a local
tree object, not a commit. It includes 289 files, including all untracked Phase 3
source/tests/migrations/docs. The source hash manifest SHA-256 is
`ea853d92a6aec1192943ad55d95fc909d50097c1f2688eae9859e32073151afb`.

```sh
rtk proxy python3 /private/tmp/phase3-final-snapshot.py tested
```

The script reads HEAD into a **temporary** index, adds the complete nonignored
candidate there, writes the tree and runs `scripts/scan-secrets.py` with
`GIT_INDEX_FILE` pointing to that temporary index. The scanner therefore includes
new files, not just the real index's preexisting tracked paths. It records file
hashes and asserts unchanged real index, HEAD and existing refs. Result: exit 0,
**zero current-source findings**, and `git diff --check HEAD <tree>` exit 0.
The earlier diff check caught only extra EOF blank lines in new documentation;
those were removed before this successful snapshot/scan.

Evidence directory: `/private/tmp/hardware-phase3-final-evidence/`:
`tested-identity.json`, `tested-source-hashes.json`, `tested-changes.txt`,
`tested-current-source-scan.log`, `tested-diff-check.log`.
Real index SHA-256 at capture:
`1647977ad7aa6b41526735cb57910886f22f9a64ca0dc778018ab05eb5cf9bd6`.
Staged path count remained zero; HEAD stayed at the starting commit.

After this capture, only documentation recording this identity/review is
finalized. A final snapshot/scan uses the same script with argument `final` and
records `final-identity.json`, hashes, diff check and scan beside the tested
capture. The final tree is reported in the session's final response to avoid
making a file claim its own containing tree hash. A comparison against the
tested manifest verifies that subsequent changes are documentation only.
