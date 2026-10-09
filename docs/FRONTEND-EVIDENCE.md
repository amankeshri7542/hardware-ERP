# Frontend and financial regression evidence

Audit baseline: `5404f98b27eb8c326aa3ebc603ee43efe6394404`. All changes and tests were made in the isolated `codex/phase-1-security-baseline` worktree. This is Phase 1 engineering evidence, not release approval.

## Frontend scope

- Cookie-only authentication: the client consumes `GET /api/auth/session` and the login user DTO. It stores no access/refresh credentials and removes only the legacy `erp_token` and `erp_user` keys. Other storage, including the existing billing-draft key, is preserved.
- Startup is deduplicated. HTTP 401 clears session state without a document reload, refresh request, or replay of the failed mutation. Both sign-out controls await the server; a network failure shows an error instead of claiming revocation succeeded.
- The server capability list controls navigation. Cashiers can view the product catalog without cost fields or product mutation/detail controls. Billing and other modules are denied; server authorization remains the security boundary.
- PDF actions and polling are removed/disabled, with plain-language notices. Supplier invoice attachments and retrieval are unavailable. Ordinary purchase entry remains enabled. These features are contained, not repaired.
- Existing `useBilling` does not use the separate persistent billing store. This change preserves unrelated stored drafts; it does not introduce new persistence for unsaved in-memory forms.

## Measured checks

Runtime: Node `24.21.0`, freshly installed locked frontend/backend dependencies. Browser: Playwright Chromium `156.0.8078.4`, downloaded into a disposable temporary cache. Final database: native PostgreSQL on loopback port `55432`, `hardware_phase1_final_test`, migrated by the versioned runner. Only synthetic `.invalid` accounts, products, customers and transactions were used.

Commands actually invoked from the respective package directories (the Node executable was `/private/tmp/hardware-phase1-runtime/node_modules/node/bin/node`):

```sh
rtk proxy node --test tests/auth.test.js
rtk proxy env VITE_API_URL=/api node node_modules/vite/bin/vite.js build
rtk proxy env PLAYWRIGHT_BROWSERS_PATH=/private/tmp/hardware-phase1-browsers node node_modules/playwright/cli.js install chromium
rtk proxy node --test tests/browser.test.js
rtk proxy node --test tests/release-blockers/financial.test.js
```

Database test commands were launched with explicit `NODE_ENV=test`, loopback DB settings, `CORS_ORIGIN=http://localhost:5173`, disabled storage, bounded loopback proxy trust, and a fresh random synthetic session secret. Values were supplied through a Python subprocess environment and not written to an environment file. The browser suite serves the built `dist` and real API on port 5173; it does not use a pre-existing browser profile or production service.

- Before the frontend fix: two security tripwires failed on browser-readable localStorage credentials and hard-location redirect behavior.
- After the fix: auth suite **4 passed, 0 failed, 0 skipped**, including actual Zustand store/Axios adapter behavior and capability navigation.
- Frontend ESLint with undefined-variable checking: **passed**. Seven unused empty CommonJS barrel placeholders were converted to ESM, and two obsolete suppressions for an absent hooks rule were removed.
- Build: **passed**; Vite reports the pre-existing large-bundle warning. No code-splitting work was added.
- Real browser suite: **4 passed, 0 failed, 0 skipped**. It verifies HttpOnly/SameSite cookie login, captured-cookie rejection after logout, expiry and account-disablement revocation, exactly one rejected mutation request, no refresh request, preservation of a draft key and the document lifetime, cashier catalog redaction/direct API denial, and explicit disabled document controls.
- Financial release suite on the final schema: **2 passed, 9 failed, 0 skipped**. Nonzero exit is intentional and must block release. Passing checks verify real negative-stock rejection and append-only customer-ledger protection.

## Financial desired-behavior failures

Every case uses the real local Express endpoint, authenticated session and PostgreSQL transaction/constraints. No accounting behavior was changed to make these tests pass.

