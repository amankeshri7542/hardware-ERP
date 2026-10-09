# Phase 1: security containment and engineering baseline

Baseline and candidate base: `5404f98b27eb8c326aa3ebc603ee43efe6394404`.
Branch: `codex/phase-1-security-baseline`. Started 2026-10-09.

The original checkout has uncommitted AI/mobile/UI work. This isolated worktree
starts at the current committed HEAD (which equals the audit SHA); it does not
copy, reset, discard or include those unrelated changes. No live service access or credential use is authorized; see the report for the
initial browser-build configuration deviation. The target of one shop, 2–3 users and 100–150 invoices/day
is a planning assumption, not a performance measurement.

## Sequence and ownership

1. **1A — reproducibility and migrations.** Environment specialist owns manifests,
   locks, Node version, containers, CI, migration runner, forward schema migration
   012, synthetic seed and local database setup. Verify empty/repeated,
   interrupted/checksum/concurrent and populated upgrade runs with real PostgreSQL.
2. **1B — security and containment.** Security specialist owns configuration,
   sessions, capability checks, safe errors/logs and migration 013. Coordinator owns
   PDF/upload entrypoints, storage containment and secret scanning. Frontend
   specialist owns browser authentication and disabled-feature notices.
3. **1C — evidence and handoff.** Separate local engineering gates from the
   intentionally failing desired-behavior financial release suite. Build/install
   from candidate files, review the integrated diff separately, document measured
   results and outstanding operator actions.

Each specialist begins read-only; write ownership is non-overlapping. The
coordinator owns shared contracts and migration ordering. The three agents use
the requested GPT-6 Astra/xhigh setting; the coordinator runtime is unchanged.

## Initial decisions

- Preserve the Express/PostgreSQL modular monolith and React/Ant Design UI.
- Prefer persisted opaque sessions with explicit expiry/revocation over custom
  JWT refresh rotation. Browser-readable bearer storage must be removed without
  deleting billing drafts. Financial mutations must never be replayed on expiry.
- Keep owner/admin privileges; deny unassigned capabilities. Cashier billing
  remains unavailable while client-provided cost and quantity contracts are unsafe.
- Contain PDF rendering and supplier attachments server-side if renderer sandbox,
  network isolation and active-document safety cannot be demonstrated. Disabled
  functionality is a release limitation, not a repaired renderer or upload pipeline.
- Preserve historical migrations and append-only ledger protections. Never reset
  an existing database or automatically mark an untracked schema as migrated.
- No push, merge, deployment, secret rotation, history rewrite or Phase 2 repairs.

## Completion rule

Only measured checks may be marked PASS. Missing tooling or unavailable mandatory
evidence is BLOCKED, not inferred success. Production remains BLOCKED while
financial defects and required operator verification remain. See the report,
security runbook, release blockers and Phase 2 handoff for final outcomes.
