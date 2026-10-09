# Phase 3 report

Verified locally on 2026-10-09. **Phase 3 supported workflows PASS; production release remains BLOCKED.** Work is uncommitted and unpushed. No production access, live secret rotation, deployment, historical repair or history rewrite occurred. PDFs, supplier attachments and cashier billing remain disabled.

## Candidate and boundary

- Worktree: `/Users/mackie/.codex/worktrees/phase-1-security-baseline/hardware-erp`.
- Branch: `codex/phase-1-security-baseline`.
- Starting/retained HEAD: `724dc8e3e4dc7c7667388d5fedfb0cbd9d8b9dee`.
- Starting clean tree: `16023de750151cecf9f52eaf0d26fb55ea9be1af`.
- Recovery ref: `refs/codex/phase-3-starting-candidate`; prior recovery refs preserved.
- Starting index/worktree was clean. Phase 3 remains unstaged. Original checkout's separate AI/mobile work was untouched.
- Final tested source identity, commands and log paths: `PHASE-3-TEST-EVIDENCE.md`. Snapshotting uses a temporary index, preserving real staging; a tree object is not a commit.

Work proceeded through 3A sales-return/payment compatibility, 3B purchases/stock, then 3C frontend/recovery verification. The coordinator owned contracts, migrations and lock ordering. At most three specialists worked concurrently with separate ownership; available design and independent-review agents explicitly used `xhigh`. No coordinator model switch is claimed. `INVENTORY-RETURN-CONTRACT.md` was written before posting changes and now records the final API and conservative choices.

## Implemented

**3A:** Sales returns bind original invoice items and issued selected/base-unit facts. Duplicate source IDs and conflicting product/value assertions reject specifically. Exact stock proportionality and cumulative rounded allocations of taxable value, discount, GST and cost conserve original totals. Credit identity does not depend on amount sign, including zero-value credits. Every registered-customer return, including Quick Bill, posts its entire credit once. Immutable applications distinguish original-invoice applied credit from unapplied customer credit. Issued total and actual receipts stay unchanged: receipts + applied credits + due reconcile to original total, including subsequent and overlapping payments.

**3B:** Purchase receipts derive totals/base quantities from supported units and agreed selected-unit prices. Original receipt value is retained separately from rounded current per-base cost. Existing last-posted-receipt costing remains, including backdated receipts. Supplier returns bind original purchase items, cumulative quantities and cost; posted stock effect and outstanding debit note are atomic. Stock is fungible; no physical lot provenance is claimed. New opening stock has an actor-attributed movement. Metadata cannot overwrite stock. Immediate counts require reason, actor, expected quantity and monotonic stock version. Price/conversion edits require catalog version; atomic conversion replacement preserves unchanged IDs and explicit sales/purchase flags.

**3C:** Forms review authoritative quotes, show selected/base units and remaining quantities, and persist exact operation/actor/target/payload/key before dispatch. Operation-specific receipt validation and lost-response/reload/account-switch recovery retain uncertainty. Wrong-document recovery links to the saved target without silently clearing intent. Product edits load a single product/conversion snapshot and omit unchanged prices, stock and conversions. No automatic financial replay follows login.

All added financial commands use durable transactional idempotency. Locks follow reservation → source document → sorted source lines → sorted products → customer/supplier. Negative-stock, append-only, account-reconciliation and restricted-role protections remain. Unsupported anonymous returns, damaged/quarantine dispositions, ambiguous history, refunds, cross-invoice allocation and supplier settlement reject or remain unavailable; no new costing engine or statutory compliance claim was added.

## Before and after evidence

`PHASE-3-BASELINE-EVIDENCE.md` preserves the frozen starting-source run. Initial backend **82/84** was followed by unchanged isolated/diagnostic **84/84**. The first payment failure did not capture individual response statuses and the catalog failure did not capture waiter counts; original causes remain unproven. A later identified unscoped lock-observation weakness was fixed with blocker-rooted `pg_blocking_pids` traversal, not presented as proof of those original causes. Baseline frontend units/auth **12/12**, browsers **13/13**, and original release **8/11** were reproduced.

| Before repair | After repair |
|---|---|
| Sales-return control 1 pass / 7 genuine failures: original-line binding, converted-unit value, Quick Bill credit, subsequent payment | Sales-return suite 46/46, including cumulative value/quantity conservation |
| Purchase control 1 pass / 9 failures: trusted totals/base quantity and arbitrary return product/cost | Purchase suite 42/42, including valid receipt/return controls |
| Product metadata control 1 pass / 5 failures: stock overwrite, missing opening movement, non-atomic conversions | Product stock/catalog regression and concurrency tests pass |
| Five valid new-operation receipts misclassified uncertain | New recovery units 28/28; combined frontend units/auth 40/40 |
| FIN-06/07/08 invalid returns reached authenticated handlers and returned 201 | Original release invariants 11/11; specific rejection causes and no-effect checks |

Before logs: `/private/tmp/phase3-sales-returns-before.log`, `/private/tmp/phase3-purchases-before.log`, `/private/tmp/phase3-products-before.log`, `/private/tmp/phase3-frontend-unit-before.log`; corresponding `-after.log` files preserve intermediate green proofs. Final combined logs are in the test evidence. FIN-06/07 fixtures gained required date/reason/disposition and explicit rejection codes. FIN-08 retains missing-source rejection and adds valid original-item requests with wrong product/forged historical cost, no effects and a valid control. No desired invariant was skipped or inverted.