| ID | Desired invariant | Observed result |
| --- | --- | --- |
| FIN-01 | Two sold pieces deduct two pieces regardless of client `base_qty=1` | Stock 99 instead of 98 from an initial 100 |
| FIN-02 | Snapshot uses authoritative product cost 30 | Client cost 999 persisted |
| FIN-03 | Per-unit discount 200 on rate 100 is rejected | HTTP 201 instead of 422 |
| FIN-04 | Unpaid customer Quick Bill debits the customer ledger | Outstanding 0 instead of 200 |
| FIN-05 | Split total 10 cannot record amount paid 50 | HTTP 201 instead of 422 |
| FIN-06 | Duplicate full-return lines cannot exceed original quantity | HTTP 201 instead of 422 |
| FIN-07 | Return product must match the original invoice item | Wrong product accepted, HTTP 201 |
| FIN-08 | Purchase return must bind product/quantity/price to its purchase | Unrelated product/client price accepted, HTTP 201 |
| FIN-09 | Repeated idempotency key returns one committed invoice | Two distinct invoices created |

Synthetic financial fixtures are left only in the disposable test database because ledgers remain append-only. Destroy the disposable database/cluster as a unit when finished; do not delete ledger rows or run a reset against a real database.

## Initial browser isolation incident and corrected boundary

The initial browser attempt used a build made before the tracked production API setting was replaced with `/api`. That configuration could point away from the local API. The tests entered generated `.invalid` account names and synthetic passwords, then timed out waiting for local auth responses; no successful local auth was observed in those attempts. External request URL/status metadata was not captured, so external attempts or delivery cannot be ruled out. No external endpoint was revisited to investigate. This initial run is not counted as local-only evidence, and no claim of verified non-contact is made.

Subsequent builds explicitly set `VITE_API_URL=/api`. Before creating any page, the browser suite now rejects every network origin except the exact local origin, fetches allowed requests with zero redirects and zero retries, rejects any external Location header before browser follow-through, blocks service workers, and closes all WebSockets without connecting to a server. Data URLs and same-origin blob URLs remain local. Tests fail if any nonlocal request or WebSocket was attempted. All reported passing browser evidence comes from this contained run.

## Limits

No production rollout, live TLS/cookie verification, credential rotation, real business-data reconciliation, Docker runtime proof, Firefox/WebKit/mobile coverage, or full accounting repair is claimed here. The browser suite validates a locally served production build with real API/DB, while nginx document headers are a separate coordinator-owned check. The full release remains blocked by the nine financial regressions and the operator actions in the security runbook.


## Independent environment review

Read-only review of the other specialist's migration runner, baseline comparison, database grants, Docker/Compose, CI and test wiring found:

- The intermediate default backend test glob included the intentionally failing financial suite and the separately provisioned TLS tests. The final manifest uses explicit environment/security/containment suites; the financial and history checks remain in a separate release-blocking CI job. No failed financial assertion was weakened.
- Frontend lint initially disabled undefined-variable checking. The final config enables it with browser globals; the existing empty CommonJS placeholders and obsolete rule suppressions were corrected, and lint passes.
- The migration test harness initially checked only a `_test` name despite creating/dropping schemas. The author added explicit test-mode and loopback-host guards, verified by final code review.
- No further blocking issue was found in the reviewed checksum/order/locking/transaction boundaries, refusal to auto-baseline an untracked schema, read-only schema comparison, explicit Docker targets, non-root containers, loopback/internal ports, narrow proxy trust, or absence of deployment actions in the final workflow.

This review did not execute Docker or GitHub Actions, examine real credentials, or certify a live upgrade. Local runtime evidence for TLS/nginx/migrations belongs to the environment specialist and is separately reported.

The completed local-development guide was also reviewed: it documents separate fixture/runtime credentials, explicit test configuration, a read-only comparison against a disposable reference schema, historical data-postcondition review, and manual operator-approved adoption rather than automatic migration stamping. A duplicate reconciliation script was flagged for consolidation with the coordinator's more comprehensive Phase 2 checks.
