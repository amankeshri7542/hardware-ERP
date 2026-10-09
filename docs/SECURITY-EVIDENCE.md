# Phase 1 sessions, permissions and configuration evidence

Scope: local candidate worktree based on audit commit `5404f98b27eb8c326aa3ebc603ee43efe6394404`. No production services, accounts, keys or business data were used. This is Phase 1 evidence, not production approval.

## Session contract and invalidation

`POST /api/auth/login` accepts the existing `{email,password}` body and returns `{success:true,data:{user:{id,name,role,capabilities}}}`. Authentication is exclusively an opaque 256-bit random cookie. No bearer token is returned or accepted. Legacy JWTs and refresh cookies cannot authenticate. Login/logout clear the obsolete refresh cookie; the frontend separately removes obsolete browser-readable auth storage without removing billing drafts.

`GET /api/auth/session` restores the user from PostgreSQL. `POST /api/auth/refresh` remains a compatibility session read, with no rotation, lifetime extension or bearer token. Concurrent reads and refreshes therefore have no rotation race. The frontend need not refresh or retry failed mutations.

Sessions have a fixed eight-hour lifetime. Only an HMAC-SHA256 digest of the random credential is stored, using `SESSION_SECRET`; a SHA256 fingerprint of the user's password hash is bound to the session. Every protected request reads the live active user, current role and expiry. Login and account-change revocation serialize through a per-user transaction advisory lock. The application role needs no UPDATE privilege on `users`.

Logout deletes the current session. Updating password hash, active status or role deletes every session for that user through migration 013's trigger. Disabling then re-enabling the account does not resurrect a prior cookie. Rotating `SESSION_SECRET` invalidates every existing cookie. Requests already executing when a revocation occurs are not cancelled. Expired rows are removed on login; this small-shop cleanup is not a separate scheduler.

Development/test cookie: `erp_session`; production cookie: `__Host-erp_session`. Both are HttpOnly, SameSite=Strict, Path=/, without Domain; production is always Secure. Production requires `HTTPS_ENABLED=true`, an explicit HTTPS origin allowlist and a non-placeholder secret of at least 32 characters. Deployment must provide actual TLS; configuration alone does not prove it.

Every unsafe `/api` method, including login/logout, requires an exact allowed Origin. Missing, `null` and foreign origins return 403. Non-browser API clients must send the configured Origin and session cookie. CORS uses the same exact origins with credentials. Proxy trust defaults to false and accepts only explicitly configured IPs/CIDRs. Rate limits are 5 login attempts/15 minutes/IP and 200 API requests/minute/IP. They use IPv6 subnet-aware keys; malformed forwarded addresses fall back to the socket address and do not enter diagnostic logs. Limit counters are process-local and reset on restart; the candidate runs one API process. Multiple API processes require a shared rate-limit store before rollout.

## Capability matrix

The baseline schema supported only `admin`; no owner role existed to migrate. Migration 013 permits `cashier` without creating any accounts. Unknown roles and unclassified endpoint/method combinations have no privileges. Capabilities come from the server's role map, not the request or a persisted browser user.

| Operation | Admin | Cashier |
|---|---|---|
| Catalog list, search, barcode, basic details and unit conversions | Allowed, including cost fields | Allowed with product/conversion field allowlists |
| Catalog creation, prices and product/supplier links | Allowed (`catalog.write`) | Denied |
| Direct stock changes | Requires `catalog.write` and `stock.adjust` | Denied |
| Stock ledger, price history, supplier costs | Allowed | Denied |
| Billing, invoices and returns | Allowed subject to documented later-phase release blockers | Denied |
| Customers, suppliers, purchases and payments | Allowed | Denied |
| Dashboard, reports, exports and settings | Allowed | Denied |
| PDF generation/download and purchase attachments | Contained server-side for all roles | Denied |

Cashier billing stays disabled because the financial path still accepts client-supplied cost/base-quantity inputs pending Phase 2. Basic catalog responses include selling prices, inventory quantities, `min_stock` and conversion values, but omit purchase price, profit, cost snapshots, suppliers and price history. Invoice/report responses are wholly denied to cashier, so their cost fields have no cashier response path. Admin retains the existing financial workflow; that does not certify its financial correctness.

## Executed checks

Test-first: `backend/tests/security/revocation.test.js` ran against the old auth implementation and unchanged migrations 001–011 in disposable `hardware_phase1_test`. The intended assertion failed: a credential issued before logout still received **200 instead of 401**. The same test passed after persisted sessions were implemented.

Final run on 2026-10-09: Node **24.21.0**, disposable PostgreSQL database `hardware_phase1_final_test`, migrations including amended, unpublished 013, owner fixture role and separate restricted `phase1_app` application role. Command, with local synthetic environment variables supplied separately:

```sh
rtk proxy /private/tmp/hardware-phase1-runtime/node_modules/node/bin/node --test tests/security/*.test.js
```

Working directory: `backend`. Required environment names: `NODE_ENV=test`, `DB_HOST`, `DB_PORT`, `DB_NAME` ending `_test`, `DB_USER`, `DB_PASSWORD`, `SESSION_SECRET`, `TEST_APP_DB_USER`, `TEST_APP_DB_PASSWORD`. The tests reject non-loopback database hosts and non-test database names. Credentials are intentionally omitted here. The reproducible CI/local entry point is `npm run test:security` after the runbook's database/grant setup.

Result: **12 tests passed, 0 failed, 0 skipped**. Evidence covers opaque cookie attributes/digest storage, fixed expiry, logout reuse denial, password/role/disable-reenable revocation, issuance racing account disablement, concurrent session/refresh requests, real restricted-role login/logout without users INSERT/UPDATE, legacy bearer rejection, exact Origin enforcement, cashier API denials and response redaction including unit conversions, generic authentication errors, login rate limits, production configuration rejection, and omission of passwords/cookies/connection strings and malformed forwarded headers from client errors and logs. Request IDs are generated by the server.

Database TLS handshake and migration failure/checksum evidence are owned by the environment/migration suite. Browser storage/navigation checks, document endpoint containment and financial release blockers are covered by their separate suites and reports. No live secret rotation, public HTTPS, deployed proxy topology, dependency internals or production account configuration was verified.

Current documentation consulted through Context7: Express proxy trust and secure cookies (shared by the coordinator), plus express-rate-limit's `ipKeyGenerator`/validation guidance at https://github.com/express-rate-limit/express-rate-limit/blob/main/docs/reference/helpers.mdx and https://github.com/express-rate-limit/express-rate-limit/blob/main/docs/reference/configuration.mdx.
