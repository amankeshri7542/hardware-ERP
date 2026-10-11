# Phase5B measured evidence — 2026-10-10

## Latest verification checkpoint — fixed-date fixture repair

Latest full native matrix: **FAIL**, solely the preserved UNKNOWN non-JSON payment response (263 backend passed, 1 failed; 23 document backend tests not reached). The owned date-boundary fixture PASSED. Original 11 invariants, 101 frontend unit/auth, all 68 browsers, 10 renderer/runtime tests, 7 actual output fixtures, lint/syntax/build, isolation/evidence controls and TLS/nginx PASSED. Earlier complete 287-backend PASS remains historical evidence, not the latest aggregate. Tested tree `dd8c8633cff496cbe93ddb9de0d3efabebf00475`, executable manifest `d5d2755657caad479e715a136985c8297c7bfdfffd08818ca0f178ead0b145b6`.

Linux run 38108179822 at `e6bb7170fb31b62ddd20dc6b1b2c50973b1c4c77`: original invariants PASS; engineering FAIL on the diagnosed fixed-date fixture, before browser execution. Its actual Docker renderer/storage tests passed. The next reviewed checkpoint contains only that fixture repair and documentation. Exact follow-up Linux result is recorded below when available. Historical credential/incident, live infrastructure, backup/restore, physical printer, accountant/operator gates remain unresolved. Production **BLOCKED**. Stop after 5B; no attachments or cashier rollout.


## Final native follow-up — 2026-10-11

The complete native matrix after the last executable change PASSED: 287 backend, 11 original financial invariants, 101 frontend unit/auth, 68 browsers (61 inherited plus 7 document), 10 renderer/runtime tests and 7 actual PDF output fixtures. Lint, syntax, build, cash-fixture isolation, failure-artifact controls, TLS and nginx checks all exited 0. Exact commands, exit statuses and logs: `/private/tmp/hardware-phase5b-start-_lnw10p3/final-verification.json`.

Tested tree: `a045840759ce05a5bf6a3570294a662d50ad6314`; executable manifest SHA256: `01d9fbea48d5a782d9413972de3cb48bdb00b24fccfc19316042390c9e5801d6`. Subsequent edits in this follow-up are documentation only. This result supersedes the earlier native aggregate status, not the preserved failed-run evidence or UNKNOWN incident disposition. The test-only Linux repairs atomically inspect dropdown state and use the configured Asia/Kolkata browser timezone. Candidate-specific Linux follow-up remains pending publication. Production remains BLOCKED.


Evidence root `/private/tmp/hardware-phase5b-start-_lnw10p3`; raw logs/private synthetic credentials are not committed. Node24.21.0/npm11.17.0, macOS native PostgreSQL16 loopback, restricted application and dedicated document-worker roles. All Node application/test/build commands preload the local-only network guard; browsers block external navigation/redirects/sockets/service workers before navigation. Tooling retrieval is separate. No live dotenv.

## Source and baseline

Starting full tree9bc576c4fc784ea57642496bd170abc559982808; HEADaebf06579d5c577ecde0837de7fe68ef59b675cf. Stabilization commit102e69e1586d83097336519ceb14dae02028c7cc has actual Linux run38065575058 attempt1: job114252401971 engineeringSUCCESS, job114252401818 original11SUCCESS, job114252401986 historyFAIL2. Engineering measured264backend,11independentfinancial,88frontend,61browsers,1cashisolation,1failureartifact,1TLS,1nginx; exact image builds/current scan passed. Sanitized artifact11674158317 SHA2562897c0279c1066140929cfef95754639315a8cd4b88709656f6bd957bc09e2e7. This verifies stabilization, not later document code.

Final native executable verification tree`eaaacbcd384faa54b34f994a1a71c3d944ce33f0`, executable manifest SHA256`b5525cdb1869b8aa834d5f549844e64b9a65d9a911feebbd731f66ced88d2058`. Source hashes are in tested-final-keyboard-manifest.json; build hashes in final-build-manifest.json. Subsequent evidence/report edits are documentation-only. The final immutable published commit/tree and its Linux jobs are recorded below or in the final session outcome; no earlier SHA is substituted.

## Commands

Clean locked `npm ci --prefix backend`, frontend and renderer passed; current npm audit JSON retained. Backend and frontend each2moderate/0high/0critical; renderer0. Existing ExcelJS/uuid and ReactRouter advisories remain visible. Renderer deprecated jpeg-exif/crypto-js warnings retained.

Full guarded native runner `/private/tmp/phase5b-verify.py` runs these exact commands with generated synthetic environment and separate clean/corrupt books:

```sh
npm run lint --prefix backend
npm run check:syntax --prefix backend
npm run lint --prefix frontend
npm test --prefix backend
npm run test:release-blockers --prefix backend
node scripts/run-local-tests.cjs --test scripts/test-cash-fixture-isolation.cjs
npm run test:auth --prefix frontend
npm run test:financial --prefix frontend
NODE_ENV=production VITE_API_URL=/api npm run build --prefix frontend
node scripts/run-local-tests.cjs --test scripts/test-browser-evidence.cjs
npm run test:browser-all --prefix frontend
DOCUMENT_RUNTIME_MODE=synthetic-local DOCUMENT_SAMPLE_DIR=<owned-directory> node --test scripts/test-document-runtime.cjs renderer/tests/render.test.cjs
python3 scripts/test-document-runtime-output.py <owned-directory> --tools-dir <bundled-Poppler-bin>
sh scripts/test-db-tls.sh
node scripts/run-local-tests.cjs --test scripts/test-nginx.js
```

Native nginx uses the already installed private test binary; TLS starts/stops its own disposable cluster. No privileged host install. There is no TypeScript checker configured; JS syntax, ESLint and Vite build are the actual repository gates. API startup/real HTTP and private-worker CLI are exercised by integration/browser tests.

## Before/after and review

- Missing-feature backend/frontend tests failed before modules/tables existed. Final document backend suite covers23desired cases, frontend13unit and7browser journeys.
- Backend fixtures initially used noncanonical /var temp path and an app-only lock observer for worker waits; guards were preserved and fixtures corrected. Logs retained.
- DTO/seller limits and oversized envelope tests preserve financial commit but block unrenderable source; no issued facts truncated.
- Restricted-role temp-table regression reproduced2shadow trigger effects under022; forward023 yields0 and updates only the real jobs.022 bytes unchanged. Fresh/populated migration tests preserve historical rows and successful idempotency results with no seller backfill, plus repeat/failure/cancel/concurrent-runner controls.
- Real private storage followed by injected metadata failure leaves no downloadable partial metadata; same-source retry recovers and original payment response/effects remain unchanged. That test uses synthetic PDF-shaped bytes through real file storage; actual rendering is independently tested.
- Actual worker process SIGKILL after isolated rendering reaches publication barrier, then explicit synthetic lease expiry and second actualworker produces one ready PDF, same financial source/effects. It does not wait90seconds in real time.
- Real concurrent statement postings before/after the first repeatable-read query prove MVCC visibility and the truthful transaction-start label.
- Renderer boundary fixture failed with duplicate headers/overheight acceptance before repair; actual beforePDF had2headers, afterPDF1.10renderer/runtime tests and7actualoutput fixtures validate OSdenials, no secrets, cancellation, deterministic bytes, private hashes, Hindi/₹, exactsignedmoney, thermal/A4 and pagination. Coordinator and specialist visually inspected synthetic PNGs; no physical printer.
- Independent read-only reviewer found search-path privilege issue, DTO field mismatch, false cutoff label and header duplication; all repaired and statically rechecked. Reviewer ran no tests.
- Integratedrun1 atf05ba97: backend287PASS/invariants11PASS/frontend101PASS, inheritedbrowsers61PASS then7documentfixtureFAIL due to intentionalPhase4closedbook. Separate freshdocumentrunner fixedfixtureisolation without reopeningperiods.
- Integratedrun2 at5eabc180: inheritedbackend232/234 with2unexpectedemptyHTTPresponses; newdocbrowsers4/7 with3diagnosedtesttimingfailures. Oldlogs remain in before-document-browser-review. Testtimingrepairs await durable dismissal/DBbackoff eligibility. Two backend responses remain UNKNOWN; bounded2-test rerun passed, not a rootcause. See INCIDENT-REGISTER.

Complete current-candidate scan includes untracked source via temporaryindex:0findings. Separate all-history scan:2findings (PAT/JWT); no bytes or credential snippets published. Historical gate remainsFAIL.

## Limits

No local Docker/Podman is installed; Linux reviewed CI executes the actual isolated renderer image, not merely a build, and downloads real browser PDFs. API/web image build is not application-image/Compose runtime acceptance. No cloud storage/IAM, attachments, cashier rollout, physicalprinter, accountant/statutory acceptance, livecredentialrotation, productionbackup/restore or deployment proof. Historical and newly unexplained incident disposition remains pending even if final current suites pass.

## Latest native inherited failure retained

At the final executable identity above, environment5/security12/containment13 passed and inheritedfinancial233/234 passed. The purchase-stock test failed before its invariant on an unexplained401 authentication-shaped fixture response. The chained document suite was therefore run independently, not falsely counted as part of a passing npmtest. See INCIDENT-REGISTER. This final native aggregate result remainsFAIL even if exact-source Linux succeeds. No retry-to-green or external API investigation was performed.

## Final native measured results

Frozen executable tree eaaacbcd384faa54b34f994a1a71c3d944ce33f0; no executable changes during run. All15commands completed; aggregate exit1 solely from the inherited purchase fixture anomaly. No skipped tests in executed suites.

