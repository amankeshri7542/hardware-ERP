# Phase 2 frontend evidence

> Final verification: code commit `726af321` passed remote engineering CI run 37910576845, including browser journeys. Earlier pending notes record intermediate states; see the final remote verification in PHASE-2-TEST-EVIDENCE.md. Production release remains blocked.

Scope: ordinary billing, Quick Bill, standalone receipts, exact draft previews and durable recovery. Work is isolated in `codex/phase-1-security-baseline`; no staging, commit, push or deployment was performed by this frontend specialist. Phase 1 cashier restrictions, cookie sessions and disabled PDFs/attachments remain in place.

## Behavior

- Quantity is a decimal string with at most three places; negotiated rates and discounts are per selected selling unit. Stock conversion uses the catalog sales-unit conversion and must be exact at three places. Changing the selling unit clears the rate and requires deliberate re-entry. Empty rates are invalid, not free sales.
- Draft arithmetic uses scaled integers. Percentage discounts round to per-unit cents first; gross/taxable/GST round per line. The frontend matches the shared backend fixture amounts. Fixed and percentage discounts are mutually exclusive in submitted intent. GST is shown from the catalog and cannot be edited in billing.
- Every finalization obtains a server quote, shows authoritative selected quantities/rates, stock quantity, tax, total and exact tender split, then requires an explicit confirmation. Changes during a quote invalidate it. A server `QUOTE_CHANGED` rejection requires a fresh review. Requests omit client cost, tax, base quantity, snapshots and derived totals. Billing no longer writes product master prices.
- Anonymous Quick Bill reviews and pays the complete quoted total. A walk-in name does not make a customer account. Registered customer Quick Bills use the normal customer/due-date workflow.
- Invoice and payment requests persist a UUID and the exact submitted payload before dispatch, scoped by the original actor and operation. The original actor ID is persisted and passed unchanged through `Idempotency-Actor`; the backend compares it with the actual session user before any idempotency lookup or posting. A different tab changing the shared cookie cannot transfer the pending operation to another user. An unavailable recovery store or unsupported Web Locks blocks dispatch. A Web Lock covers reading, starting, persisting, dispatching and clearing an operation across tabs; storage events refresh other tabs.
- Lost response, server failure, authentication loss, key conflict and timeout/rate-limit outcomes retain the original request. A failed recovery attempt never unlocks an already uncertain operation, even if it returns a validation status. Recovery is explicit and reuses the original key/payload. Login never replays a mutation. Starting a new intent requires a known completion or explicit rejected-request edit.
- Saved completion receipts omit cost/profit fields. The UI shows server-returned invoice/payment balances; invoice payment history consumes the actual returned `data.payments` shape. Payment recovery remains visible even when the invoice's current balance has reached zero.

## Test boundaries

All application/test Node processes preload `scripts/local-only-network.cjs` before importing the backend or browser driver. Frontend test scripts use `scripts/run-local-tests.cjs` so child processes inherit the guard. Browser contexts block service workers and WebSockets, install the exact `http://localhost:5173` origin boundary before page creation, disable request retries/redirect following, and reject nonlocal redirect locations before delivery. The build uses `VITE_API_URL=/api`.

The disposable database is `hardware_phase2_frontend_test`, on loopback port 55432, through migration 015. Express runs as restricted `phase1_app`; fixtures and assertions use a separate owner pool. Credentials and session secrets are synthetic/local only. Each browser context uses a distinct synthetic loopback forwarded address to avoid sharing the login rate-limit budget between independent fixtures. No rate limiter is disabled. Financial fixtures remain in this disposable database because posted ledgers are append-only.

## Checks

Commands use pinned Node 24.21.0. Runtime configuration additionally sets `NODE_ENV=test`, loopback database variables, `CORS_ORIGIN=http://localhost:5173`, disabled storage, the loopback proxy range and the local Chromium cache. No environment files were read.

- `node ../scripts/run-local-tests.cjs --test tests/auth.test.js tests/financial.test.js`: 12 passed. Covers existing auth/capability rules, exact decimal/unit fixtures, same-key lost-response recovery, failed recovery remaining locked, first-attempt typed rejection, storage failure before dispatch and cost-free persisted receipts and malformed successful transport responses remaining uncertain and original-actor dispatch binding.
- `node node_modules/eslint/bin/eslint.js src`: passed.
- `VITE_API_URL=/api node node_modules/vite/bin/vite.js build`: passed. Existing large-bundle warning remains (~1.508 MB JavaScript, ~467.9 KB gzip; final asset `index-ii5Cd8FD.js`); no unrelated bundle refactor was added.
- `git diff --check HEAD`: passed.
- `node ../scripts/run-local-tests.cjs --test tests/financial-browser.test.js`: **9 passed, 0 failed, 0 skipped**, current build and migration 015. Duration 14.46 seconds.
- `node ../scripts/run-local-tests.cjs --test tests/browser.test.js`: **4 passed, 0 failed, 0 skipped**, run immediately afterward against the same guarded runtime configuration. Duration 2.80 seconds.

Final financial browser coverage:

