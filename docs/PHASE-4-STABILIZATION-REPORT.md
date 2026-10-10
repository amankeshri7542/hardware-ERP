# Phase 4 stabilization — checkpoint 5A

2026-10-09. **5A remains BLOCKED.** Local harness repairs and native verification pass; required final-source Linux execution is unavailable and historical recovery/concurrency uncertainty remains unresolved. Phase 4 is not accepted and production is not approved. The latest attached request supersedes earlier commit/push permission: this delivery is local, unstaged and uncommitted.

## Preserved candidate

Worktree: `/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp`. Branch `codex/phase-1-security-baseline`; retained HEAD `aebf06579d5c577ecde0837de7fe68ef59b675cf`. Starting complete tree `4a7ed30e31c4b95e40e9135c5e2ab700645f02cc`, 336 files. The starting manifest and real-index/ref records are in `/private/tmp/hardware-phase5-start-4zbkw4fh`. The real index SHA256 is `b3bef8a460d24b7366e039ab77dd5800912606b089421e8e993d80b8d53341f8`. Temporary indexes include new source without staging the real index. No checkout switch, cleanup, stash, history rewrite, recovery-ref replacement or original-checkout edit was performed.

Tested application/test/configuration tree: `4d5ddbb51523cd2dba883177faee3e2a9b3399c9`. Later changes are documentation only. See `PHASE-5-CHANGE-MANIFEST.md` for identities and verification boundaries.

## Demonstrated repairs

Read-only inspection confirmed [run 37937154546](https://github.com/amankeshri7542/hardware-ERP/actions/runs/37937154546), job 113841973295, at the retained HEAD failed: Phase 4 browsers 23/26; two report requests returned `422 CASH_RECONCILIATION_REQUIRED`, and CSV save failed with Ubuntu `ENOENT` under `/private/tmp`. Later native TLS/nginx, scans and image builds did not run; the dependent release job was skipped.

The unchanged backend-to-browser sequence was reproduced on a new synthetic database. Backend passed 264/264. Its retained malformed receipts included header10/details4+4 and missing tender evidence, with provenance in `backend/tests/financial/payments.test.js` and `backend/tests/phase4/customer.test.js`. Native row IDs and provenance are documented in the evidence report; they are not asserted to be the original CI database IDs. The full native unchanged browser attempt repeatedly failed at Dashboard readiness and was interrupted after 452.367 seconds; it is neither a complete suite nor proof of a Dashboard root cause.

The browser runner now creates a separately migrated database, applies existing restricted grants, and preserves the parent database. It never repairs or filters malformed financial evidence. A dedicated control reaches the actual authenticated report rule, asserts 422 and its correlation ID, verifies a separate clean book with the restricted role, and proves malformed rows remain present. The three original CI-affected journeys passed with their existing financial/export assertions.

CSV/XLSX downloads use an owned `os.tmpdir()` directory, explicit destination and owned cleanup. Runnable test/script scans found no remaining `/private/tmp` or `/Users/` assumptions. Linux execution remains required: portable code plus native success does not establish Linux success.

All four node:test browser suites use actual context tracing and capture the first body/drain/teardown-assertion failure before closure. Published evidence contains sanitized DOM/accessibility, masked screenshot, console, operation/key/actor/payload, saved intent, correlated HTTP timeline, idempotency/effect rows and blocking PIDs. Raw traces remain private, are reduced to an allowlisted action timeline and removed. CI uploads only the sanitized evidence root with seven-day retention; generated session keys are masked before export. No financial response bodies or cookies are uploaded through trace resources. Synthetic test data only is permitted in this harness.

## Recovery disposition

Response waits match path, method, original key and actor. Click/response promises are observed together; route draining and held-response release precede context closure. Two controlled schedules cover committed response loss, reload, wrong actor, switching back during a delayed409, cancellation of a committed201, and simultaneous-tab retry. Each verifies original intent and exactly one durable result/effect.

The first new two-tab experiment failed 0/2 because one replay completed before the other Playwright click found its still-present Retry control. Captured states showed both tabs completed and one database effect, not duplicate financial posting. Holding that response until both clicks entered the schedule repaired this demonstrated test race; both tests passed individually and in the final61. This does **not** explain older supplier-refund-reversal/customer-advance failures whose failure-time DOM was never captured.

The older customer-advance response wait, supplier-refund-reversal second retry, separate Phase 3 baseline PostgreSQL82/84 concurrency result, and inherited Phase4 browser32/33 metadata timeout remain visible. No waiver is inferred from later green runs. Retain their logs and collect original failure state if they recur; source/key/actor, response codes, correlation IDs and database blockers are now captured.

## Final native verification and review

After final executable changes and clean locked offline installs: backend264/264, original invariants11/11, frontend88/88, browsers61/61; zero skips/cancellations. Clean/corrupt control1/1, deliberate failure-artifact control1/1 (three intentionally failing child probes), native TLS1/1 and nginx1/1. Lint, syntax, build and diff checks pass. Current complete candidate scan includes untracked source and has zero findings; history retains two disclosures. Clean scenario database reports zero unexplained discrepancies and separate corrupt scenario detects injected corruption.

Independent read-only reviewer `phase3_integrity_review` identified two concrete gaps: teardown failures escaping capture and generated input values escaping runner log sanitation. Both were fixed with deliberate probes; static re-review found no remaining concrete defect in the bounded diff. The coordinator ran all tests; the reviewer ran no tests, subprocesses, migrations or edits. Review is not Linux certification.

## Stop and forward recovery

No Docker/Podman/Colima/Lima/QEMU is installed; no privileged service installation or remote dispatch is authorized. Linux5A, current remote CI, application-image/Compose runtime and historical failure disposition remain open. Stop before5B runtime; only read-only document design accompanies this delivery.

To continue, use this candidate and original actor/key/payload. Preserve all financial and successful idempotency evidence. On uncertain completion, inspect/replay the same operation after current authorization; never clear browser intent or create a replacement operation to guess success. Do not weaken cash reconciliation, remove negative fixtures, repair history, or revert to code that ignores settlement/period rules. Obtain an authorized Linux environment and evidence-backed historical disposition before proceeding. No production rollout is implied.