| Check | Final result |
|---|---|
| Backend lint, syntax; frontend lint; production build | PASS |
| Backend environment/security/containment |5+12+13 PASS |
| Inherited financial |233/234 PASS;1 unexplainedfixture401FAIL |
| Independent document backend |23/23 PASS (separate command after chainedstop) |
| Originalfinancialinvariants |11/11 PASS |
| Frontendauth/unit |4+97 PASS (includes13newrecovery) |
| Browser |61inherited+7documents PASS, separatemigrated/grantedbooks |
| Cashclean/corruptisolation; sanitizedfailureartifact |1+1 PASS |
| Actualnativerenderer/privateartifact/isolation |10/10 PASS |
| ActualPDFoutput |7fixtures PASS (text, pages, Unicode, signedmoney, PNGs) |
| RealDBTLS; nginxSPA/securityheaders |1+1 PASS |

Raw exact commands, OS/runtime, durations/exit codes: final-verification.json and final-documents-independent.json. The native aggregate isFAIL, not rewritten toPASS by independent successes. Candidate-specific Linux proof follows the reviewed publication; until jobs complete its status isPENDING.

## Published Phase5B Linux attempt1 — measured failure

Commit `e1ead278a760c999f6559ac3715e79cf61e7e4d5`, tree `26e57c9acb842ce13ce7c95030259a49afb60b70`, run [38075648509](https://github.com/amankeshri7542/hardware-ERP/actions/runs/38075648509), attempt1.

| Job | Result |
|---|---|
|114281937082 — original invariants |SUCCESS,11/11 |
|114281937120 — local-gates |FAIL at inherited browser57/61; preceding287backend,101frontend,10Docker renderer/runtime and fixture controls passed |
|114281937436 — historical credentials |FAIL,2findings |

Skipped downstream steps: native TLS/nginx, PDF text/PNG verification, audit, current scanner, API/web image builds. New7documentbrowser suite was not reached because the inherited command failed. No claim of whole Linux acceptance.

Sanitized browser artifact11678605406 SHA256`5d6ad5fcf0651ffb78faad5a791e9436132243ace46a3279e7331569e22af529`; synthetic PDF artifact11677719841 SHA256`fa7ff88bcd62699125e86fc4d87eb8488e583bdc04e61dfcb18b8ff96d33a10d`. Collector verifies no raw traceZIP and no credential canary. Private logs retained; public record contains sanitized metadata only.

Follow-up fixes are test-only: atomic popup-state reads and configured shop timezone; all4affected cases pass locally. Full verification source is `a045840759ce05a5bf6a3570294a662d50ad6314`, executable-manifest SHA256`01d9fbea48d5a782d9413972de3cb48bdb00b24fccfc19316042390c9e5801d6`. Evidence filename tested-linux-fixes-manifest.json. Prior source identities and failed outcomes above remain chronological evidence.

## Linux fixed-date fixture failure — 2026-10-11

Exact commit `e6bb7170fb31b62ddd20dc6b1b2c50973b1c4c77`, run 38108179822 attempt 1: independent original 11 invariants PASS; engineering FAIL in inherited backend tests (233/234). The dashboard shop-day boundary test expected real tender rows in October 1–9 but created none of its own. Its incidental current-date receipts were outside that fixed range on the fresh Linux database. The failed assertion was `The boundary assertion must inspect actual tender rows`, not an authentication or financial reconciliation failure. Native fixture-rich results had not exposed that dependency.

Narrow repair creates a valid restricted-role payment dated October 8 before mocking the clock, retaining nonempty tender and exact shop-date assertions. No application code or financial policy changed. Full native rerun and exact-commit Linux follow-up are required. This diagnosis does not explain any older UNKNOWN response/concurrency incident. Original failure logs/artifacts are preserved under the `linux-fixes-` evidence prefix.

## Latest native anomaly — fixed-date follow-up

At tested tree `dd8c8633cff496cbe93ddb9de0d3efabebf00475` (executable manifest `d5d2755657caad479e715a136985c8297c7bfdfffd08818ca0f178ead0b145b6`), the repaired date-boundary test passed. The complete backend command instead failed an unrelated inherited test: `normalized numeric strings and object ordering replay; changed amount or reference conflicts`. Diagnostics recorded POST /payments, HTTP 400, no allowlisted headers, 48 non-JSON response bytes, complete response, SHA256 `7a1fabf227903297428f36da3b3547d91e308a992063271e8fe1a4f1e1e6cd26`, key `2e7082d7-f5c3-4c60-9542-ea60b7d9a5bc`, actor 142. Inherited financial tests: 233/234. Document backend tests were not reached by this fail-fast command.

Attribution remains UNKNOWN. No speculative application change, old external API call or repeated green-until-pass rerun was used. The earlier complete native PASS is preserved under `before-fixed-date-fixture`; it is not the latest aggregate result. Owner disposition remains required.
