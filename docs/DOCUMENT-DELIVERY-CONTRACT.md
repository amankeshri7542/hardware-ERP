# Document delivery contract — design only

Status: unimplemented, pending checkpoint5A. This inventory and proposed contract authorize no runtime activation. Existing financial evidence and idempotency responses are unchanged. All PDF and attachment containment remains active; no new table, migration, library, worker, storage driver or bypass flag was added.

## Actual contained paths

| Path/surface | Existing behavior and next-phase requirement |
|---|---|
| `invoices.router.js`: GET `/:id/pdf-status`, GET `/:id/pdf`, POST `/:id/regenerate-pdf` | Auth/capability checks remain; service/direct generation throws `PDF_DISABLED`. Replace only after gate; separate document request/reprint authorization from financial posting |
| `invoices.service.js` direct fallback; `utils/pdf.js` | Direct generator fails closed. Escaped HTML formatter remains for tests, not an approved DTO/rendering pipeline; do not restore API-process generation |
| `queues/pdfQueue.js`, `workers/pdfWorker.js`, `backend/worker.js` | Queue call throws; worker is disabled and does not consume old jobs. Existing invoice pdf_status is not a durable job/version model |
| `utils/s3.js` | Upload/signing functions fail closed for all drivers, including old local paths. No private storage proof |
| Seven report `export-pdf` routes | Sales, GST, stock, stock movement, dues, profit, collections all terminate in `disabledReportPdf`. Every route must stay disabled until its own safe DTO/authorization/output tests exist |
| Purchases POST/GET `/:id/invoice` | Validates ID/existing purchase then denies attachments; no upload parser/storage side effect. Current capability checks remain before this path |
| Frontend invoice API helpers, `pdfPoller.js`, report download helpers | Legacy helpers exist; document controls remain unavailable. New recovery must be independent of financial mutation recovery |
| Finance statements/reports/export.csv; existing XLSX exports | Supported on-screen and safe data export surfaces remain. These are not rendered PDFs or statutory certification |

The app exposes frontend static assets, not a public supplier-upload directory. Docker's prepared output directories do not establish an active safe renderer/storage service. `config/redis.js` remains unrelated infrastructure code; contained PDF paths do not use it to revive legacy jobs.

## Supported source semantics for future DTOs

| Document | Authoritative source / boundaries |
|---|---|
| Issued sale | Immutable invoice/items: document_kind, number/date, selected/base units, price/discount/tax/quantity and stored totals; customer_snapshot when known. Exclude purchase cost, profit and internal notes/IDs not intended for customer use. Never derive historical facts from today's catalog |
| Sales credit note | `sales_return` invoice linked to original; original item allocations and issued credit facts, not a newly computed sale. Negative document values remain legitimate |
| Supplier debit record | Purchase return and debit note, original receipt lines and immutable value; no second stock movement or recognition |
| Receipt/advance | Original payment and concrete tender evidence, issued customer snapshot and actual receipt business date; no credit application disguised as receipt |
| Refund/settlement confirmation | Settlement event, lines, tenders, party snapshot, actor/date and reversal linkage. Label operator-confirmed record, never bank/provider-verified transfer |
| Statement | Reconciled full-history running/opening values before filtering/pagination, stable ordering, as-of/filter and recorded cutoff, all relevant reversals. Separate current statement from reprint of issued source |
| Day-close summary | Immutable opening/close/cutoff, counted/expected cash and discrepancy; do not replace discrepancy with an invented balancing event |
| Estimate and internal reports | Explicitly labeled estimates/reports. Profit/stock/internal reports require separate privileged DTOs; never reuse them as customer-facing sale documents |

Migrations018/019 provide customer/supplier/receipt snapshots for supported newer events; legacy nulls remain unknown. Return snapshots follow the original invoice. No seller-issued identity snapshot currently proves historical seller settings. A future forward migration must capture required seller facts at issuance for new records; validate shop settings first. For historical records, show a clear limited non-certified record or block required facts that cannot be established. Never backfill from current settings. No tax rate/threshold/compliance policy is invented.

