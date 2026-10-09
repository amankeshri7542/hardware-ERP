# Security status

The previous static security summary is superseded by
[the Phase 1 report](../docs/PHASE-1-REPORT.md) and
[the security runbook](../docs/SECURITY-RUNBOOK.md).

The candidate uses revocable database sessions, explicit Origin checks, backend
capability authorization and field redaction. It contains PDF rendering and
supplier attachment upload/retrieval by disabling them server-side.

Live HTTPS, credential rotation, account/session invalidation, private networking,
backups, least-privilege deployment and branch protection remain operator actions.
Removing a disclosed value does not prove that the credential was rotated.
See [release blockers](../docs/RELEASE-BLOCKERS.md) before any deployment.
