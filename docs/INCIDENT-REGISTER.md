# Recovery/concurrency incident register

Updated2026-10-10. Open incidents do not prohibit independent local5B development under current authorization. They still block owner acceptance/production; no retrospective root cause is invented. Owner: engineering investigates; product/operator explicitly decides release risk. No self-issued waiver.

| Incident / original evidence | Missing evidence / possible invariant | Current reproducer and instrumentation | Observations / residual status |
|---|---|---|---|
| Customer advance wrong-actor response wait, /private/tmp/phase4-all-browser-complete.log | Original failure-time DOM, precise route/response/control state. Could leave committed advance visibly unresolved or invite unsafe repeat | One bounded original commit/lost201 → reload → wrong actor delayed409 → switchback → retry/cancel → two tabs schedule. Exact path/key/actor waits, saved intents, effect/idempotency rows, correlations, DOM and lock diagnostics | Promise observation and route drain repaired separate defects. Controlled schedule passed in native full61; historical attribution UNKNOWN. One green run cannot prove old cause |
| Supplier refund reversal second retry, /private/tmp/phase4-all-browser-verified.log, prior phase4-browser.test.js270 | No failure-time DOM/button state. Possible inability to recover already-recorded cash reversal; no duplicate observed | Same controlled schedule on supplier_refund_reversal; assert original tender reversal, key/actor/payload and exactly one durable result/effect | Stable labels and schedule fixes tested; historical attribution UNKNOWN. Current one-effect proof is not a retrospective explanation |
| Phase3 baseline PostgreSQL concurrency82/84, retained Phase3 reports/evidence | Incomplete original blocking graph/response correlation; precise failures must remain in historical evidence, not guessed from later tests | Existing real PG lock-waiter concurrent sale/return/receipt/customer tests in full backend; source IDs/response codes and first failure logs retained | Later193/264 backend passes do not explain baseline; financial concurrency risk remains owner-pending UNKNOWN |
| Inherited metadata browser32/33, Phase4 baseline evidence | Original occurrence lacks enough state to equate it with later occurrence | Existing Phase3 metadata optimistic-concurrency/recovery journey, stable exact controls and captured DOM/network on failure | A later loading-icon accessible-name defect was separately demonstrated/fixed. It is not proof of original timeout cause; UNKNOWN attribution |

## Separately demonstrated later defects

CI run37937154546 at aebf0657: Phase4 browsers23/26. Two422 CASH_RECONCILIATION_REQUIRED cases share a book with intentionally malformed backend tender fixtures; separately migrated clean browser books solve contamination without weakening whole-book proof. CSV ENOENT arose from macOS-specific /private/tmp destination; owned platform-temp download paths replace it. Native reproduced fixture IDs/provenance remain in PHASE-5-TEST-EVIDENCE.md and are not original CI row IDs.

New controlled two-tab test initially failed0/2 (recovery-schedules.log): first replay completed and removed second Retry button before Playwright dispatched its click. Captured both tabs completed, one idempotency result and one effect. Holding actual201 until both clicks enter the schedule repaired this test race;2/2 and final61 passed. This does not resolve either older recovery incident.

Diagnostic self-check development failures (nested Node test context, fixture Content-Type, trace class/method shape), database-control provisioning order, and authored documentation scanner false positive are retained separately in prior evidence. They are harness/prose defects, not accounting root causes.

## Declared verification matrix and disposition

Run each original61 journey once per final full native/Linux suite plus the two existing controlled schedules (already in61). Do not loop until green. Those schedules exercise commit-before-response-loss, original-key reload, wrong actor, delayed rejection while switching back, committed-response cancellation and simultaneous tabs, with one durable effect and UI completion assertions. Full backend uses actual competing PostgreSQL transactions and restricted grants. Capture every failure before teardown; private raw trace is reduced to sanitized evidence.

If a current run demonstrates duplicate posting, incorrect authorization, financial inconsistency or unsafe source reads, stop document reliance on that path and fix the reproduced issue. If it passes, record exact source/OS/run and keep historical attribution UNKNOWN. Native and Linux current results belong in the Phase5B report; acceptance of residual historical risk requires an explicit owner decision. No decision has been supplied.

## Separately diagnosed Phase5B integration fixture failure

