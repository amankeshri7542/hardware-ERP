# Local development and migration safety

This setup is for disposable synthetic data only. Production release remains blocked by `RELEASE-BLOCKERS.md`. Never point test commands at a real shop database. Do not copy credentials from old documentation or history.

Phase 4 adds migrations 018–021 and admin settlement/day-close screens. Follow `PHASE-4-OPERATIONS.md` and `FINANCIAL-SETTLEMENT-CONTRACT.md`; apply current grants after migrations. Run all backend gates, original release invariants, frontend auth/financial tests and all four browser suites (including `test:phase4-browser`). `backend/tests/phase4/clean-scenario.test.js` creates separate clean and corrupt databases; day-close tests likewise use isolated databases so closed dates cannot contaminate other fixtures.

For every synthetic Node process set `NODE_OPTIONS=--require=<absolute-worktree>/scripts/local-only-network.cjs` **before startup**, including tests/build/API children. The browser harness additionally blocks external redirects, WebSockets and service workers before navigation. Build with Vite `envDir:false` and explicit `/api`; do not load a live `.env`. Documentation/dependency retrieval is a separate activity, never permission for test runtime egress. Exact executed commands and native runtime paths are in `PHASE-4-TEST-EVIDENCE.md`.

## Runtime and deterministic installation

Use Node **24.21.0** and npm **11.17.0**. Node 24 is supported LTS through April 2028; this patch was available and executed during verification. `.nvmrc`, `.node-version`, both manifests, lockfiles, CI and Docker agree. Use a version manager to select `.nvmrc`, then install the exact npm version. Commands below are ordinary shell commands; the Codex session used an `rtk` wrapper.

```sh
npm install --global npm@11.17.0
npm ci --prefix backend
npm ci --prefix frontend
```

Both lockfiles are tracked. `npm install` is only for an intentional reviewed dependency change, followed by lockfile review. Native dependencies use their packaged platform binaries; npm may report pending optional install scripts. The tested bcrypt, build and browser paths work with these locks. Do not copy `node_modules` or lockfiles from a developer's dirty checkout.

## Disposable local PostgreSQL and Redis

Docker Compose provides PostgreSQL 16.15 and Redis 7.4, both published only to loopback. PostgreSQL data lives in the dedicated `postgres_test_data` volume. Neither service uses a production account.

Generate shell-local values without printing them:

```sh
export LOCAL_DB_PASSWORD="$(openssl rand -hex 24)"
export LOCAL_APP_DB_PASSWORD="$(openssl rand -hex 24)"
export LOCAL_SESSION_SECRET="$(openssl rand -hex 32)"
docker compose up -d postgres redis
docker compose --profile tools run --rm migrate
```

Create the local application role once, then apply grants after every migration:

```sh
docker compose exec -T postgres psql -U erp_migrator -d hardware_erp_test -v ON_ERROR_STOP=1 -v app_password="$LOCAL_APP_DB_PASSWORD" <<'SQL'
CREATE ROLE erp_app LOGIN PASSWORD :'app_password' NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION;
SQL
docker compose exec -T postgres psql -U erp_migrator -d hardware_erp_test -v app_role=erp_app < db/grants.sql
docker compose up -d api
```

For native development, supply the same explicit variables to the backend, with `DB_HOST=127.0.0.1`, `DB_PORT=5432`, `DB_NAME=hardware_erp_test`, `DB_USER=erp_app`, `DB_PASSWORD` from the local app value, `NODE_ENV=test`, `SESSION_SECRET` from the local value, `DB_SSL=false`, `CORS_ORIGIN=http://localhost:5173`, `REDIS_HOST=127.0.0.1`, `REDIS_PORT=6379`, and `STORAGE_DRIVER=disabled`. Use `npm run dev --prefix backend` and `npm run dev --prefix frontend`. Container API and migration jobs use `postgres` and `redis` service names. PDF workers are intentionally disabled in Phase 1, so Compose does not launch them. Any later worker reactivation must retain `REDIS_HOST=redis` and the shared validated DB policy.

The root `.env` may hold these local values for Compose; it is ignored. Never check it in. `backend/.env.example` is a separate safe native-server template. Production configuration is never inferred from the presence or absence of an AWS key.

## Synthetic owner bootstrap

The old SQL seeds containing reusable account data are removed. `db/seeds/index.js` only runs with `NODE_ENV=test`, a local `*_test` database, and explicit `TEST_ADMIN_PASSWORD` of at least 12 characters. It creates `owner@example.invalid` with role `admin` and one synthetic product. Repeating the seed does not overwrite the password. It never creates a cashier or a production account.

Supply the local migration owner via `MIGRATION_DB_USER` and `MIGRATION_DB_PASSWORD`, then:

```sh
npm run seed:test --prefix backend
```

