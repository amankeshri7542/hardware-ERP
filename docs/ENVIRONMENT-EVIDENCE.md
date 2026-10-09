# Environment and migration evidence — Phase 1

Date: 2026-10-09. Scope: isolated candidate based on audit `5404f98b27eb8c326aa3ebc603ee43efe6394404`. These environment checks used disposable local services and synthetic fixtures. No push or deployment occurred. The final tracked-snapshot proof is recorded below; see `PHASE-1-REPORT.md` for the separate browser-run safety deviation and unknown external request outcome.

## Toolchain and dependency choices

Executed Node **24.21.0**, npm **11.17.0**, PostgreSQL **16.15** (native Homebrew), and a temporary locally compiled nginx **1.28.0**. The original available Node was 24.19.0; Context7 Node release documentation identified 24.21.0 LTS and support through April 2028, and the exact patch was installed under `/private/tmp/hardware-phase1-runtime`. No global runtime was changed. `.nvmrc`, `.node-version`, manifests/engines, CI and Docker pin the selected versions, and Docker explicitly installs npm 11.17.0.

Both lockfiles were newly resolved in this isolated worktree; the dirty original checkout's ignored locks and modules were not copied. Repeated `npm ci` completed for both candidate lockfiles. ESLint is a real correctness lint gate; backend syntax checking is separate. `no-undef` is enabled for both applications. The initial ESLint run exposed unused final SQL placeholder increments, legacy empty rollback catches, and unused CommonJS browser barrels. The barrels were repaired. The documented baseline permits unused variables/assignments and empty catch cleanup to avoid unrelated financial-service edits; it retains the remaining recommended correctness rules.

Puppeteer and Multer were removed because renderer/upload execution is disabled. Jsonwebtoken has no remaining consumer after replacing bearer tokens; the valid legacy-token rejection fixture uses Node crypto. Nodemon was removed in favor of `node --watch`, eliminating a high-severity braces advisory. Axios moved from 1.13.6 to 1.20.0. Vite 5/6 have no applicable patched release for the reported high advisory, so Vite 7 plus its matching React plugin is the one necessary frontend tooling major upgrade. React/Ant Design/Zustand remain on their existing major families. No `audit fix --force` was used.

Resolved direct runtime versions:

| Backend | Version |
| --- | --- |
| Express / express-validator / express-rate-limit | 4.22.3 / 7.3.2 / 8.7.1 |
| pg / bcrypt | 8.23.1 / 6.0.0 |
| cookie-parser / cors / helmet | 1.4.7 / 2.8.6 / 8.3.0 |
| BullMQ / ioredis | 5.81.5 / 5.11.1 |
| ExcelJS / dotenv | 4.4.0 / 16.6.1 |
| AWS S3, SES and presigner packages | 3.1148.0 |

| Frontend/tooling | Version |
| --- | --- |
| React / React DOM | 18.3.1 |
| React Router DOM | 6.30.6 |
| Ant Design / icons | 5.29.3 / 5.6.1 |
| Axios / Zustand / dayjs | 1.20.0 / 4.5.7 / 1.11.23 |
| Vite / React plugin | 7.3.7 / 5.2.0 |
| Playwright | 1.64.0 |
| ESLint / @eslint/js | 10.12.0 / 10.0.1 |
| Supertest | 6.3.4 |

The complete transitive versions/integrities are in the lockfiles. Deprecation notices remain for legacy ExcelJS dependencies, Supertest/Superagent and BullMQ's cron-parser chain; they were not hidden or blindly replaced.