## Final local gates

| Gate | Evidence |
|---|---|
| Backend | **193/193 PASS**: environment 5, security 12, containment 13, financial 163; complete rerun after final cashier fix |
| Original release suite | **11/11 PASS**, no skips |
| Frontend auth/financial/recovery units | **40/40 PASS** |
| Browsers | **33/33 PASS**: new Phase 3 20; existing session/containment 4; existing financial 9 |
| Backend/frontend lint; backend syntax | **PASS** |
| Guarded frontend production build | **PASS**; inherited large-bundle warning remains |
| Clean offline installs | **PASS**: backend 417 and frontend 241 packages; lock entries and native probes verified |
| Fresh/populated forward migrations | **PASS** through 017, including repeat, rollback, cancellation and competing-runner rejection |
| Current complete-source scan | See final result/identity in test evidence; new untracked files included |
| Historical secret scan | **FAIL: 2 unresolved disclosures**, values redacted |
| Docker / image / Compose runtime | **BLOCKED: Docker CLI unavailable** |
| Current remote CI | **UNVERIFIED: no Phase 3 push authorized** |

Node runtime processes inherited the loopback-only guard before startup; browser route, redirect, WebSocket and service-worker controls preceded navigation. Synthetic PostgreSQL 16.15 application calls used the restricted login; owner credentials were limited to fixture/migration setup. Vite `envDir:false` prevents dotenv loading; tested API URL is `/api`. No live `.env` or old external API was used.

Coverage includes fractional/rounding properties, full cumulative reversal, converted units, catalog drift, inactive/ambiguous records, wrong source/assertions, same-key contention, changed intent, actor switching, late failure injection, rollback reservation reuse, overlapping payment/stock operations and lost responses. Concurrency tests establish real database lock contention. Browser tests verify persisted recovery, clear success/error and preserved intent. Green tests do not certify unsupported workflows or historical data.

## Migrations, reconciliation and review

Only forward migrations **016** and **017** were added. Applied bytes are frozen; historical 001–011 and 013–015 remain unchanged, and no 012 was fabricated. `PHASE-3-MIGRATION-EVIDENCE.md` records hashes, restricted grants and fresh/populated upgrade proof preserving **1,169 historical rows, 23 sequence states and 62 grant entries**. No automatic down migration or historical repair ran. `PHASE-3-CHANGE-MANIFEST.md` lists all Phase 3 file changes.

Read-only `db/reconciliation/phase-3.sql` ran with restricted credentials, enforced read-only mode and ROLLBACK. The fixture-rich working database is **not clean**: 11 debt differences, 14 sales-counter/link differences and 12 stock/ledger differences were observed alongside unknown historical identities. Six empty -50 credits and four legacy pending supplier returns were confirmed deliberate malformed fixtures. Customer-cache, purchase-counter and purchase-total differences were zero at that observation. IDs/provenance remain in local evidence; these diagnostics neither describe production data nor authorize repairs.

Independent read-only review found four defects, all fixed: missing version on price-only edits; editable stock silently omitted by product form; rejected return recovery clearing another document's intent; and separate product/unit reads combining incompatible snapshots. Review accepted the repairs. The original browser suite subsequently found a fifth regression: cashier redaction dropped public product fields when the new DTO included conversions. A security regression first failed on missing public ID (7/8), then the fix retained only existing public product/conversion allowlists. The reviewer accepted that narrow repair, with unchanged privileges/cost concealment. The full backend and affected browsers passed afterward. A stale browser assertion was updated to the current attachment-disabled message without removing containment checks.

## Recovery and release decision

Final independent disposition: no remaining blocking finding in the reviewed
Phase 3 changes or documentation. The reviewer checked saved test summaries,
all 59 manifest entries and tested source/scan identity; review was read-only
and did not independently rerun runtime checks.

Recover uncertain completion using the saved actor, target, payload and key. Do not create a replacement key merely because a response was lost. A later domain rejection does not resolve prior uncertainty. Stale quotes or counts require reviewed new intent only after known rejection; preserve successful result records and all source/application/debit/ledger evidence.

Investigate reconciliation failures read-only. Do not reset counters, infer snapshots from current catalog, invent openings or update caches to force a pass. Preserve failed-migration logs, verify atomic rollback and fix forward; committed migrations have no automatic reversal. Reverting posting code after modern return evidence exists is unsafe: stop writes and use a compatible reviewed forward fix. Never restore the old JWT/PDF paths.

**Phase 3 supported local workflows: PASS. Inherited runtime/operator gates: BLOCKED/UNVERIFIED. Full production release: BLOCKED.** `PHASE-4-HANDOFF.md` records remaining settlement/document work and operator actions. User-reported remote run 37911403467 on the starting commit is baseline evidence only, not verification of this uncommitted candidate; image-build success does not prove runtime. Historical credential rotation, live transport/private networking/grants, backup/restore, branch protection and operator release approval remain mandatory. The earlier external-request incident's known facts and uncertainty are preserved; this phase did not contact that service.
