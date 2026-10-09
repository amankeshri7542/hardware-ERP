# Release blockers

Full production release is **BLOCKED**. The local candidate is not financial
correctness certification. No deployment or live repairs were authorized.

The financial suite uses real local HTTP handlers and disposable PostgreSQL.
Measured frozen Phase 1 baseline: **11 tests: 2 pass, 9 fail, 0 skipped**. Phase 2 repeats the same invariant assertions with valid due-date/idempotency fixtures and restricted-role HTTP: **11 tests: 8 pass, 3 fail, 0 skipped**. FIN-01–05 and FIN-09 now pass; FIN-06–08 still fail for their original return defects. See `PHASE-2-TEST-EVIDENCE.md` for the baseline and transaction proofs. Failing
assertions state the desired behavior; they are not inverted into “known bug passes.”
Run `cd backend && npm run test:release-blockers` with the documented test environment.

| ID / owner | Frozen Phase 1 reproduced behavior | Verification / remaining phase |
|---|---|---|
| FIN-01 / Phase 2 billing | Quantity 2 with client base quantity 1 deducts only 1 | Phase 2 passes: authoritative units leave stock 98 from 100 |
| FIN-02 / Phase 2 billing | Client cost 999 is stored instead of product cost 30 | Snapshot authoritative cost inside the sale transaction |
| FIN-03 / Phase 2 billing | Discount 200 on rate 100 returns 201 | Phase 2 passes: excessive discounts reject atomically with 422 |
| FIN-04 / Phase 2 ledger | Unpaid Quick Bill leaves customer ledger at 0 instead of 200 | Phase 2 passes: registered Quick Bills debit receivables; anonymous credit is rejected |
| FIN-05 / Phase 2 payment | Split 10 with amount paid 50 returns 201 | Phase 2 passes: exact-cent tender equality is checked before writes |
| FIN-06 / Phase 3 returns | Duplicate full sales-return lines return 201 | Aggregate and bind return quantity to remaining sold quantity |
| FIN-07 / Phase 3 returns | Wrong product on an invoice-item return returns 201 | Bind product and immutable snapshots to original invoice item |
| FIN-08 / Phase 3 purchase returns | Unrelated product and client cost 999 return 201 | Bind product, quantity and valuation to the referenced purchase |
| FIN-09 / Phase 2 idempotency | Repeated idempotency key creates separate invoices | Phase 2 passes: durable request identity, atomic replay and concurrent one-effect coverage |

Existing oversale rejection and append-only customer-ledger safeguards pass and
must remain enforced. The suite is not exhaustive; passing it later does not
replace reconciliation or operator approval.

| Other blocker / owner | Required evidence |
|---|---|
| Document delivery / security owner | Invoice and report PDFs, supplier upload and retrieval are disabled. Verify isolated renderer, denied network/JavaScript, bounded resources and a safe attachment pipeline before a future reviewed change enables them |
| Cashier billing / future rollout + business owner | Only catalog read is assigned. Authoritative quantities/cost snapshots, redacted DTO contracts and explicit approved privileges are prerequisites |
| Historical secrets / operator | Locally verified disclosures; revoke/rotate affected credentials and invalidate sessions without printing values. Cleanup is not proof of rotation |
| Live HTTPS/DB TLS/networking / operator | Verify real certificates/hostnames, HTTP redirect, browser cookies, exact proxy subnet, private API/DB/Redis reachability and DB role grants |
| Release governance / operator | Configure protected branch/checks and approval outside this repository. Pin one immutable revision for both application artifacts; no push-triggered production deploy |
| Recovery / operator | Backups and restore rehearsal on a copy, historical schema verification and approved forward migration plan |
| Remaining tooling/advisories | See PHASE-1-REPORT and ENVIRONMENT-EVIDENCE for measured image/runtime gates and dependency advisory reachability |

Read-only diagnostics are in `db/reconciliation/phase-2.sql`. Their output is not a
repair script. No historical business data was read or changed in this phase.
