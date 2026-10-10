# Phase5B delivery report — 2026-10-10

Current scope: safe synthetic document delivery plus actionable5A Linux verification. Production release remains BLOCKED. The user changed development sequencing and explicitly authorized reviewed checkpoint commits/normal pushes only to origin/codex/phase-1-security-baseline; no merge, deployment, production activation or Phase5C implementation.

## Preserved candidate

Isolated worktree `/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp`; starting HEAD `aebf06579d5c577ecde0837de7fe68ef59b675cf`, full tree `9bc576c4fc784ea57642496bd170abc559982808`. It exactly matched the prior stabilization delivery. Previously tested executable tree `4d5ddbb51523cd2dba883177faee3e2a9b3399c9` was not substituted for current evidence. Full350-file snapshot, real-index SHA256 and recovery refs were preserved under `/private/tmp/hardware-phase5b-start-_lnw10p3`; original checkout and recovery refs were untouched. No model/effort change is claimed.

## Working supported slice

New admin-only document requests/status/download/retry and gated invoice/payment/customer UI support frozen issued sale, sales-credit, receipt and as-of statement records. A4 and80mm paginated thermal layouts work for sale/receipt. PostgreSQL source/job/request evidence, original-key recovery, leased/fenced workers, explicit bounded retries and private content-verified storage are integrated. Rendering receives no DB/session secrets and runs outside API/financial posting. Statements label MVCC snapshot timing truthfully; reprints preserve issued seller/party/item facts and do not recalculate money.

Migration022 adds the document model and least-privilege roles/helpers. Independent review found a temporary-table search-path weakness; reproduced before-fix tests led to forward023.022 bytes were preserved. Other reviewed repairs align DTO/renderer limits, clarify statement timing and fix initial/repeated table-header page boundaries. No financial policy, costing, cashier permissions, old issued rows or saved financial responses were changed.

PDFKit0.17.2/fontkit2.0.4 and an OFL font are locked/licensed. Native macOS default-deny sandbox, scrubbed environment and bounds have actual execution proof; Linux container proof is measured separately for the published candidate. Actual extracted PDFs and rendered PNGs cover Hindi/₹, negative/zero money, long text, multipage layout and thermal sizes. Unsupported glyphs and missing historical facts fail visibly. A screen-rendered PDF is not printer/accountant approval.

## Review and evidence

Three implementation specialists had non-overlapping backend, renderer/storage and frontend/test ownership. Coordinator owned contracts, migrations, hooks, role integration and CI. A separate read-only reviewer found four issues; all were repaired and statically rechecked with no remaining blocking source finding. Reviewer ran no tests; execution evidence belongs to the recorded runners. See PHASE-5B-TEST-EVIDENCE for exact before/after failures, counts, commands, source identity and candidate-specific Linux jobs.

The first reviewed stabilization checkpoint `102e69e1586d83097336519ceb14dae02028c7cc` was pushed normally. Linux run38065575058 attempt1 passed local engineering and original11 invariants; the historical-secret job failed with2 findings. That run proves stabilization only, not subsequent document bytes. Final verification/publication identities are recorded in the test/change manifests and final session result.

## Residual limits and recovery

Only NODE_ENV=test + explicit synthetic-local mode enables rebuilt documents. Production, legacy PDF/report paths, supplier attachments, cloud drivers and cashier billing remain disabled. Purchase/debit/refund/settlement/day-close/estimate/report PDFs are deferred. Native OS proof is not a cgroup total-memory guarantee; Linux container proof is distinct. Backend/frontend retain2 moderate advisories each; renderer has0 current findings, with jpeg-exif/crypto-js deprecation warnings retained.

Preserve immutable source/job/request evidence, source hashes and successful financial results. Restore missing storage/worker capability, retry the original document operation and require identical bytes. Exhausted retries, missing historical facts or hash mismatch require a reviewed forward fix. Never repost a financial transaction for a missing PDF, delete history, repair old snapshots from current settings or revert to insecure auth/rendering paths.

Historical incidents and the two newly observed inherited empty-response failures remain UNKNOWN and need owner disposition. Their preserved logs and bounded diagnostic reruns are in INCIDENT-REGISTER; later green results do not establish root cause. Both credential disclosures and live TLS/networking/IAM/grants, backup/restore, API/web runtime, physical printing, accountant/operator and release-governance gates remain pending. No deployment, global account change, privileged host install, real financial action or external API investigation occurred. Stop here; PHASE-5C-HANDOFF records next authorized-work prerequisites.

## Current checkpoint status before Linux publication

A. Native engineering aggregate **FAIL**:233/234 inheritedfinancial and one unexplained pre-invariant purchasefixture401. Other native gates pass:23documentbackend,11originalinvariants,101frontend,68browsers,10renderer/runtime,7outputfixtures, TLS/nginx, lint/build and currentsecret scan.

B. Historical and newly unexplained response incidents: **PENDING owner disposition**; failures retained.

C. Phase5B supported synthetic-local slice: **PASS native implementation tests**, Linux isolated runtime **PENDING exact-SHA run**.

D. Supplierattachments, otherdocumenttypes, cashier rollout and Phase5C: **DEFERRED/DISABLED**.

E. Historicalcredentials, realinfrastructure/APIwebCompose runtime, backuprestore, physicalprinter/accountant/operator acceptance: **PENDING/BLOCKED**.

F. Overallproductionrelease: **BLOCKED**. Reviewed branch publication is for verification only.