First complete native candidate `f05ba97f9b24be47a55f17268bf0ea08527e3026`:61 inherited browsers passed, then7 new document scenarios failed fixture stock setup with FINANCIAL_PERIOD_CLOSED. Their runner shared the intentionally closed Phase4 book. Logs and sanitized first-failure artifacts are preserved under `before-browser-book-isolation` in the Phase5B private evidence root, with response/DB context. This occurred before the intended document business controls and is not financial repair evidence.

The executable test entrypoint now runs the unchanged61-scenario book and the7-scenario document book through separate invocations of the existing migrate/grant/guard runner. Closed periods were neither reopened nor bypassed; corrupt backend books remain separate. A complete new-source verification is recorded in PHASE-5B-TEST-EVIDENCE. This diagnosed fixture interaction does NOT explain or close any earlier recovery/concurrency incident.

## Phase5B inherited backend empty responses — attribution UNKNOWN

Complete run at `5eabc180d262b08f056cb5cd2b802da1694c66ad` produced232/234 inherited financial passes: `customer transaction rolls back every effect after injected invoices failure` observed HTTP200/body{} during advance fixture creation (expected201); `Phase4 global sales summary flags unverified unpaid invoice evidence even without cash movements` observed HTTP400/body{} on the report GET (expected200). The same application bytes passed234/234 in the preceding full run. The second run reused the accumulated synthetic parent database; that fact alone does not establish causality.

Original full log is preserved in `before-document-browser-review/final-backend.log`. Original assertions captured status/body but not content type/request ID/raw transport completion. No corresponding JSON application failure was observed. The normal payment path returns201 JSON; attribution to HTTP transport, fixture interference or application failure remains UNKNOWN. No business rule or assertion was weakened.

Sanitized non-JSON diagnostics now capture method/path, synthetic actor/key, status, allowlisted response headers/request ID, raw completion/ports and response length/hash (never body/cookies/secrets). A single bounded rerun of the two affected tests on the original database passed; this does not explain the failures. A separately migrated/granted parent is used for the final complete run while the original failure book remains intact. Current passing evidence, if obtained, does not waive owner disposition or resolve these events retrospectively.

Separately diagnosed document-browser tests navigated before asynchronous completed-intent dismissal and drained worker attempts before the new2-second backoff elapsed. Saved DOM/localStorage/DB evidence established those test-scheduling causes; fixes await durable dismissal and PostgreSQL claim eligibility, without fixed sleeps or force clicks. Affected3/3 passed. These are not explanations for the two backend anomalies or older incidents.

## Phase5B inherited dropdown schedule — diagnosed separately

Complete native run at fa06bfdf85eb576100b8904adb52c3a58d689f2e passed287backend but inheritedbrowsers59/61: customer_refund recovery and delayed-source-quote fixtures failed selecting UPI. Captured DOM/action traces show a dropdown opened near the viewport bottom; pointer scrolling was intercepted by CASH/Settlement reason form elements. No financial request was submitted at that failed selection.

The shared test select helper now uses accessible keyboard movement bounded by actual option count, verifies exact active option label, waits for each aria-activedescendant transition and confirms the final selection. An initial too-fast keyboard loop failed its exact-match assertion (preserved dropdown-affected.log); waiting for the observable React transition repaired that scheduling mistake. Both affected journeys then passed in dropdown-state-affected.log. No force-click, fixed sleep, financial policy or assertion relaxation. The full suite is rerun at eaaacbcd384faa54b34f994a1a71c3d944ce33f0; neither current success nor this diagnosis closes the older incidents.

## Phase5B inherited purchase authentication-shaped response — UNKNOWN

At final executable tree eaaacbcd384faa54b34f994a1a71c3d944ce33f0, the inherited234financial run passed233 and failed `Phase3 aggregate supplier return demand cannot exceed fungible product stock` during its valid purchase fixture. Expected201; observed401 with `{type:error,error:{type:authentication_error,message:Invalid authentication},request_id:null}`. This differs from the ERP's normal response envelope. It did not reach the stock invariant, so this is NOT evidence the financial invariant failed or passed. The complete native log is retained in final-backend.log.

The runtime started with local-only guard and synthetic environment; origin/attribution of this response is not established. No old external API contact or historical attribution claim is authorized. Do not guess a credential or proxy fix, weaken authentication, or repeat until green. Native aggregate gate remainsFAIL for this run. Independent document tests still run, and reviewed exact-source Linux results must be reported separately. Owner disposition of this new anomaly remains required alongside earlier incidents.