Generate `TEST_ADMIN_PASSWORD` locally and keep it out of logs. Production first-owner bootstrap is a separate reviewed operator action, not this seed.

## Migration commands and least privilege

The runner reads the same `databaseOptions` as the API. `NODE_ENV` must explicitly be `development`, `test` or `production`. Production requires `DB_SSL=true`, a readable valid `DB_SSL_CA_PATH`, verified hostname/CA, and separate `MIGRATION_DB_USER`/`MIGRATION_DB_PASSWORD`. It rejects missing/invalid CA rather than downgrading encryption.

```sh
npm run migrate --prefix backend
npm run migrate --prefix backend
```

Each migration has a SHA-256 checksum and a recorded filename/ID in `schema_migrations`. An exclusive session advisory lock rejects competing runners. Every SQL file and its journal row commit in one transaction; failures return nonzero and retain prior successful migrations. Changed/missing/reordered applied files fail. Files 001–011 are unchanged from audit `5404f98`; 013 adds sessions. There is no invented 012 because no additional schema gap was confirmed.

Use the schema owner only for migrations and fixture/bootstrap tasks. The runtime role must be `NOSUPERUSER NOCREATEDB NOCREATEROLE`, own no application objects, and receive `db/grants.sql` atomically after migration. It cannot change users, read/change the migration journal, alter schema, update/delete ledgers, or delete invoices/payments. DELETE is limited to sessions and the two catalog link tables used by existing services. No default future-table grants are installed; each migration needs a reviewed grant step.

All current migrations support transactions. A future operation such as `CREATE INDEX CONCURRENTLY` requires a separately designed and reviewed nontransactional procedure; this runner intentionally has no bypass flag. Sequence values are not transactionally reclaimed by PostgreSQL, so gaps are expected after rollback and must not be “repaired.” There are no down migrations. Roll back application code only if compatible with the expanded schema; fix failed later migrations forward. Back up and rehearse restore separately before any live migration. Never reset a real database.

## Existing schema without a migration journal

The runner refuses a populated untracked schema. It never guesses its migration history.

1. Keep application writes stopped for the operator rehearsal, take a verified backup, and use a read-only account for inspection. Do not run migration DDL against that database.
2. Create a separate empty disposable reference database ending `_test`, and replay the known claimed migration boundary, for example `node db/migrations/index.js --through=011`, with the reference database's migration credentials.
3. Point `DB_NAME` at the untracked schema, set `BASELINE_REFERENCE_DB` to the reference on the same PostgreSQL server, and run `node db/verify-baseline.js`. Both inspections use `BEGIN READ ONLY`; the command reports differing object names without dumping data or stamping history.
4. Investigate every difference. Matching structural catalogs are necessary, not proof that all historical data updates or operator changes ran. Review each historical SQL statement, extension versions, ownership/grants, and data postconditions (including 004 unit backfill and 011 empty SKU/barcode normalization). Run `db/reconciliation/phase-2.sql` read-only to prepare later financial work; never “correct” its output in Phase 1.
5. No automatic baselining command is supplied. A human must document the exact verified migration IDs/checksums, backup/restore evidence and approvals, then review an explicit journal-adoption transaction for that exact database. Stop if the history cannot be established. Only after adoption may normal forward migrations run.

The structural comparison intentionally does not certify business-data correctness, privileges, or a live environment.

## Verification commands

Tests require `NODE_ENV=test`, loopback DB host and a disposable database name ending `_test`. Security tests additionally require `TEST_APP_DB_USER` and `TEST_APP_DB_PASSWORD` for the separately granted runtime role; primary DB credentials must be the disposable fixture owner. Browser tests require `CORS_ORIGIN=http://localhost:5173` and a built frontend.

```sh
npm run lint --prefix backend
npm run check:syntax --prefix backend
npm run lint --prefix frontend
npm test --prefix backend
npm run test:auth --prefix frontend
npm run build --prefix frontend
cd frontend
npx playwright install --with-deps chromium
npm run test:browser
cd ..
sh scripts/test-db-tls.sh
node --test scripts/test-nginx.js
npm audit --prefix backend --audit-level=high
npm audit --prefix frontend --audit-level=high
python3 scripts/scan-secrets.py
```

The TLS self-check needs `initdb`, `pg_ctl`, `createdb`, `openssl` and Node in PATH and must run as a non-root user. It creates/removes its own local cluster on port 55433 (override `TEST_DB_TLS_PORT` if occupied). The nginx test needs an installed binary or `NGINX_BIN` pointing at a local binary; it generates a one-day certificate, listens on ephemeral loopback ports, and stops the server. These tests do not contact external services.

Run `npm run test:release-blockers --prefix backend` and `python3 scripts/scan-secrets.py --history` separately. They intentionally expose unresolved financial defects and historical credentials and are not hidden or skipped. CI separates these production-release gates from Phase 1 engineering checks. CI never deploys. Docker builds both API/web targets from the exact same checkout, and production configuration requires immutable image digests for both.

