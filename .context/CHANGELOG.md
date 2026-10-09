> Historical reference. Phase 1 changes and verified behavior are documented in
> ../docs/PHASE-1-REPORT.md and ../docs/SECURITY-RUNBOOK.md. Old auth, PDF, upload,
> deployment and setup descriptions below are superseded. Do not use historical credentials.

# Changelog

> Last updated: 2026-04-17

## Phase 1 — Foundation (March 2026)

**Core system setup and basic operations.**

- PostgreSQL 15 schema: users, customers, products, invoices, invoice_items, payments, payment_modes_detail, stock_ledger, customer_ledger, purchases, purchase_items
- pg_trgm extension for fuzzy product search
- DB triggers: auto invoice numbering, negative stock prevention, append-only ledgers, customer outstanding sync
- Sequences: retail, wholesale, quickbill invoice numbering
- Express.js API with module pattern (router → controller → service → validation)
- JWT authentication (access token 8h + refresh token 30d httpOnly cookie)
- Product CRUD with fuzzy name search + barcode lookup
- Customer CRUD with phone validation + ledger
- Invoice creation (10-step atomic transaction)
- Payment recording (single + mixed mode)
- Purchase orders with stock-in
- PDF generation: Puppeteer HTML → PDF → S3 upload
- BullMQ queue for async PDF (fallback: sync if no Redis)
- React 18 + Ant Design 5 + Vite SPA
- Billing page with keyboard-first UX (F2, F4, F9, Esc shortcuts)
- Dashboard with summary stats, recent activity
- Invoice, customer, product list + detail pages
- Deployed: EC2 t2.micro + RDS PostgreSQL + S3 + nginx + PM2
- Migrations: 001 (schema), 002 (triggers/functions)
- Seeds: admin user, 55+ products, 18 customers, 10 suppliers, 6 sample invoices

## Phase 2 — Reports & Exports (March 2026)

**7 report types with server-side Excel export.**

- Sales, GST, Stock, Stock Movement, Customer Dues, Profit, Collections reports
- Server-side ExcelJS exports (frozen headers, auto-width, currency formatting)
- Full data export (multi-sheet workbook: Customers, Products, Invoices, Items, Payments, Ledger)
- Report pages with date range filters, summary cards, data tables, export buttons
- Product categories endpoint for filter dropdowns

## Phase 3 — Purchase Management (March-April 2026)

**Purchase orders, returns, and supplier debit notes.**

- Suppliers CRUD (name, phone, GSTIN, payment terms)
- Purchase order creation with automatic stock-in
- PO auto-numbering (PO-YYYYMMDD-XXXX)
- Purchase items auto-update product.purchase_price
- Purchase returns with quantity validation
- Supplier debit notes (auto-numbered DN-YYYY-NNNNN)
- Migration: 005 (purchase_returns, debit_notes)

## Phase 4 — Product Enhancements (April 2026)

**Unit conversions, price history, supplier linking.**

- Unit conversion system: base unit + alt units (e.g., 1 box = 12 pieces)
- `product_unit_conversions` table with conversion_value, is_purchase_unit, is_sales_unit
- Unit dropdown in billing: auto-calculates base_qty from alt_qty × conversion_value
- Price history tracking: MRP, wholesale, cost changes with source (manual|billing|purchase)
- Product-supplier linking via `product_suppliers` table (last_price, is_primary_supplier)
- Product detail: price history SVG chart, stock card with conversion breakdown
- Settings table (key-value store for shop config)
- Migrations: 003 (settings), 004 (unit_conversions, price_history, product_suppliers)

## Phase 5 — Sales Returns / Credit Notes (April 2026)

**Invoice returns with stock restoration.**

- Sales return creates credit note (invoice with negative grand_total)
- Stock restored via stock_ledger (movement_type = 'return_in')
- Customer ledger credit entry for return amount
- Original invoice balance_due reduced (never modifies grand_total)
- Prevents duplicate returns: requested + already_returned ≤ original_qty
- Return modal in InvoiceDetailPage
- SUM(grand_total) in reports automatically accounts for returns

