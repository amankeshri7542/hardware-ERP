# Phase5 request change manifest (stopped at5A)

Comparison is against complete starting tree `4a7ed30e31c4b95e40e9135c5e2ab700645f02cc`, not an old Phase3 HEAD. Retained commit `aebf06579d5c577ecde0837de7fe68ef59b675cf`; branch `codex/phase-1-security-baseline`. Real index SHA256 `b3bef8a460d24b7366e039ab77dd5800912606b089421e8e993d80b8d53341f8` and recovery refs preserved. The original checkout is untouched.

Full tested tree `4d5ddbb51523cd2dba883177faee3e2a9b3399c9` contains343 files. Starting336-file manifest is `/private/tmp/hardware-phase5-start-4zbkw4fh/manifest.json`. Tested per-file and six-file build manifests are in `/var/folders/y1/5qgpl44s7w5_6cx9hmsh969h0000gn/T/hardware-phasefive-tested-_uumk2v3`. Non-Markdown tested manifest SHA256 `c6bf075af93ca0a7f569f450f2383e11d5a851b6ee96949846c44a610b6b6e79`; build manifest SHA256 `032e77e2af1bb3e5f7540a6c3ff1e8d9c543b38b02535e9469413adc2e72c7a5`.

Final documentation-inclusive tree/manifest and preservation checks are recorded in `/private/tmp/hardware-phase5-start-4zbkw4fh/final-identity.json`, with the actual manifest directory inside that receipt. The final tree cannot include its own hash; the delivery response also records it. Application/test/configuration bytes are identical to the fully tested tree; later diff is only Markdown. No executable follow-up is passed off as full-suite verification.

| Files | Change |
|---|---|
| `.github/workflows/phase-1.yml` | Mask session keys; clean/corrupt control; real evidence self-check; isolated full browsers; always upload sanitized evidence |
| `frontend/package.json` | Route each browser suite and new full-browser command through disposable DB/evidence runner |
| Four `frontend/tests/*browser.test.js` | Real pre-teardown capture, captured network/runtime assertions, portable exports; exact-operation recovery waits; two controlled Phase4 schedules |
| `frontend/tests/helpers/browserEvidence.js` | Capture first failure, private trace sanitization, owned download paths and pre-close drain handling |
| `frontend/tests/fixtures/evidence-failure.mjs` | Three synthetic deliberately failing body/teardown/password-action cases with actual download |
| `scripts/run-browser-tests.cjs` | Fresh migrated/granted browser DB, distinct owner/runtime credentials, sanitized child logs, signal/exit propagation |
| `scripts/sanitize-browser-trace.py` | Bounded actual trace ZIP to allowlisted action timeline; no headers/bodies/resources |
| `scripts/test-browser-evidence.cjs` | Assert failure propagation, sanitized artifacts/stdout and credential canary absence |
| `scripts/test-cash-fixture-isolation.cjs` | Real authenticated422 on corrupt evidence, clean restricted-role controls and retained malformed rows |
| New Phase5/stabilization reports, evidence, plan, manifest, document contract/renderer decision, Phase6 handoff | Honest gates and design-only future requirements |
| `docs/RELEASE-BLOCKERS.md`, `LOCAL-DEVELOPMENT.md`, `PHASE-4-OPERATIONS.md`, `.context/KNOWN_ISSUES.md` | Current local-only authorization, correct blockers and portable test/recovery guidance |

No backend application behavior, financial policy, schema/migration bytes, grants, dependency lockfile, production config or document containment implementation changed. Migration sequence remains001–011,013–021. No dependency added. No stage, commit, push, branch switch, remote write, history rewrite, live credential action or deployment.
