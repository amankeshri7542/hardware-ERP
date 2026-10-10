# Security and recovery runbook

This is a local candidate procedure, not evidence of production configuration.
No live credential, production database, payment or notification was intentionally
used. An initial browser check may have attempted the old production API with
synthetic credentials; see PHASE-1-REPORT and FRONTEND-EVIDENCE for the known facts
and the subsequently enforced local-only network guard. Operators must record
evidence for the pending actions below.

Phase 4 adds admin-only `finance.read`/`finance.write` settlement and close operations. Confirmations are operator records, never proof of provider execution. Preserve actor-scoped idempotency results and browser recovery intent during incidents; do not clear uncertain submissions or regenerate operation keys. Preserve immutable source/application/refund/debit/cash/ledger evidence and closed periods, and use compatible forward fixes. See `PHASE-4-OPERATIONS.md` and `FINANCIAL-SETTLEMENT-CONTRACT.md`. PDF/attachment/cashier containment and the live credential/runtime/operator actions below remain mandatory.

## Disclosed credentials and sessions

Local Gitleaks 8.30.1 scanned available history with complete redaction. It reported
a GitHub-token pattern and a JWT in historical files. Current documentation also
contained a disclosed login credential. Values are deliberately omitted. Local
history is not shallow, but this proves only the objects present in this checkout;
remote hidden/deleted refs, forks, clones, logs and external copies were not inspected.

The operator must inventory potentially affected credentials without pasting them
into tickets or logs, revoke/rotate provider and database credentials as applicable,
replace disclosed account passwords, and review provider access events. Deleting
text from Git is not proof of rotation. Do not test disclosed credentials. Any
published-history rewrite needs its own coordinated approval and clone cleanup.

The candidate accepts only opaque server-side sessions. Legacy JWT Authorization
headers and refresh cookies do not authorize requests. The browser deletes only
obsolete `erp_token`/`erp_user` entries, preserving unrelated billing-draft storage.
It does not silently replay financial mutations after authentication expiry.

Sessions expire after eight hours. Logout deletes the persisted session, and user
deactivation/password changes invalidate sessions. For a controlled future rollout,
stop old API and worker processes first so they cannot continue accepting JWTs or
rendering old jobs. Use one immutable frontend/backend revision. An authorized
operator can invalidate all candidate sessions with `DELETE FROM auth_sessions`
and replace `SESSION_SECRET`; users must sign in again. This has not been performed
on any live environment. Never roll back to the old JWT server as a security fix.

## Configuration, TLS and proxy boundaries

Use the pinned Node version and tracked locks. Load environment values explicitly;
do not copy the original production `.env` into local work. Use a randomly generated
`SESSION_SECRET` of at least 32 characters from an approved secret store. Do not
reuse any synthetic test value. Production requires `NODE_ENV=production`,
`HTTPS_ENABLED=true`, exact HTTPS `CORS_ORIGIN` values, and validated database TLS.

`DB_SSL=true` and a readable, valid `DB_SSL_CA_PATH` are required in production.
The PostgreSQL client verifies certificates and hostnames. Missing/invalid CA
configuration fails closed. Provision the CA out of band and test the actual
database hostname; do not set `rejectUnauthorized=false` or substitute an IP for a
certificate hostname. Local plaintext database exceptions require explicit
development/test configuration.

Provision the real domain and certificate before using `deploy/nginx.conf`. Test
nginx configuration, then verify HTTP redirects to HTTPS, a trusted certificate
chain and hostname, and document-response headers on `/`, a deep SPA route and
static assets. Confirm CSP, frame protection, MIME sniffing protection and HSTS on
the **SPA response**, not just the Express API. The local-development nginx config
is explicitly HTTP-only and must not be used as a production substitute.

Set `TRUST_PROXY` to the actual proxy IP/CIDR only, never a blanket hop count or all
private networks. Ensure no alternate direct path reaches the API. Keep database
and Redis internal; bind local development service ports to loopback. Validate
these properties in the actual deployment network, not merely in checked-in YAML.

The production session cookie is Secure, HttpOnly, SameSite=Strict and has no
Domain attribute. Every unsafe API request requires an allowlisted Origin,
including login/logout. Credentialed CORS accepts exact configured origins only.
This is the chosen same-origin cookie/CSRF policy; cross-site embedded clients are
not silently supported. Frontend production API requests use `/api`.

## Capabilities and confidential fields

The baseline had an admin-only database constraint. Admin access to existing
defined operations is preserved; unspecified routes/roles are denied. No real
cashier account is provisioned. Cashier fixtures exist only in disposable tests.

