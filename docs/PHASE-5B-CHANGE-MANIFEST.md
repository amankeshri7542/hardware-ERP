# Phase5B change manifest

Compare against the preserved complete starting candidate, not only HEAD. Starting HEAD aebf06579d5c577ecde0837de7fe68ef59b675cf; starting full tree9bc576c4fc784ea57642496bd170abc559982808. Recovery refs were retained, original checkout untouched, temporary indices used until reviewed publication.

Stabilization checkpoint102e69e1586d83097336519ceb14dae02028c7cc tree76695e033e6ee7ba485196e86fed04db2a7a0cb8 was separately reviewed/scanned/pushed. Its exact Linux run is reported separately from Phase5B.

Final native verification begins at tree`eaaacbcd384faa54b34f994a1a71c3d944ce33f0`; executable manifest SHA256`b5525cdb1869b8aa834d5f549844e64b9a65d9a911feebbd731f66ced88d2058`. Source390-file hashes and build hashes are saved privately under /private/tmp/hardware-phase5b-start-_lnw10p3. Subsequent report/manifest edits are documentation-only; final publication tree/commit is recorded by the publication evidence and session result, avoiding a self-referential tree hash inside its own file.

New forward migrations only:

-022_document_delivery.sql: immutable source/request evidence, job lifecycle/publication identity, helper functions.
-023_document_function_search_path.sql: reviewed forward security repair explicitly orders pg_temp last.022 was already applied and its bytes were preserved. No012 or historical migration edits.

Main integration: financial result capture before COMMIT without response/render waits; admin document routing; API/worker grant separation; worker CLI/private storage and isolated renderer; supported frontend panels and separate recovery; clean document browser book, full native/Linux gates and sanitized diagnostic evidence. New font/license/lock files are source; no node_modules, builds, generated samples, raw traces, databases, dotenv or private environment enter Git.

Complete starting-to-tested-source change list (later report-only additions follow):

```text
M	.github/workflows/phase-1.yml
M	CLAUDE.md
A	backend/document-worker.js
M	backend/package.json
M	backend/src/app.js
M	backend/src/middleware/authorize.js
A	backend/src/modules/documents/artifacts.js
A	backend/src/modules/documents/config.js
A	backend/src/modules/documents/documentDto.js
A	backend/src/modules/documents/documents.router.js
A	backend/src/modules/documents/documents.service.js
A	backend/src/modules/documents/jobs.js
A	backend/src/modules/documents/renderProcess.js
M	backend/src/utils/idempotency.js
M	backend/tests/environment/migrations.test.js
M	backend/tests/helpers/disposableDatabase.js
M	backend/tests/helpers/financial.js
M	backend/tests/phase4/reporting.test.js
A	backend/tests/phase5b/documents.test.js
A	backend/tests/phase5b/lifecycle.test.js
A	backend/tests/phase5b/worker-death.test.js
A	db/document-worker-grants.sql
M	db/grants.sql
A	db/migrations/022_document_delivery.sql
A	db/migrations/023_document_function_search_path.sql
M	docs/DOCUMENT-DELIVERY-CONTRACT.md
M	docs/DOCUMENT-RENDERER-DECISION.md
A	docs/INCIDENT-REGISTER.md
M	docs/LOCAL-DEVELOPMENT.md
M	docs/PHASE-5-HANDOFF.md
A	docs/PHASE-5B-CHANGE-MANIFEST.md
A	docs/PHASE-5B-PLAN.md
A	docs/PHASE-5B-REPORT.md
A	docs/PHASE-5B-TEST-EVIDENCE.md
A	docs/PHASE-5C-HANDOFF.md
M	docs/RELEASE-BLOCKERS.md
M	docs/SECURITY-RUNBOOK.md
M	frontend/package.json
A	frontend/src/api/documents.api.js
M	frontend/src/components/AppLayout.jsx
A	frontend/src/components/Documents/DocumentsPanel.jsx
A	frontend/src/components/Documents/documentIntent.js
M	frontend/src/pages/Customers/CustomerDetailPage.jsx
M	frontend/src/pages/Invoices/InvoiceDetailPage.jsx
M	frontend/src/pages/Payments/PaymentsPage.jsx
M	frontend/tests/helpers/browserEvidence.js
M	frontend/tests/phase4-browser.test.js
A	frontend/tests/phase5b-browser.test.js
A	frontend/tests/phase5b.test.js
A	renderer/DEPENDENCY-LICENSES.json
A	renderer/Dockerfile
A	renderer/README.md
A	renderer/cli.cjs
A	renderer/fonts/NotoSansDevanagari.ttf
A	renderer/fonts/OFL.txt
A	renderer/fonts/README.md
A	renderer/isolation-probe.cjs
A	renderer/package-lock.json
A	renderer/package.json
A	renderer/render.cjs
A	renderer/tests/fixture.cjs
A	renderer/tests/render.test.cjs
A	scripts/test-document-runtime-output.py
A	scripts/test-document-runtime.cjs
```

Later documentation-only additions: PHASE-5B-TEST-EVIDENCE.md and this manifest; updated measured outcomes in PHASE-5B-REPORT, INCIDENT-REGISTER and RELEASE-BLOCKERS. Recompute temporary-index source manifest and complete candidate scan before each reviewed publication.