| Journey | Verified outcome |
| --- | --- |
| Fractional selected-unit sale and mixed tenders | 0.125 box at 10.01 per box, 12.50% discount, 18% GST; server total 1.30; 1.000 base unit removed; exact 0.10 cash + 1.20 UPI; customer ledger zero; catalog price unchanged. |
| Lost invoice response, reload and explicit retry | Actual server commit followed by transport loss; same key/payload recovers one paid invoice; explicit New Quick Bill creates a different key. |
| Expired authentication | First invoice request denied once; login makes no financial replay; explicit recovery retains the original key/payload. |
| Catalog changed after quote | No invoice on `QUOTE_CHANGED`; corrected review uses new authoritative 11.80 total and a new key. |
| Draft edited while quote is outstanding | Review is discarded and no invoice POST occurs. |
| Registered customer Quick Bill and payment recovery | Unpaid 10.00 posts to the customer ledger; lost 0.30 receipt response recovers one payment and authoritative 9.70 balance. |
| Two tabs finalize together | One persisted operation and one invoice; both tabs receive the same completed result. |
| Named walk-in | Name alone cannot create debt; explicit full tender records a paid anonymous Quick Bill. |
| Shared-cookie account switch | Administrator A loses a committed response; another tab signs in as B; stale A retry is rejected with `OPERATION_ACTOR_MISMATCH` and no second invoice. Signing back in as A explicitly recovers the original result with the identical actor/key/payload. |

Every browser context's nonlocal/WebSocket attempt count remained zero. All assertions ran against the actual Express/PostgreSQL result; there were no skipped financial cases.

The financial browser journeys exercise actual React, Express and PostgreSQL. Only transport delivery is interrupted after a real server commit for the lost-response tests; billing/payment responses are not mocked. The unit tests were added before the retry implementation and initially failed on the missing module. Later malformed-response and original-actor regressions were also captured red before their fixes. Earlier browser failures exposed the existing invoice payment-history shape mismatch and the product-search stale blur timer; independent review also corrected stale keyboard shortcut guards and ambiguous receipt handling. Other failures were Ant Design interaction/name selectors and login rate-limit fixture issues. Closed review dialogs also unmount before showing the successful receipt. They were corrected rather than skipped.

## Independent backend review

Read-only review covered `utils/idempotency.js`, `modules/payments/paymentPosting.js`, payment service/controller/router and application auth ordering. The initial transaction/locking review found no defect in posting atomicity: key reservation and result share the posting transaction; concurrent conflicts wait for the committed original result; canonical intent is independent of mutable catalog state; invoice ownership and balance checks, exact tender totals and historical reconciliation gates run under the invoice/customer lock order. Replay occurs before mutable history checks, after authentication/capability checks. A later cross-tab authentication review found a blocking missing-actor boundary. The real browser reproduced it before the fix: a lost committed response for synthetic administrator 11, followed by a shared-cookie login as administrator 12, allowed stale-tab retry to return 201; a database assertion found two invoices for that synthetic product under actors 11 and 12. Original-actor metadata/header binding and `requireFinancialActor` now close the gap. Independent inspection verified the bounded positive header check and route placement after authentication, before validation/idempotency. The final browser case proves rejection under B, preservation of the original request, and recovery under A without duplication. The backend specialist's integration evidence remains separately owned; this document only claims the frontend browser evidence run here.

## CI payment action accessibility follow-up

Remote CI run `37908823765` on `ca8696b54db87bbc583c9f778374c0ef96b2f028` passed the four baseline browser cases and eight financial cases, but timed out waiting for the exact `Done` button in the payment recovery case. Its authoritative receipt, 9.70 balance, identical original/retry request, and single-payment database assertions had already passed.

Three local diagnostic runs on the unchanged build captured the completed dialog's accessibility snapshot as `button "loading Done"`, containing `img "loading"`. Their exact Done clicks eventually succeeded locally; the original 12-second CI stall was not reproduced naturally. Installed Ant Design code renders the loading icon with `role="img" aria-label="loading"` and leaves it mounted during its CSS exit transition, so it contributes to the button's accessible name. The receipt does not trigger invoice refresh until Done is clicked; early parent unmounting was ruled out. One diagnostic run also exposed context teardown racing that deliberate invoice refresh.

The deterministic regression holds delivery of the actual successful replay response while the spinner is visible. Before the repair, it failed with expected accessible name `Retry original payment`, received `loading Retry original payment`. The application fix explicitly names the Modal confirmation button with its current action label and exposes `aria-busy`; its disabled/loading logic and payment mutation lifecycle are unchanged. This removes the spinner's contribution to both retry and Done action names without depending on exit-transition timing. The browser test retains the exact Done locator and all payment/balance assertions, verifies disabled/busy state while the real response is held, and then verifies the refreshed invoice's 9.70 remaining balance, 0.30 paid amount, and one payment-history row before teardown. No timeout was increased and no response content or financial effect was mocked.

After the repair, the targeted payment journey passed five consecutive processes. The production build, lint, 12 unit/auth checks, all nine financial browser journeys, and all four baseline browser checks passed. All Node and browser loopback boundaries remained active, with zero external/WebSocket attempts. The temporary diagnostic test and CSS experiment were removed. Local red/green logs are `/private/tmp/hardware-phase2-payment-accessibility-red.log` and `/private/tmp/hardware-phase2-payment-accessibility-green.log`. A new remote CI run is still required; these post-fix results are local evidence.

## Limits

The saved intent is browser-origin storage. Clearing browser data or changing devices removes that recovery copy; operators must look up the original financial record before entering a replacement. Supported secure browsers need Web Locks and BigInt. No live production data, external business service, deployed environment, Docker execution is claimed here. The remote CI result above is reported separately from the local verification runs. The Phase 1 browser isolation incident remains documented in `FRONTEND-EVIDENCE.md`; Phase 2 runs installed both Node and browser network boundaries before application use.
