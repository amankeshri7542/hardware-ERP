# CLAUDE.md — UMA Enterprises ERP

## Quick Orientation

**Project:** Hardware & Building Materials ERP for a single-location shop in Bihar, India
**Stack:** Node.js + Express | React 18 + Ant Design 5 | PostgreSQL 15 (AWS RDS)
**Operational status:** unverified; Phase 1 is a local candidate, not production approval.
**Scale:** ~100-150 invoices/day, 2-3 users, single admin role
**Last updated:** 2026-04-20

Handles: retail/wholesale billing, inventory, customer ledgers (khata), payments, PDF invoices, GST reports, Excel exports, purchase management, sales returns, unit conversions.

## Detailed Documentation

All detailed docs live in `hardware-erp/.context/`:

| File | Contents |
|------|----------|
| [ARCHITECTURE.md](.context/ARCHITECTURE.md) | System design, infra, data flows, PDF pipeline |
| [DATABASE.md](.context/DATABASE.md) | All tables, columns, constraints, triggers, indexes |
| [API.md](.context/API.md) | Every endpoint by module with params & responses |
| [MODULES.md](.context/MODULES.md) | Backend service functions, business logic, patterns |
| [FRONTEND.md](.context/FRONTEND.md) | Routes, hooks, keyboard shortcuts, billing flow |
| [SECURITY.md](.context/SECURITY.md) | Auth, security headers, rate limiting, known gaps |
| [KNOWN_ISSUES.md](.context/KNOWN_ISSUES.md) | Bugs, TODOs, technical debt, future enhancements |
| [CHANGELOG.md](.context/CHANGELOG.md) | All phases and changes through April 2026 |
| [QUICKSTART.md](.context/QUICKSTART.md) | 10-minute dev onboarding guide |

## Repository Layout

```
hardware-erp/
├── backend/src/
│   ├── app.js                    # Express setup (Helmet, CORS, routes)
│   ├── config/                   # db.js, aws.js, redis.js
│   ├── middleware/               # Session/capability auth, errors, validation
│   ├── modules/                  # 11 modules (see below)
│   ├── workers/pdfWorker.js      # BullMQ PDF consumer
│   ├── templates/                # invoice-a4.html, invoice-thermal.html
│   └── utils/                    # s3.js, pdf.js, asyncHandler.js
├── frontend/src/
│   ├── App.jsx                   # All routes (28 routes)
│   ├── pages/                    # Billing, Invoices, Customers, Products, etc.
│   ├── hooks/                    # useBilling.js, useProductSearch.js
│   ├── store/authStore.js        # Zustand auth state
│   ├── api/                      # One file per module (axios-based)
│   ├── components/               # AppLayout, ProductSearch, PWAInstallButton, etc.
│   └── utils/                    # billing.calculations.js, formatCurrency.js
├── db/migrations/                # historical SQL + forward migrations; use tracked runner
├── db/seeds/                     # Admin user, test data
├── .context/                     # Detailed documentation (9 files)
└── deploy/                       # deploy.sh, nginx.conf
```

### Module Pattern (every backend module)
```
modules/{name}/
├── {name}.router.js        # Routes only
├── {name}.controller.js    # req/res only — no DB, no business logic
├── {name}.service.js       # All business logic + DB queries
└── {name}.validation.js    # express-validator schemas
```

**Modules:** auth, products, customers, invoices, payments, purchases, suppliers, reports, dashboard, settings

## Historical local-development notes (superseded by docs/LOCAL-DEVELOPMENT.md)

```bash
# Backend (reads .env.local → local PostgreSQL)
cd hardware-erp/backend && npm run dev   # port 4000

# Frontend (reads .env.local → proxy to localhost:4000)
cd hardware-erp/frontend && npm run dev  # port 5173
```

**Key env files (all gitignored):**
- `backend/.env` — production (AWS RDS, S3, JWT secrets)
- `backend/.env.local` — local dev (localhost PostgreSQL)
- `frontend/.env` — production API URL
- `frontend/.env.local` — local dev (Vite proxy)

## Phase 1 engineering baseline

Use `docs/LOCAL-DEVELOPMENT.md`, `docs/PHASE-1-REPORT.md` and
`docs/SECURITY-RUNBOOK.md` for current setup and measured evidence. The earlier
`.context` module descriptions are historical reference where marked.

- Installs use tracked locks and `npm ci` with the pinned Node LTS.
- Apply migrations only with the checksum/advisory-lock runner. Never reset an
  existing database or automatically mark its schema as applied.
- Browser authentication uses a revocable HttpOnly opaque session; no bearer
  persistence or financial-request retries.
- PDFs and supplier attachments are disabled server-side pending containment
  verification. Do not add a runtime bypass.
- Production deployment from ordinary pushes is removed. Financial desired-
  behavior regressions and operator actions block release. No Phase 2 repair is
  included in this candidate.

## 5 Absolute Rules — Never Break These

### 1. Invoice creation is ONE atomic transaction
All 10 steps (lock products → insert invoice → insert items → update stock → ledger entries → payment) run inside a single `BEGIN...COMMIT`. If any step fails → `ROLLBACK` everything. No partial saves. Ever.

### 2. Ledgers are append-only
`stock_ledger` and `customer_ledger` cannot be UPDATED or DELETED — DB triggers enforce this. Every stock change creates a ledger entry. `customers.outstanding_balance` is auto-synced by trigger after each ledger INSERT.

### 3. Cost snapshots are immutable
`invoice_items.cost_price_snapshot` is frozen at billing time. Never recalculate old invoice profit from current `purchase_price`. Never expose `purchase_price`, `cost_price_snapshot`, `profit_amount`, `profit_pct`, or `line_profit` on customer-facing PDFs.

### 4. Billing calculations must match client and server
`frontend/src/utils/billing.calculations.js` and `backend/src/modules/invoices/invoices.service.js` both compute line items and totals. They must produce identical results. Change one → change the other.

### 5. Product search must return all billing fields
Every product search/lookup must include: `id, name, sku, barcode, unit, mrp, wholesale_price, purchase_price, current_stock, gst_rate, hsn_code`. Missing `gst_rate` → GST calculated as 0%. Missing `purchase_price` → profit calculated as 100%.

## Coding Standards

- **No `SELECT *`** — always list columns
- **No raw SQL interpolation** — always `$1, $2` parameterized queries
- **No business logic in controllers** — service layer only
- **No client-side Excel** — server-side ExcelJS only
- **Soft deletes only** — `is_active = false`, never hard-delete customers/products
- **NUMERIC(12,2)** for money in DB — never floating point
- **Ant Design 5 only** — no Tailwind, shadcn, Material UI
- **snake_case in DB/API** — frontend uses DB column names as-is
- **Don't build on EC2** — t3.micro can't handle Vite builds (CI/CD builds on GitHub runner)

## Key Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| INSUFFICIENT_STOCK | 422 | Stock check failed |
| DUPLICATE_SKU/BARCODE/PHONE | 409 | Unique constraint violation |
| INVOICE/PRODUCT/CUSTOMER_NOT_FOUND | 404 | Not found |
| PDF_NOT_READY | 202 | PDF still generating |
| RATE_LIMIT | 429 | Too many login attempts |
| RETURN_QTY_EXCEEDS_ORIGINAL | 422 | Return qty > remaining returnable qty |
| PAYMENT_EXCEEDS_BALANCE | 422 | Payment amount > invoice balance due |
| INVOICE_ALREADY_PAID | 422 | Invoice has no remaining balance |