## Production transport template and remaining operator work

`docker-compose.production.yml` is a template, not approval. Configure `backend/.env.production` with a verified external DB hostname, CA and least-privilege app credentials, HTTPS CORS origin, session secret and other required values. It sets `DB_SSL_CA_PATH=/run/certs/db-ca.pem` to match the CA mount. Mount certificate/key paths readable by nginx uid 101. Non-root nginx uses 8080/8443 internally; only 80/443 are published. API and Redis have no published ports. The API trusts only nginx's fixed private-network address; native nginx deployments should trust only their actual loopback proxy addresses.

The API image runs as `node`; nginx runs as uid 101. Secrets, local uploads, dependencies and generated artifacts are excluded from Docker context. PDFs/uploads remain disabled even though writable directories are prepared. Public HTTPS, DNS/cert renewal, image execution, live credentials/rotation, branch protection, backup/restore and production rollout remain unverified operator actions. Do not use the old deployment script: it now exits with a clear release-blocked message.


## Stabilization browser isolation and evidence

Use `npm run test:browser-all --prefix frontend` for all61 current browser cases, or the individual browser scripts. These scripts create a new uniquely named disposable `_test` database using fixture-owner credentials, replay real migrations/grants and run API requests as the restricted application role. Backend negative fixtures remain intact in their own book. Never truncate a shared database or bypass CASH_RECONCILIATION_REQUIRED. Supply TEST_APP_DB_USER/TEST_APP_DB_PASSWORD plus fixture owner via DB_USER/DB_PASSWORD (or FIXTURE_DB_USER/FIXTURE_DB_PASSWORD if runtime DB_USER is restricted).

Keep NODE_OPTIONS preloading the absolute `scripts/local-only-network.cjs` before all test/build processes; browser route/redirect/WebSocket/service-worker guards precede navigation. Use synthetic credentials and no live .env. BROWSER_ARTIFACT_ROOT may name an absolute owned artifact root; default uses os.tmpdir. Download paths are per-test owned directories. Only sanitized browser evidence is publishable; raw traces are private temporary files removed after allowlisted conversion. The diagnostic self-check deliberately fails three child cases and passes only if failures propagate and all published output excludes the credential canary. Run the separate cash-isolation control as well; commands are in `PHASE-5-TEST-EVIDENCE.md`.

Current Linux workflow execution remains unverified despite native61/61. See `PHASE-4-STABILIZATION-REPORT.md`; do not enable document runtime or publish this unstaged candidate to obtain a green badge without new authorization.


## 2026-10-10 development sequencing update

The latest Phase5B request supersedes the previous no-push/development-stop instructions above for this task only. Independently safe document development is authorized while historical incidents remain owner-pending; reviewed development-branch checkpoint pushes may obtain Linux CI. No production approval or deployment is authorized. See PHASE-5B-PLAN.md and INCIDENT-REGISTER.md for current scope; prior reports remain dated evidence.

## Phase5B synthetic document verification

Only the isolated development candidate is authorized. The prior design-only/no-push sequencing is superseded by the current branch-only CI permission; historical incident and production gates remain. Migration022 creates document evidence and023 explicitly hardens privileged function search paths. Never edit applied migration bytes or retrofit historical seller snapshots.

After ordinary migrations/grants, create a separate synthetic NOSUPERUSER/NOCREATEDB/NOCREATEROLE worker role and apply `db/document-worker-grants.sql` with psql variable `document_role`. API role uses `db/grants.sql`. Fixture role may create disposable databases; application/worker processes must use restricted roles. `TEST_DOCUMENT_WORKER_USER/PASSWORD` lets the clean browser/database helpers provision these grants. Never use live dotenv.

Every application/test/build Node process preloads `scripts/local-only-network.cjs`. Mode requires NODE_ENV=test, DOCUMENT_RUNTIME_MODE=synthetic-local and DOCUMENT_RENDERER_DRIVER=macos-sandbox on supported macOS, or docker after the reviewed renderer image is built. DOCUMENT_ARTIFACT_ROOT must be an owned canonical0700 directory outside source. Explicit synthetic seller settings require DOCUMENT_SELLER_CONFIRMED=true plus STORE_NAME/ADDRESS/GSTIN; missing facts block documents. Production always denies this path.

`node backend/document-worker.js --once` processes at most one leased job with DOCUMENT_DB_USER/PASSWORD distinct from DB_USER; `--cleanup` removes only aged owned unreferenced objects under the shared publication lock. Run `npm test --prefix backend`, original `test:release-blockers`, frontend auth/financial/build/browser-all, and isolated renderer/output suites as documented in PHASE-5B-TEST-EVIDENCE. Dependencies and advisory/GitHub tooling use separate non-application retrieval environments. Browser guards precede navigation and block external redirects, sockets and service workers.