Final advisory queries returned **0 high/critical; 2 moderate in each package tree**. Backend findings are ExcelJS and its uuid dependency ([GHSA-w5hq-g745-h8pq](https://github.com/advisories/GHSA-w5hq-g745-h8pq), uuid `<11.1.1`). npm proposes an ExcelJS major downgrade; this was not applied blindly. The advisory concerns UUID v3/v5/v6; no such direct application use was found, but this is not a full exploitability audit of export dependencies. Frontend findings are React Router and its wrapper: [GHSA-wrjc-x8rr-h8h6](https://github.com/advisories/GHSA-wrjc-x8rr-h8h6) and [GHSA-337j-9hxr-rhxg](https://github.com/advisories/GHSA-337j-9hxr-rhxg), requiring Router 7.18+ to clear. The app uses declarative client routes and no observed SSR hydration, but navigation reachability is not certified absent. These remain explicit maintenance/release review items. CI gates high severity; it does not claim the moderate findings are fixed.

## Executed checks

| Check | Measured result |
| --- | --- |
| Old migration runner regression | FAIL as expected: required runner function was undefined; old file exported `{}` |
| Old production DB TLS counterexample at audit SHA | FAIL as expected: missing CA selected `rejectUnauthorized: false`; executed in a VM with a synthetic environment and filesystem stub, without reading any credentials |
| Candidate environment suite | **3/3 PASS**, no skipped tests |
| Fresh actual migrations | **12 applied**: 001–011 and 013 on a new empty database; 012 intentionally unused because no additional schema gap was confirmed |
| Repeat actual migrations | **0 applied**; existing checksums retained |
| Applied-source mutation | Rejected with checksum/history failure and CLI exit 1 |
| Failed SQL migration | DDL and journal entry rolled back; earlier migrations preserved |
| Interrupted SQL migration | Cancelled real `pg_sleep` via PostgreSQL; created table and journal entry absent afterward |
| Concurrent runner attempts | Second real runner rejected while the first held the advisory lock; lock was released after rollback |
| Actual populated upgrade | Replayed original 001–011, inserted synthetic user/product/customer/invoice and both ledgers, applied 013, compared exact snapshots; all unchanged |
| DB invariants after upgrade | Customer-ledger UPDATE and stock-ledger DELETE rejected; negative stock rejected |
| Existing untracked schema | Runner refused without creating a journal |
| Read-only baseline comparison | **367 catalog objects matched** an independently replayed 001–011 reference; no stamping or target DDL |
| Synthetic seed self-check | Two runs leave one owner/product/opening ledger; production mode rejected with exit 1 |
| Real PostgreSQL TLS | **1/1 PASS**: valid CA/hostname connects; wrong CA and IP/hostname mismatch reject; insecure production mode and missing migration credentials reject |
| Real nginx SPA documents | **1/1 PASS**: HTTP 308 redirect and HTTPS `/`, `/index.html`, `/invoices/123` include CSP, HSTS, nosniff, frame denial and referrer policy |
| Backend/frontend ESLint | PASS after the documented baseline fixes |
| Restricted application HTTP/session checks | Security agent independently ran login/session/logout/reused-cookie denial with the granted app role; user mutations and financial DELETE denied |

Migration tests also reject invalid/missing NODE_ENV, malformed ports, absent/unreadable/malformed CA files, and prevent secret file paths from entering configuration errors. Test entry guards enforce test mode, loopback host and a `_test` database. Historical SQL 001–011 was never edited. The new 013 was amended during local development; a new empty final database was created afterward rather than changing a journal checksum or stamping an old database.

The standalone TLS test starts and removes a separate cluster using a generated one-day certificate. The nginx binary was built only under `/private/tmp`, then served the actual built frontend using the candidate native nginx configuration with test ports and a generated certificate. No public HTTPS was contacted or configured.

Representative executed commands (with the session's `rtk proxy` wrapper and explicit synthetic environment):

```sh
node db/migrations/index.js
node db/migrations/index.js --through=011
node db/verify-baseline.js
node --test backend/tests/environment/*.test.js
TEST_DB_TLS_PORT=55434 sh scripts/test-db-tls.sh
NGINX_BIN=/private/tmp/hardware-phase1-nginx/sbin/nginx node --test scripts/test-nginx.js
npm ci --prefix backend
npm ci --prefix frontend
npm run lint --prefix backend
npm run lint --prefix frontend
npm run build --prefix frontend
npm audit --prefix backend --json
npm audit --prefix frontend --json
```

See `LOCAL-DEVELOPMENT.md` for complete reproducible environment setup and credentials separation. The concrete final main disposable database was `hardware_phase1_final_test` on loopback port 55432; it contains synthetic records only. Earlier disposable baselines/reference databases were retained for evidence. The coordinator may stop the temporary cluster after completing final checks.

## CI and boundaries

The former push-to-EC2 workflow was removed. The deployment shell script now exits 1 with a release-blocked message. Verification CI runs locked installs, actual ESLint, syntax, migrations, restricted-role DB/security/containment tests, browser auth, frontend build, real TLS/nginx checks, dependency/secret scanning, and API plus web image builds from the same checkout. The release-blocker job separately exposes desired financial regressions and historical secret findings. It has no deployment action or production credentials. Repository branch protection and approvals remain operator changes.

Docker/Compose are **not installed locally**. Both image builds, container execution, volume ownership, Compose networking and service-image availability are therefore **BLOCKED locally**, not inferred from configuration. Redis is configured in Compose/CI but no native Redis process was available; the PDF worker/queue is disabled. CI was written but not executed remotely. Public TLS, production DB CA/hostname, live rotations, production least-privilege rollout, backups/restore and migration adoption remain unverified. Production remains blocked by these operator actions and later financial defects regardless of the green local checks.

## Independent review

The frontend/tests agent reviewed the environment/migration/CI/Docker changes read-only. Findings fixed: default backend test selection excludes the separate TLS fixture suite and financial release suite; migration tests explicitly restrict mode/host; browser no-undef is active; duplicate reconciliation SQL was removed in favor of `db/reconciliation/phase-2.sql`. The security agent independently identified the migration-only NODE_ENV typo bypass; it now fails closed. The coordinator requested atomic grants and removal of unnecessary DELETE privileges; both are applied and checked with the real restricted role.

I separately reviewed security/session issuance, revocation, authorization, and the session SQL written by the security agent. Issuance/revocation share transaction advisory locks without granting users UPDATE; role/password/active checks occur on issuance and session lookup; routes deny unspecified capabilities and catalog responses use an allowlist. No remaining blocking finding was identified within that reviewed scope. This is scoped review, not a full production security certification.


## Final tracked-snapshot proof

The final source snapshot was archived from Git's staged tree **`c1d871012796816b80409da95cde8d4f95b2b283`** into `/private/tmp/hardware-phase1-final-snapshot-mm5xhg2x`. Both dependency directories were absent before installing. This is an immutable candidate tree, not a commit or a remote revision. Only evidence-document updates followed the proof.

Executed from that clean final copy under Node 24.21.0/npm 11.17.0:

- Backend `npm ci`: exit 0, **417 packages installed**, 418 audited.
- Frontend `npm ci`: exit 0, **241 packages installed**, 242 audited.
- Backend `npm run lint` and `npm run check:syntax`: exit 0.
- Frontend `npm run lint`: exit 0.
- Frontend `npm run build`: exit 0, Vite **7.3.7**, **3,126 modules**, **2.77 seconds**. JS output **1,496.95 kB**, gzip **463.26 kB**. The existing large-chunk warning was retained; no financial calculation or assertion was altered to get a pass.
- Backend `npm run test:containment`: **13/13 PASS**, no skips, including the final PM2 assertion. PM2 now registers only the API and does not continuously restart the disabled PDF worker.

The immediately preceding staged source tree **`5f78eb7382ba97227cfe368c97429f42188248c8`**, independently archived at `/private/tmp/hardware-phase1-snapshot-ydi706nu`, also passed clean `npm ci`, both lint gates, syntax and build, plus the complete backend suite (**3 environment + 12 security + 12 containment**), frontend auth **4/4**, real TLS **1/1**, nginx **1/1**, and real browser **4/4**. The only subsequent source change was removing the PM2 worker entry plus its new regression assertion; the final clean-copy containment run above verifies that change. All authentication, migration, TLS, nginx and frontend source/build inputs are identical between the two snapshots.

The first clean-copy browser attempt failed before assertions because the browser cache location was unset. Re-running the unchanged test with `PLAYWRIGHT_BROWSERS_PATH=/private/tmp/hardware-phase1-browsers` used the exact previously installed Playwright Chromium and passed **4/4**. This setup failure was not hidden or treated as a code pass. The documented/CI `npx playwright install --with-deps chromium` step installs the required assets on a new machine.

The main native PostgreSQL cluster remained available for the coordinator's final verification at `/private/tmp/hardware-phase1-pg-5r5p2izn/data` (loopback port 55432). The temporary TLS clusters and nginx test processes were stopped. The coordinator can stop the main cluster without deleting its synthetic evidence data.

The coordinator reran the combined backend `npm test` in the final archive
`c1d871012796816b80409da95cde8d4f95b2b283`: **28/28 passed**, zero failures
or skips (3 environment, 12 security, 13 containment). This supersedes the earlier
27-test aggregate while preserving its unchanged frontend/TLS/nginx evidence.

After final verification, the coordinator stopped the owned main PostgreSQL
cluster with `pg_ctl -D /private/tmp/hardware-phase1-pg-5r5p2izn/data -m fast -w stop`.
The command exited 0 and reported `server stopped`. Its synthetic data directory
is retained; no unrelated service was stopped.
