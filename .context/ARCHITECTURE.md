> Historical reference. Phase 1 changes and verified behavior are documented in
> ../docs/PHASE-1-REPORT.md and ../docs/SECURITY-RUNBOOK.md. Old auth, PDF, upload,
> deployment and setup descriptions below are superseded. Do not use historical credentials.

# Architecture

> Last updated: 2026-04-20

## System Overview

Single-location hardware shop ERP in Bihar, India. ~100-150 invoices/day, 2-3 users.

```
Browser (React SPA)
    │ HTTP :80
    ▼
Nginx (reverse proxy + static files)
    ├── /* static  →  /var/www/hardware-erp/frontend/dist/
    └── /api/*     →  Express.js :4000 (PM2: erp-api)
                            │
                    ┌───────┼───────┐
                    ▼       ▼       ▼
                PostgreSQL  Redis   S3
                (RDS)     (BullMQ) (PDFs)
                                    ▲
                            PDF Worker (PM2: erp-pdf-worker)
                            Puppeteer → S3 upload
```

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18 + Ant Design 5 + Zustand |
| Backend | Express.js 4.18 + Helmet + CSP + express-rate-limit |
| Database | PostgreSQL 15 (AWS RDS, ap-south-1) |
| Queue | BullMQ + Redis (ioredis) |
| PDF | Puppeteer 22 (headless Chrome) |
| Storage | AWS S3 v3 SDK (`uma-erp-storage`) |
| Auth | JWT + bcrypt (cost 12) |
| Excel | ExcelJS 4.4 (server-side only) |
| Process | PM2 (2 processes: erp-api, erp-pdf-worker) |
| Proxy | Nginx |

## Infrastructure

| Component | Details |
|-----------|---------|
| EC2 | t3.micro (2 vCPU, 1GB RAM, unlimited burst), ap-south-1a, Ubuntu 24.04, Elastic IP 13.204.240.166 |
| Swap | 1GB swapfile on EBS (`/swapfile`) — prevents OOM during PDF generation |
| RDS | PostgreSQL 15, db.t3.micro, single-AZ |
| S3 | `uma-erp-storage`, private, pre-signed URLs (1hr) |
| SSL | **None yet** — HTTP only. Needs domain + Let's Encrypt |

## Backend Module Pattern

Every module follows:
```
modules/{name}/
├── {name}.router.js        # Route definitions + middleware
├── {name}.controller.js    # Parse req → call service → send res
├── {name}.service.js       # Business logic + DB queries (parameterized)
└── {name}.validation.js    # express-validator schemas
```

**11 modules:** auth, products, customers, invoices, payments, purchases, suppliers, reports, exports, dashboard, settings

### Request Pipeline
```
Request → Helmet → CORS → Cookie Parser → JWT Auth → Validation → Controller → Service → DB → Response
```

Login endpoint has rate limiting: 5 attempts per 15 minutes per IP.
Global API rate limit: 200 requests per minute per IP.

## Operations

| Component | Detail |
|-----------|--------|
| PM2 log rotation | pm2-logrotate: 10MB max/file, 3 files retained, compressed |
| System journal | Vacuumed to 50MB on each deploy |
| PM2 memory limits | API: 400MB, Worker: 300MB (auto-restart on exceed) |
| Swap | 1GB swapfile — safety net for Puppeteer/Chromium memory spikes |
| CI/CD | GitHub Actions: build frontend on runner → SCP → git pull → pm2 restart |

## Invoice Creation Flow (10-Step Atomic Transaction)

```
BEGIN
  1. Calculate totals (pure function, no side effects)
  2. Resolve unit conversions (alt_unit → base_qty via product_unit_conversions)
  3. Lock products (SELECT ... FOR UPDATE — prevents race conditions)
  4. Validate stock availability (fail fast if insufficient)
  5. INSERT invoice header (auto-numbering: RETAIL-2026-00001)
  6. INSERT invoice_items (cost_price_snapshot frozen here)
  7. UPDATE products.current_stock (decrement by base_qty or qty)
  8. INSERT stock_ledger (movement_type = 'out', append-only)
  9. INSERT customer_ledger DEBIT (invoice amount)
  10. INSERT payment + customer_ledger CREDIT (amount paid)
COMMIT
  → Queue async PDF generation via BullMQ
```

Any failure → full ROLLBACK. No partial invoices.

## PDF Generation Pipeline

```
Invoice Created → BullMQ Queue → PDF Worker (separate process)
  → Fetch invoice + items from DB
  → Render HTML template (invoice-a4.html or invoice-thermal.html)
  → Puppeteer: HTML → PDF buffer
  → Upload to S3
  → UPDATE invoices SET pdf_status='ready', pdf_url=s3_key
Frontend polls /invoices/:id/pdf-status every 2s
When ready → /invoices/:id/pdf → pre-signed S3 URL (1hr expiry)
```

Templates support alt_qty display: "2 Box (24 Pcs)" format in Qty column.
Fallback: if Redis unavailable, generates PDF synchronously in API process.

## Unit Conversion System

Products have base unit (e.g., `piece`) + optional conversions (e.g., `1 box = 12 pieces`).

- **Storage:** Always base units in `current_stock` and `stock_ledger`
- **Billing:** User selects unit in dropdown → `base_qty = alt_qty × conversion_value`
- **Invoice items:** Stores `qty`, `alt_qty`, `alt_unit`, `base_qty`
- **PDF:** Shows "2 Box (24 Pcs)" when alt_unit present
- **Products list/detail:** Shows base stock + box equivalent

## Sales Returns (Credit Notes)

- Creates new invoice with **negative** `grand_total`
- `SUM(grand_total)` in reports automatically accounts for returns
- Stock restored via stock_ledger (movement_type = 'return_in')
- `invoice_items.qty_returned` tracks cumulative returns per line
- Prevents duplicate returns: `requested + already_returned ≤ original_qty`
- Only reduces `balance_due` on original, never modifies `grand_total`

## Frontend Architecture

- SPA served by nginx, all non-API routes → index.html
- 28 routes in React Router v6
- Zustand for auth state only (token + user in memory)
- Ant Design 5 for ALL UI components — no other CSS frameworks
- Keyboard-first billing: F2=QuickBill, F4=PayFull, F9=Submit, Esc=Clear
- PWA manifest present (needs HTTPS + service worker to activate)
- Billing calculations in `utils/billing.calculations.js` must match backend
