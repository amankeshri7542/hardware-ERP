# Document delivery contract — Phase 5B

Updated 2026-10-10. Supersedes the design-only contract in starting tree `9bc576c4fc784ea57642496bd170abc559982808`. The user's revised sequencing permits synthetic document development while incident disposition remains open. This is not release or production activation approval.

## Supported commands and content

Admin-only `/api/documents` implements capabilities, list, request, UUID status, authenticated download and explicit retry. Requests accept only source type/ID, layout and statement date filters. They never accept HTML, templates, URLs, money, filesystem paths or client document content. Existing legacy invoice/report PDF and supplier attachment endpoints remain denied; cashier capabilities are unchanged.

| Source | Formats | Frozen authoritative facts |
|---|---|---|
| Issued sale | A4, paginated 80 mm thermal | Original invoice/item quantity, selected/base units, rate, discount, tax, totals and issued customer snapshot |
| Sales-return credit note | A4 | Issued negative credit values and original sale reference; original seller snapshot |
| Customer receipt/advance | A4, paginated 80 mm thermal | Original payment date, customer snapshot, exact amount and proven concrete tenders; operator-recorded, not bank-verified |
| Customer statement | A4 | Reconciled full-history opening/running/closing values, date filters, as-of date and repeatable-read visibility |

Purchase, supplier debit, refund, settlement, day-close, estimate and report PDFs are deferred individually. Existing safe CSV/XLSX and on-screen financial records remain available. None is claimed as statutory/accountant certification.

Statement timestamps distinguish transaction start from actual generation; neither is presented as an exact timestamp visibility cutoff. PostgreSQL establishes the repeatable-read snapshot at its first read: a concurrent commit before that read may appear, while later commits are excluded. This timing is explicitly labeled and covered by a competing-posting test.

The allowlist contains schema version, type, number, issue/generated dates, seller/customer name/address/tax identity, labeled facts, table columns/cells, totals and notices. It excludes purchase cost, profit, session data and internal notes. Exact stored monetary strings are displayed with ₹; templates do no accounting. Literal hostile text remains text. Latin/Devanagari use the licensed bundled font; unsupported glyphs fail visibly rather than printing missing characters.

New financial results capture seller identity only from explicitly operator-confirmed synthetic settings (`DOCUMENT_SELLER_CONFIRMED=true`, STORE_NAME/ADDRESS/GSTIN). Invoice/receipt reconciliation is checked at capture. Issued sources retain original identity even if customer/catalog/settings or settlement subsequently change. Historical sources without captured seller/item/party facts remain blocked; current settings never fill the gap. Unknown optional contact/tax fields are labeled unknown. Statements identify current contact identity at generation separately from issued record identities.

## Durable evidence and transaction boundary

Migration022 (hardened by forward023) adds `document_sources`, `document_jobs` and `document_requests`, immutable source/request triggers, job identity/publication protection and restricted lifecycle helpers. No historical financial SQL or rows change. Source uniqueness is `(source_type,source_id,basis)`; job uniqueness adds layout/template `phase5b-v1`. Sources hold canonical SHA256 of the frozen DTO or explicit permanent error.

Financial idempotency saves its original successful response, then captures source/outbox rows in the SAME PostgreSQL transaction. No renderer, Redis, storage call or document status is added to the financial response. Unavailable seller/content facts produce permanent document failure while the valid financial transaction commits. Unexpected SQL failure rolls back the transaction, preserving original-key recovery. Worker/storage outages after commit cannot cancel or repost money/stock.

Document commands have separate actor/operation/key evidence and canonical submitted intent hashes. Authentication, capability and Idempotency-Actor checks precede reservation/replay. A session advisory lock precedes the statement repeatable-read snapshot so simultaneous identical keys see one original saved result. Same key/intent replays; different intent conflicts. Rollback leaves no reservation. A new statement key explicitly captures a new database snapshot; retry/reprint of the original retains its source. Closed-day reprints do not use or weaken financial-period gates.

States: pending → running → ready; retryable failure requires explicit retry; invalid immutable input is permanent failure. Each claim increments a fence and attempts, uses SKIP LOCKED, and leases for90seconds. Expired workers can be reclaimed; third exhausted lease becomes permanent. Maximum3 attempts; explicit retries wait2/4seconds before claim. Only current unexpired fence may publish. Completed content hash/size/publication date cannot change. Missing/corrupt artifact recovery must regenerate byte-identical content or fail permanently. Exhausted jobs require reviewed forward recovery, not manual history deletion or a financial repost.

## Storage and execution boundary

The dedicated job role reads document sources/jobs and updates only lifecycle/artifact columns; it cannot read users, sessions or financial tables. The API can insert immutable evidence and initial jobs, but cannot set artifacts/ready directly. Guarded SQL helpers permit retry/invalidation. `backend/document-worker.js --once` operates only with a distinct role, guarded loopback `_test` database and explicit synthetic mode.

Rendering runs outside financial/API processing. PDFKit0.17.2 with pinned fontkit and bundled OFL font receives only DTO/layout and a scrubbed environment. Both drivers require NODE_ENV=test and DOCUMENT_RUNTIME_MODE=synthetic-local. Native macOS uses built-in default-deny sandbox-exec; Linux uses a non-root, mountless, network-none, read-only container with capabilities removed, no-new-privileges and resource limits. No fallback driver exists. Production is always disabled. See renderer decision for measured bounds and limits.

Input is bounded to256KiB including envelope,300 rows,8 columns and individual text limits; output to40pages/8MiB/deadline15seconds. Oversize/invalid content remains a specific document failure and does not invalidate the financial record.

Local private storage requires canonical absolute0700 owned directory. Exclusive0600 staged objects are fsynced, renamed to random UUID.pdf, and checked by hash/size/no-follow before download. No public upload directory or signed URL. Current authenticated admin authorization applies to every download, with safe filename/application-pdf/attachment/nosniff/private no-store headers.

The shared database advisory lock `(50502,1)` spans artifact store + winning metadata publication. Cleanup holds the SAME lock across authoritative referenced-key query and deletion, so a stale live-key list cannot delete a newly published object. Only owned opaque regular orphan files older than24hours (minimum1hour) are eligible. Stale/fenced uploads remain private and can be cleaned. Metadata with missing/corrupt bytes becomes retryable failure; valid published references are preserved.

## UI recovery

Financial record posted and document progress are separate. Invoice, payment and customer screens expose only verified supported controls when capabilities say enabled. Recovery persists original actor, exact intent, source/target and operation key BEFORE dispatch, in a document-only store. Account/target changes, reload or expiry cannot replace the unresolved operation. Saved successful receipt shapes are validated before clearing it. A later rejection does not disprove an earlier uncertain commit; retry retains the original key. Document operations never clear uncertain financial intents or replay financial mutations. Buttons retain accessible names during loading and report pending, failure, missing storage and authorization errors.

## Activation and recovery limits

Only synthetic-local native/CI activation is within this task. Private local storage proof does not establish S3/IAM. Physical thermal/A4 printer acceptance, accountant/business acceptance, production infrastructure/backup checks, disclosed credential rotation and historical incident disposition remain pending. No attachments, cashier rollout or Phase6 operations.

Recovery: keep source/job/request evidence and original operation keys; restore missing storage or isolated worker, then explicit document retry within bounds. Observe leases rather than deleting jobs. Investigate hash mismatch and exhausted attempts; preserve published version identity and use a reviewed forward fix. Never revert to insecure auth, legacy renderers, incompatible posting code or rewrite issued financial records.
