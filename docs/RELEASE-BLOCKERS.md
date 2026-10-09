# Release blockers

Updated for Phase 4 on 2026-10-09. **Production release is BLOCKED.** Local settlement implementation and synthetic verification do not authorize deployment, historical repair or live credential actions. See `PHASE-4-REPORT.md`, `PHASE-4-TEST-EVIDENCE.md` and the preserved Phase 3 reports for scope, source identities and commands.

## Original financial invariants

The complete real-PostgreSQL/HTTP suite remains in `backend/tests/release-blockers/financial.test.js`. Frozen Phase 1: **2/11 pass**; Phase 2/Phase 3 starting source: **8/11 pass**; final Phase 3: **11/11 pass, zero skips**. Authentication, original-line IDs and required operation headers reach the intended financial validation. Fixture changes and valid controls are documented; no failed invariant was relabeled or inverted.

| Test / phase | Final local evidence |
|---|---|
| FIN-01 / Phase 2 | Server-derived base quantity; forged quantity cannot under-deduct stock |
| FIN-02 / Phase 2 | Purchase-cost snapshot comes from server evidence |
| FIN-03 / Phase 2 | Excessive discount rejects atomically |
| FIN-04 / Phase 2 | Registered Quick Bills post receivables; anonymous debt rejected |
| FIN-05 / Phase 2 | Concrete tender splits reconcile exactly to paid amount |
| FIN-06 / Phase 3 | Duplicate original return lines reject before over-return/effects |
| FIN-07 / Phase 3 | Return product must match original invoice item |
| FIN-08 / Phase 3 | Supplier return requires original purchase item and original quantity/cost; wrong product/value assertions reject even with valid source ID |
| FIN-09 / Phase 2 | Durable same-key replay creates one invoice |
| Existing negative-stock / append-only checks | PASS; restricted-role protections retained |

The suite is not exhaustive. Phase 3 also passed 193 backend, 40 frontend unit/auth and 33 browser tests. Ambiguous legacy financial/stock records are explicitly blocked pending investigation. Local read-only diagnostics contain known malformed synthetic fixtures; they are not a clean historical-data certificate.

## Unresolved mandatory release gates

| Gate / owner | Current status and required evidence |
|---|---|
| Application-image and Compose runtime / engineering + operator | **BLOCKED:** Docker CLI unavailable locally. Prior user-reported starting-commit CI run 37911403467 built images; it does not prove execution. Run current immutable API/web images, migration/restricted-role startup, loopback/private networking, health and containment/recovery checks in an authorized disposable environment. |
| Current remote CI / engineering | **PENDING current candidate:** final commit/push is authorized, but local workflow changes and earlier-commit runs do not prove a passing current remote run. Preserve independent engineering, financial and historical-secret gates. |
| Historical secrets / operator | **FAIL:** redacted local history scan still finds historical GitHub PAT and JWT disclosures. Revoke/rotate affected credentials/passwords and invalidate sessions as appropriate; inspect provider access events. Deletion or a clean current-source scan is not proof of rotation. No live rotation/history rewrite is authorized here. |
| Live HTTPS, DB TLS, proxy and private networking / operator | **UNVERIFIED:** verify real CA/hostname, redirect/cookies, trusted proxy subnet, API/DB/Redis exposure and actual application grants. Synthetic/native prior evidence is not live evidence. |
| Backup, restore and historical-schema adoption / operator | **UNVERIFIED:** synthetic forward upgrades passed, not a production backup/restore or live-schema adoption. Take an authorized backup, restore/reconcile a copy and review any journal adoption; never guess migration history. |
| Historical financial reconciliation / business + operator | **UNVERIFIED:** null/contradictory snapshots, unlinked returns, stock gaps or stale counters require evidence and a separately approved repair plan. No issued records, ledgers or caches were rewritten. |
| Release governance / operator | **UNVERIFIED:** protected branches/checks, artifact provenance and explicit release approval must be configured. Use one immutable revision for API/web. Push-triggered deployment remains disabled. |
| Dependency advisories / engineering | Prior reachability/audit findings remain recorded in Phase 1 evidence. Guarded offline clean installs verify lock reproducibility, not a new remote advisory audit or zero vulnerabilities. |

## Remaining product/document boundaries

| Boundary / phase | Status |
|---|---|
| Customer/anonymous settlement / Phase 4 | Implemented admin-only source-linked advances, allocations, refunds and full explicit later-period reversals; operator-confirmed local records, never provider-verified execution. Unsupported/unknown historical evidence remains blocked. |
| Supplier settlement / Phase 4 | Implemented explicit payable recognition, debit application, recorded supplier payment/refund and full reversals. Receipt alone is not a payable; no guessed historical obligations. |
| Statements and day close / Phase 4 | Implemented dated source availability, statements/aging, concrete-tender reporting, safe exports and immutable opening/close evidence. Accountant acceptance and real cash procedures remain pending. |
| Damaged/quarantine returns, extended stocktakes/multiple locations, costing redesign | Unsupported; require explicit business design. Current returns are sellable only, stock is fungible and current cost remains last-posted receipt. |
| PDFs/report rendering and supplier attachments / future document phase | Disabled. Require isolated renderer, denied network/JavaScript, resource bounds and safe attachment lifecycle before reviewed reactivation. Printing is not a prerequisite bypass. |
| Cashier billing / separately reviewed rollout | Disabled; only allowlisted catalog read remains. No permission broadening or cost disclosure is authorized. |
| Accountant/statutory acceptance | Operational financial policy, source eligibility, period/reversal rules and tax interpretation need real accountant/business acceptance. Tests are not certification. |
| Report performance | Full evidence verification can be slow on accumulated fixtures. Verify realistic synthetic-volume performance before operational rollout. |

Read-only diagnostics include `db/reconciliation/phase-4.sql`; earlier scripts remain historical phase diagnostics. The final clean supported scenario and deliberate corruption database are separate. Preserve the unresolved Phase 3 baseline 82/84 concurrency result and Phase 4 inherited-browser baseline 32/33 metadata timeout; later passing runs are not root-cause proof. Stop at Phase 4; `PHASE-5-HANDOFF.md` does not authorize Phase 5 or deployment.

## Phase 4 recovery reliability gate

**BLOCKED:** `Phase4 supplier_refund_reversal lost commit, reload and account-switch recovery preserve original actor/key/payload` timed out on the second exact retry control after wrong-actor409 in `/private/tmp/phase4-all-browser-verified.log` (then `phase4-browser.test.js:270`). That occurrence lacks failure-time DOM; focused reruns passed and do not prove its cause. Stable action labels improve accessibility but are not evidence of the historical cause. Preserve original operation/source/target/actor/key and response diagnostics in future failing runs; do not add broad retries or waive the failure. No duplicate posting was observed.

A separate customer-advance wrong-actor response wait timed out in `/private/tmp/phase4-all-browser-complete.log`. Observing its click and response promise together fixed an unhandled-rejection path, and guarded-handler teardown was repaired, but neither proves the original response timeout cause. Both recovery failures remain open even though the subsequent complete selector-corrected suite passed 59/59 on a fresh database. Failure-only request/actor/key/source/target/response/DOM diagnostics are retained for a future recurrence.

The inherited product-edit timeout later recurred with a visually disappearing but still accessible loading icon changing the exact button name; a stable product action label addresses that demonstrated case. Original baseline logs and separate unexplained Phase3 database concurrency failures remain retained.