## Phase 6 — Bug Fixes & Full Audit (April 5, 2026)

**Systematic audit of all pages and services.**

- InvoiceDetailPage: 12+ field name mismatches fixed (₹NaN → correct values)
  - `payment_status` → `status`, `total_taxable` → `taxable_total`, nested `customer.name` → flat `customer_name`
- All 7 report pages: camelCase → snake_case alignment with backend
- reports.service.js: removed camelCase mapping — returns raw DB columns
- invoices.service.js: added profit_amount to listInvoices, added summary query
- products.service.js: stock adjustment wrapped in transaction, deleteUnitConversion fixed
- Removed unused quick pick/frequent products code
- Created `.context/` documentation folder (9 files)

## Phase 7 — Security, UX & Infrastructure (April 10-17, 2026)

### Security Hardening (April 17)
- Helmet security headers (X-Frame-Options, X-Content-Type-Options, etc.)
- Login rate limiting: 5 attempts per 15 minutes per IP (express-rate-limit)
- Password policy: min 8 chars, uppercase, number, special character
- Invoice items array capped at 500 (DoS prevention)
- Error handler hides DB column/constraint details in production
- multer 1.x → 2.x security upgrade
- bcrypt 5.x → 6.x (0 vulnerabilities)

### Duplicate Return Prevention (April 17)
- Added `invoice_items.qty_returned` column (cumulative tracking)
- Return validation: `requested + already_returned ≤ original_qty`
- Error code: RETURN_QTY_EXCEEDS_ORIGINAL
- Migration: 009 (qty_returned)

### Unit Conversion Display (April 17)
- PDF templates show "2 Box (24 Pcs)" in qty column when alt_unit present
- `buildItemRows()` + `buildThermalItemRows()` in pdf.js
- Templates use `{{ITEM_ROWS}}` placeholder instead of loop syntax
- Products list: stock column shows base qty + box equivalent below
- Product detail: stock card with conversion breakdown

### PWA Support (April 17)
- manifest.json: app name, icons, display: standalone
- PWAInstallButton component in AppLayout header
- Placeholder icons (192px + 512px)
- Meta tags in index.html (theme-color, manifest link)
- Requires HTTPS + service worker to activate (not yet available)

### Auth & Purchases (April 10-11)
- Auth: localStorage token persistence (fixes auto-logout on refresh)
- Purchases: invoice file upload (multer, S3/local), notes editing
- Auto-link products to suppliers on purchase creation (UPSERT)
- Billing UX: unit dropdown, editable GST%, Tab flow
- Supplier: search bar, fixed detail page, products/debit-notes display
- Startup env-var validation in server.js
- Migration: 007 (purchase_return_seq), 008 (purchase invoice upload)

### Bug Fixes (April 10-11)
- Return 422: removed invalid body field requirements from schema
- Dashboard: Spin tip warning, Card bodyStyle deprecated prop
- Quick Bill 422: fixed validation for quickbill without customer_id
- Product search: missing search param passthrough
- Auth refresh loop: skip 401 redirect on /auth/refresh

## Migration Summary

| # | File | Description |
|---|------|-------------|
| 001 | initial_schema.sql | Core tables, indexes, sequences |
| 002 | triggers_and_functions.sql | Append-only triggers, auto invoice numbering, outstanding sync |
| 003 | settings.sql | Settings key-value table |
| 004 | unit_conversions_and_price_history.sql | Unit conversions, price history, product-supplier links |
| 005 | purchase_returns_and_debit_notes.sql | Purchase returns, debit notes |
| 006 | invoice_items_alt_qty.sql | alt_qty, alt_unit, base_qty on invoice_items |
| 007 | missing_sequences.sql | purchase_return_seq, auto return numbering |
| 008 | purchase_invoice_upload.sql | notes + invoice_file_url on purchases |
| 009 | invoice_items_qty_returned.sql | qty_returned column for duplicate return prevention |
