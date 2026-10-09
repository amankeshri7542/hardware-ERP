# Independent Phase 1 review

The three real specialist agents began read-only and received separate write
ownership. They use GPT-6 Astra/xhigh as requested. Reviews below were performed
by a reviewer who did not author the reviewed area. This is a scoped review, not
a production security certification.

## Security reviewer → coordinator's document containment and scanner

Reviewed invoice/purchase controllers and service entrypoints, report PDF exports,
storage, queue/worker/manual gates, pure invoice HTML escaping, template selection,
and redacted scanner output.

- **P2, fixed:** The HTML helper inserted escaped customer text and then replaced
  the first `{{ITEM_ROWS}}` occurrence. A customer name containing that literal
  displaced the trusted row placeholder. Added one regression per template: both
  failed before the fix. A single substitution pass over the trusted original
  template now inserts row markup and escapes ordinary fields. Independent rerun:
  **6/6 document-helper tests pass**, zero skipped. Rendering remains disabled.
- No other actionable finding within this review scope. Public/background/manual
  render paths reject, and the worker does not consume Redis jobs. Secret scanner
  reports locations/rule IDs only.

Not reviewed here: live infrastructure, historical document contents, actual
renderer isolation (renderer disabled), spreadsheet financial correctness or
remote/hidden Git history.

## Coordinator → frontend and database grants

- Auth state, cookie contracts, route guards and cashier catalog changes reviewed.
  The browser suite checks login/logout, expiry without replay/reload, preserved
  draft keys, denied billing and disabled document controls.
- **P1, fixed:** Initial database
  grants allowed DELETE on every business table. Existing service callers delete
  only sessions, product unit conversions and product/supplier links. Restrict
  deletion is now limited to those tables, and grants apply atomically. The
  security suite verifies financial deletes are denied to the restricted role.
- Minor presentation feedback: keep operational notices clear without Phase 1/2
  implementation jargon. Browser tests must be rerun after notice updates.

Other specialist review dispositions and reruns are recorded in the environment
and frontend evidence documents and consolidated in the Phase 1 report.

## Frontend reviewer → environment/migrations/CI

- **P2, fixed:** The migration test harness checked only the database-name suffix
  before schema mutation. It now also requires test mode and a loopback host.
- The default engineering command initially included deliberately failing financial
  regressions and a TLS test without its fixture. The author separated the explicit
  engineering suites, TLS setup and financial release gate; the reviewer verified
  the final workflow contains separate jobs and no deployment action.
- Frontend lint now retains `no-undef`; unused CommonJS stub barrels were converted
  after caller checks. Auth **4/4**, browser **4/4**, lint/build/diff checks pass.
- The migration journal/lock/failure handling, manual baseline procedure, non-root
  Docker targets, private ports and explicit proxy settings had no further finding.
  Container execution and remote GitHub settings remain unverified.

## Environment and security reviewers → session/database boundary

- **P2, fixed:** The standalone migration database configuration accepted an invalid
  mode such as `prod` as development, bypassing production TLS requirements. It now
  requires an explicit supported mode, with regression assertions.
- The environment reviewer independently traced the shared transaction advisory
  lock for issuance/revocation, current password/role/active checks, no-user-UPDATE
  application role and default-deny route/redaction logic. No remaining blocker was
  found in that scope. Real security tests pass **12/12**.

## Environment reviewer → PM2 document containment

- **P2, fixed:** PM2 still registered the intentionally disabled PDF worker.
  Because the worker exits with a containment error, PM2 would repeatedly restart
  it. Remove the worker entry while retaining the API process. The coordinator
  reproduced the failure with a source-boundary assertion before changing the
  configuration; it passes after the fix.
- Independent final clean-copy containment verification: **13/13 passed**.
  Coordinator's combined backend rerun from the same immutable tree: **28/28
  passed**, with no skipped tests. Rendering remains disabled.
