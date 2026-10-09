# Phase 1 report — local candidate, production blocked

Date: 2026-10-09. Baseline/current commit:
`5404f98b27eb8c326aa3ebc603ee43efe6394404`.
Branch: `codex/phase-1-security-baseline`, isolated worktree
`/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp`.
No commit, push, merge or deployment is part of this delivery. The candidate is
the staged/local diff. The original checkout's uncommitted AI/mobile/UI work is
excluded and was not edited. The committed starting HEAD equals the audit SHA;
no reset to an older revision was performed.

## Gate status

| Gate | Status | Evidence / limitation |
|---|---|---|
| A. Phase 1 local engineering | **BLOCKED overall** | Functional/security checks described below pass; Docker/image build and runtime verification cannot run on this host |
| B. Live operational actions | **PENDING** | No public HTTPS, live credential rotation/session invalidation, deployed DB roles, firewall, backups or remote branch-protection checks verified |
| C. Full production release | **BLOCKED** | Nine financial desired-behavior tests fail; historical secret findings and required operator checks remain; document delivery is disabled |

The Phase 1 checkpoint is not marked complete merely because a subset is green.
The repository contains executable gates and a precise handoff for the unavailable
checks. No Phase 2 financial repair was undertaken.

## Implemented changes

- Pin supported Node 24.21.0/npm 11.17.0, track both lockfiles and use `npm ci`.
  Provide explicit local PostgreSQL/Redis setup, synthetic bootstrap, a separate
  migration role and restricted app grants. Containers run non-root, exclude
  secrets/artifacts and keep internal services private. See environment evidence
  for the targeted dependency upgrades and remaining advisories.
- Replace the empty migration entrypoint with per-file IDs/SHA-256 checksums,
  transactions, advisory locking and nonzero failures. Preserve historical SQL
  001–011. Add **013_revocable_sessions.sql**; no unsupported 012 gap was invented.
  Existing untracked schemas are refused and have a read-only comparison procedure.
- Replace JWT refresh/bearer storage with fixed eight-hour opaque HttpOnly sessions
  persisted as keyed digests. Logout, password/account changes and expiry revoke
  access. Concurrent session reads require no rotation. Origin checks, strict
  cookies, precise proxy trust, generic errors, bounded rate limits, request IDs,
  safe logging, capability authorization and cashier catalog DTO redaction are
  enforced server-side. Cashier billing remains disabled.
- Contain invoice/report PDFs and supplier upload/retrieval in all HTTP, direct,
  queue, worker and manual paths. Remove Chromium/multipart execution. Pure invoice
  HTML formatting escapes text and allowlists templates, but is not an enabled or
  certified renderer. UI notices explain unavailable actions.
- Replace push deployment with local engineering/release checks; add ESLint,
  database/security/browser/containment suites, scans and image-build gates. Keep
  financial defects in a separate failing release suite. Remove the unsafe
  deployment script behavior and swallowed migration errors.
- Remove exposed credential prose, supersede misleading context/setup instructions,
  and add the plan, runbook, blocker ledger, independent review and Phase 2 handoff.

## Measured evidence

Environment-specific commands and resolved dependency versions are recorded in
`ENVIRONMENT-EVIDENCE.md`; session evidence in `SECURITY-EVIDENCE.md`; browser and
financial reproduction evidence in `FRONTEND-EVIDENCE.md`.

| Check | Measured outcome |
|---|---|
| Auth/session/security suite | **12 passed, 0 failed/skipped**, real PostgreSQL and restricted app-role login/logout |
| Document containment suite | **13 passed, 0 failed/skipped**, all ten PDF routes, malformed/missing-parent/spoofed/6MiB uploads, no file creation, local network canary, literal HTML/template text and disabled PM2-worker registration |
| Environment integration suite | **3 passed**, including actual fresh/repeated historical migrations, failure/checksum/concurrent-run protection and populated 001–011 → 013 preservation |
| Database TLS integration | **1 passed**, real local PostgreSQL TLS, trusted/mismatched host/CA checks |
| nginx SPA transport | **1 passed**, real temporary nginx, HTTPS document headers and HTTP redirect |
| Frontend auth checks | **4 passed**; source and store/interceptor checks supplement rather than replace browser checks |
| Real local browser suite | **4 passed, 0 skipped**, after enforcing a local-only request guard |
| Financial release suite | **2 passed, 9 failed, 0 skipped**; each failure remains a release blocker |
| Baseline comparison | **367 schema objects matched** independent historical replay; no migration stamping |
| Reconciliation SQL | Executed in a read-only transaction against synthetic data; detected return/split/purchase-identity counterexamples, then rolled back |
| Current tracked-source secrets | **0 Gitleaks findings** after removing static test-secret fixture; final tracked-candidate scan is recorded below |
| Available local Git history | **2 redacted findings** in Gitleaks 8.30.1; 47 commits analyzed, 49 reachable commits, non-shallow checkout |
| Docker build/runtime | **BLOCKED**: Docker is absent; checked-in configuration and CI are not runtime proof |

