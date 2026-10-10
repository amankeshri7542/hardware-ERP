# Phase5B measured evidence — 2026-10-10

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