| Capability | Admin | Cashier |
|---|---|---|
| Product catalog read | Yes | Yes, allowlisted public catalog fields |
| Cost/profit and price history | Yes | No |
| Catalog/price changes and stock adjustment | Yes | No |
| Billing, payments and sales/purchase returns | Yes | No |
| Customer/supplier/purchase records | Yes | No |
| Reports and spreadsheet exports | Yes | No |
| Settings | Existing defined read access | No |
| PDFs and supplier attachments | Disabled | Disabled |

The backend checks direct requests and redacts catalog DTOs; hidden buttons are
not authorization. Cashier billing remains dependent on Phase 2 removing trusted
client cost/quantity snapshots. Role changes require an explicit business decision.

## Document containment

Invoice generation/download/status/retry, report PDF exports, queued/direct/manual
rendering, and supplier attachment upload/retrieval are disabled with explicit
`PDF_DISABLED` or `ATTACHMENTS_DISABLED` responses. Multipart data is not parsed or
stored. Purchase authorization/identity checks happen before the containment
response. No environment flag can enable these features.

`STORAGE_DRIVER` is explicit (`disabled`, `local` or `s3`), but all contained document
operations reject for every driver. AWS key presence never chooses local storage.
No real AWS access is needed for development. Existing attachments and generated
files are left untouched and unavailable through the contained endpoints.

To restore documents in a future reviewed change: prove sandboxed rendering in a
dedicated restricted runtime, deny network requests and unnecessary JavaScript,
bound memory/time/concurrency, escape all text and allowlist templates. Attachment
processing must verify content beyond MIME/magic bytes, use generated safe keys,
private retrieval, size limits, parent authorization and cleanup on every failure.
Do not reintroduce direct-generation fallback or a bypass environment flag.

## Migrations, privileges and recovery

Use separate schema-migration and application credentials as described in the
local development guide and database-role scripts. The application role must not
own tables or disable triggers. Test actual login and financial transactions with
those grants. The runner uses migration IDs, SHA-256 checksums, per-migration
transactions and an advisory lock. A failure exits nonzero; do not suppress it.

For an existing untracked schema, take an authorized backup/copy and perform the
read-only verification/baselining procedure in the environment guide. Never mark
all scripts applied automatically or rebuild existing tables. Historical 001–011
SQL is unchanged. Apply only verified forward migrations.

Before any rollout, rehearse backup restoration and application compatibility on
a synthetic/populated copy. This candidate has no automatic down migrations.
Stopping it and retaining the database is safe; deleting the session table loses
sessions and requires login. Do not drop financial tables or edit ledger history.
Prefer forward fixes to remove defects, and keep document containment active.

## Release controls and evidence

Ordinary pushes no longer deploy production. Operators must configure required
checks, protected branches, artifact provenance and explicit deployment approval
in the remote host. Those settings were not modified or verified here. Both app
artifacts must use the same immutable revision after all checks pass, including
the currently failing financial suite and a clean history/rotation decision.

Logs contain correlation IDs and allowlisted event/status/code metadata, never
raw passwords, tokens, cookies, connection strings, request bodies or validation
values. Run the redacted local scanner with `python3 scripts/scan-secrets.py` and
the history check with `--history` after installing the pinned Gitleaks version.
See `PHASE-1-REPORT.md` for exact measured results and outstanding tooling gates.

## Phase5B document containment and recovery

Synthetic-only safe document delivery is separate from old PDF routes and supplier attachments, which remain denied. No production activation is authorized. Preserve both historical credential disclosures and unknown recovery/concurrency incidents; current scans/tests are not rotation or attribution evidence.

Use migration022 together with forward023: privileged retry/invalidation functions explicitly place pg_temp after pg_catalog and the trusted schema. Restricted-role shadow-table tests must pass. API credentials cannot publish artifacts; worker credentials cannot read financial/session/user tables. Renderer children receive neither credential set.

For missing private bytes, current authenticated download marks the exact published hash unavailable; explicit original-key document recovery may regenerate identical content within3 attempts. A failed or timed-out financial response is recovered through its original financial key, never by issuing another sale for a PDF. Preserve all immutable source/request/job hashes and published metadata. Hash mismatch, exhausted attempts or unexplained historical facts need a reviewed forward fix; no blanket reset, delete or backfill. Restore storage/worker services only in the authorized environment.

The cleanup/publication advisory barrier is mandatory. Do not manually remove referenced artifacts or run cleanup from a stale exported key list. Do not expose the private storage root via nginx/static middleware. Native macOS sandbox proof has a V8-heap/CPU bound, not a total-process cgroup memory guarantee; Linux container proof and physical printer acceptance are distinct gates. Cloud storage/IAM, provider execution, attachments and cashier rollout remain unavailable.