Selected test-first evidence is explicit: old logout left an issued bearer usable
(200 instead of 401); the empty migration runner failed its invocation test; old
frontend auth persistence and refresh behavior failed source tripwires; original
document paths failed all three containment source assertions. Independent review
added two template-text regressions that failed before the single-pass fix and
passed afterward. The PM2 configuration also failed a new assertion while it still
registered the intentionally disabled worker; removing that entry made it pass.
Not every new assertion was independently rerun against the
entire original application; no blanket historical test coverage is claimed.

## Final candidate verification

The tested source tree is `c1d871012796816b80409da95cde8d4f95b2b283`,
archived from the Git index into
`/private/tmp/hardware-phase1-final-snapshot-mm5xhg2x`. This is an immutable
Git tree, not a commit. Only evidence-document edits followed the source snapshot.

Both dependency directories were absent before installation. Under Node
24.21.0/npm 11.17.0, fresh `npm ci` installed 417 backend and 241 frontend
packages. Both lints, backend syntax checks and frontend build passed. Vite 7.3.7
built 3,126 modules; the existing 1,496.95 kB JavaScript chunk warning remains
(463.26 kB gzip).

The coordinator then ran the combined `npm test` from that final clean archive
against the synthetic loopback database: **28 passed, 0 failed/skipped**
(3 environment, 12 security, 13 containment). The same authentication, migration,
frontend, TLS and nginx source had already passed the independently archived
preceding tree's full checks. The only intervening source changes were the PM2
worker removal and its regression assertion, both covered in this final run.
See `ENVIRONMENT-EVIDENCE.md` for exact archive and browser-cache details.

Final delivery checks: the tracked-candidate Gitleaks scan reports **0 findings**;
both working and staged diffs pass `git diff --check`. Historical findings remain
unchanged and require operator action. The original checkout remains at the
audit SHA with its original uncommitted AI/mobile/UI file list; this candidate
is staged in the isolated worktree without a commit, push, merge or deployment.

The requested `find-skills` discovery checked the skills.sh leaderboard and
source reputation. Anthropic's official `webapp-testing` entry had 172,951 installs
and its source repository had 180,043 stars at lookup. Existing local security
review and release-check skills covered the needed work; no new skill was
installed. The three specialist agents used GPT-6 Astra/xhigh. No coordinator
runtime-model change is claimed.

## Reproduction commands

Use the exact synthetic environment in `LOCAL-DEVELOPMENT.md`; never load a live
`.env`. For the measured native run, `DB_HOST=127.0.0.1`, `DB_PORT=55432`,
`DB_NAME=hardware_phase1_final_test`; credentials are explicitly disposable.
Runtime path: `/private/tmp/hardware-phase1-runtime/node_modules/node/bin/node`.

```sh
npm ci --prefix backend
npm ci --prefix frontend
npm run lint --prefix backend
npm run check:syntax --prefix backend
npm run lint --prefix frontend
npm run migrate --prefix backend
npm run migrate --prefix backend
npm test --prefix backend
npm run test:auth --prefix frontend
npm run build --prefix frontend
npm run test:browser --prefix frontend
npm run test:release-blockers --prefix backend
python3 scripts/scan-secrets.py
python3 scripts/scan-secrets.py --history
psql -v ON_ERROR_STOP=1 -f db/reconciliation/phase-2.sql
```

The financial and history commands deliberately exit nonzero while blockers
remain. The clean candidate snapshot/install/build and additional TLS/nginx
commands, tree identifier and outcomes are documented in environment evidence.
Do not infer that remote CI ran; it has not been pushed or dispatched.

## Safety deviation and limits

An initial browser test launched a build before the tracked production API setting
was replaced. Local login/session requests timed out, with no local auth logs. An
external request attempt to the old configured API **cannot be ruled out**. Only
generated `.invalid` account names and synthetic test passwords were entered; no
real credentials were used. No external URL/status metadata was retained, so its
network outcome is unknown. That run was stopped and is not counted as safe
verification. Subsequent builds use `/api`, and browser contexts block non-local
destinations, external redirects, service workers and WebSockets before navigation.
No external endpoint was contacted to investigate the deviation.

History scanning covered locally available objects only, not inaccessible/deleted
remote refs, external clones or provider logs. Current-file cleanup is not proof
of live rotation. No public TLS or production database/business state was examined.
Disposable fixtures demonstrate counterexamples, not exhaustive financial safety
or measured production load. The shop/user/invoice volumes remain assumptions.

## Review, operator actions and recovery

Read `INDEPENDENT-REVIEW.md` for author-independent findings and their disposition.
The template substitution finding was reproduced/fixed and independently rerun.
The DB-grant review removed unnecessary financial DELETE privileges, without
removing the required session/product-link operations. Migration mode validation
and Docker/configuration compatibility also received independent review.

Operators still need to revoke/rotate disclosed credentials, invalidate old
sessions, verify real TLS and proxy/private-network boundaries, rehearse backup
restoration and migration baselining on an authorized copy, run image/CI gates,
configure protected checks and approve one immutable frontend/backend revision.
Financial and document-release blockers must be resolved separately.

Rollback means stopping the candidate and preserving the database; it does not
mean restoring insecure JWT/PDF code or deleting financial tables. Historical
migrations/ledgers remain intact. There is no automatic down migration. Prefer a
reviewed forward fix; session invalidation may require users to sign in again.
Full operator sequencing is in `SECURITY-RUNBOOK.md`.