## Proposed immutable identity and scheduling

A document version must be uniquely identified by source type/ID, original source or statement cutoff/version, template version, representation and a hash of an allowlisted immutable DTO. Keep issued facts and current settlement overlays separate. A reprint references the same frozen version; a current statement creates an explicit new as-of version. Store hashes, creator, issued/created timestamps and provenance. Do not edit financial idempotency successful response JSON to add document progress.

After5A, add the next available forward migration only after rechecking actual ordering (currently through021;012 absent). A durable document request/outbox should be created in the same transaction as a new supported business event. No network queue/upload/rendering within financial locks. After commit, document failure changes only document status and must not retry/cancel/repost money. Authorization and original actor checks precede document reservation or saved result; reprint/deduplication uses its own path because a closed-day reprint is not a new financial posting. Do not bypass `financialPeriod` for financial commands.

Proposed states: pending → leased/running → ready; temporary errors → retryable failure → pending under bounded attempts/backoff; invalid/unsupported facts → permanent failure. Each claim uses database serialization, lease expiry and increasing fencing token. Only the current token can publish. Worker death releases work by expiry; stale workers cannot change version or overwrite a newer result. Staged private objects become reachable only through one atomic winning publication pointer. Failed/cancelled/stale uploads need owned-object cleanup and orphan reconciliation; published versions remain immutable. Unique database identity, not an in-memory mutex, determines one result.

## Proposed runtime and attachment requirements

Allow only templates/assets/fonts packaged with the chosen renderer. Treat all source text as literal bounded text, bound rows/pages/text/bytes/time/memory/concurrency, and do no monetary recalculation in templates. Rupee and required Hindi text, negative credits and long line/page-break fixtures must pass real visual inspection. Exclude cost/profit/internal metadata through an allowlist before entering the rendering process.

A future renderer must run without DB/cloud/session secrets or host mounts, with OS/process isolation and denied file/metadata/public network access. Node hooks and Playwright interceptors are test guards, not this isolation proof. Chromium would additionally require effective sandbox/non-root execution and unnecessary JavaScript disabled; `--no-sandbox` is not an acceptable fallback. See the provisional renderer decision.

Attachments require current admin authorization and valid parent ownership before parsing/storage; bounded streaming/body/count/decompression; generated opaque names and private storage. Proposed lifecycle quarantine → accepted/rejected with immutable replacement/version evidence. Conservatively support raster images only after actual decode/re-encode/limits tests; PDF stays quarantined/blocked until restricted validation and scanning policy is available. Active formats, archives, encrypted/uninspectable PDFs and unavailable validators remain blocked. Parser success is not malware clearance.

Private download requires current authorization, safe content type/disposition/nosniff, no traversal/symlink/raw-path exposure. Prefer authenticated proxy for immediate revocation; any future signed URL is one-object/short-lived and remains a bearer capability until expiry. Preview needs a separate untrusted origin or proven sandbox. Upload DB/storage failures require idempotent compensation and orphan cleanup; unknown parents create no object. Local private roundtrip tests cannot certify bucket/IAM configuration.

## Operator contract and required acceptance

Show financial posted success separately from document pending/failed. Retry/reprint/download operates on the committed source and cannot create another sale/payment. Preserve uncertain financial key/actor/payload across document failures, reloads and account changes. Stable accessible names, keyboard focus, visible busy/error states, no destructive Escape during unresolved intent, and retained drafts remain required. Handle blocked download/popups, expired links and worker outages explicitly.

Before activation prove original/closed-day reprints, exact immutable facts, private allow/deny cases, stale worker fencing, queue/storage outage, cancellation/crash/limits, same-job races and one financial effect. Inspect actual A4/thermal outputs. Run browser downloads and account-change recovery against the exact final build on supported Linux runtime. Cloud/IAM, physical printer, accountant and production activation are separate human/runtime gates. None of these proposed capabilities is claimed as implemented here.
