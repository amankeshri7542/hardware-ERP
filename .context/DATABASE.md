> Phase 2 billing/payment behavior is defined in ../docs/BILLING-PAYMENT-CONTRACT.md
> and verified in ../docs/PHASE-2-REPORT.md. Billing/payment descriptions below are
> historical: client cost/base quantity is not authoritative, sales do not change
> catalog prices, and invoice/payment mutations require durable operation keys.
> Cashier billing, PDFs and attachments remain disabled.

> Historical reference. Phase 1 changes and verified behavior are documented in
> ../docs/PHASE-1-REPORT.md and ../docs/SECURITY-RUNBOOK.md. Old auth, PDF, upload,
> deployment and setup descriptions below are superseded. Do not use historical credentials.

# Database Schema

> Last updated: 2026-04-17
> PostgreSQL 15 on AWS RDS (ap-south-1). Extension: `pg_trgm` for fuzzy search.

## Core Tables

### users
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| name | VARCHAR(100) | |
| email | VARCHAR(255) UNIQUE | Login identifier |
| password_hash | TEXT | bcrypt cost 12 |
| role | VARCHAR(20) | Always 'admin' currently |
| is_active | BOOLEAN | Soft delete flag |

### customers
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| name | VARCHAR(200) | |
| phone | VARCHAR(15) UNIQUE | |
| email | VARCHAR(255) | Optional |
| address | TEXT | |
| business_name | VARCHAR(200) | |
| gstin | VARCHAR(15) | |
| type | VARCHAR(20) | 'retail' or 'wholesale' |
| outstanding_balance | NUMERIC(12,2) | Auto-synced by trigger |
| is_active | BOOLEAN | Soft delete |

### products
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| name | VARCHAR(200) | |
| category | VARCHAR(100) | Hardware, Plumbing, Electrical, Paint, Tools, Adhesive |
| brand | VARCHAR(100) | |
| sku | VARCHAR(50) UNIQUE | |
| barcode | VARCHAR(50) UNIQUE | |
| unit | VARCHAR(20) | Base unit: piece, kg, meter, etc. |
| hsn_code | VARCHAR(20) | GST HSN code |
| gst_rate | NUMERIC(5,2) | Default GST % |
| mrp | NUMERIC(12,2) | Maximum retail price |
| wholesale_price | NUMERIC(12,2) | |
| purchase_price | NUMERIC(12,2) | Current cost price |
| current_stock | NUMERIC(12,3) | In base units |
| min_stock | NUMERIC(12,2) | Low stock threshold |
| is_active | BOOLEAN | Soft delete |

### invoices
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| invoice_no | VARCHAR(30) UNIQUE | Auto: RETAIL-2026-00001 |
| customer_id | INT FK | NULL for quickbill |
| customer_name_walkin | VARCHAR(100) | Walk-in name (quickbill) |
| bill_type | VARCHAR(20) | retail, wholesale, quickbill |
| date | TIMESTAMP | |
| subtotal | NUMERIC(12,2) | rate × qty |
| discount_total | NUMERIC(12,2) | |
| taxable_total | NUMERIC(12,2) | After discount |
| gst_total | NUMERIC(12,2) | |
| grand_total | NUMERIC(12,2) | **Negative for credit notes** |
| total_cost | NUMERIC(12,2) | Sum of cost snapshots |
| profit_amount | NUMERIC(12,2) | |
| profit_pct | NUMERIC(5,2) | |
| amount_paid | NUMERIC(12,2) | Clamped to grand_total |
| balance_due | NUMERIC(12,2) | grand_total - amount_paid |
| due_date | DATE | For partial payments |
| status | VARCHAR(20) | paid, partial, unpaid |
| pdf_status | VARCHAR(20) | pending, ready, failed |
| pdf_url | TEXT | S3 key |
| created_by | INT FK → users | |

### invoice_items
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| invoice_id | INT FK | |
| product_id | INT FK | |
| product_name_snapshot | VARCHAR(200) | Frozen at billing |
| hsn_snapshot | VARCHAR(20) | |
| qty | NUMERIC(12,3) | Display quantity |
| unit | VARCHAR(20) | Display unit |
| alt_qty | NUMERIC(12,3) | Alternate unit qty (e.g., 2 for "2 boxes") |
| alt_unit | VARCHAR(20) | Alternate unit name (e.g., "box") |
| base_qty | NUMERIC(12,3) | Qty in base units for stock deduction |
| rate | NUMERIC(12,2) | Price per unit |
| discount_pct | NUMERIC(5,2) | |
| discount_amount | NUMERIC(12,2) | |
| taxable_amount | NUMERIC(12,2) | |
| gst_pct | NUMERIC(5,2) | |
| gst_amount | NUMERIC(12,2) | |
| line_total | NUMERIC(12,2) | |
| cost_price_snapshot | NUMERIC(12,2) | **Immutable** — frozen at billing |
| line_profit | NUMERIC(12,2) | |
| qty_returned | NUMERIC(12,3) DEFAULT 0 | Cumulative returned qty |

### payments
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| invoice_id | INT FK | |
| amount | NUMERIC(12,2) | Guarded: cannot exceed balance_due |
| mode | VARCHAR(20) | cash, upi, bank, cheque |
| reference_no | VARCHAR(100) | UPI ref, cheque no, etc. |
| payment_date | DATE | |
| created_by | INT FK → users | |

### stock_ledger (APPEND-ONLY)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| product_id | INT FK | |
| date | TIMESTAMP | |
| movement_type | VARCHAR(20) | in, out, return_in, return_out, adjustment |
| reference_id | INT | Invoice/purchase ID |
| reference_type | VARCHAR(20) | invoice, purchase, return, adjustment |
| qty_in | NUMERIC(12,3) | |
| qty_out | NUMERIC(12,3) | |
| stock_after | NUMERIC(12,3) | Running balance |
| notes | TEXT | |
| created_by | INT FK → users | |

### customer_ledger (APPEND-ONLY)
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| customer_id | INT FK | |
| date | TIMESTAMP | |
| entry_type | VARCHAR(20) | invoice, payment, return |
| reference_id | INT | |
| reference_type | VARCHAR(20) | |
| debit | NUMERIC(12,2) | Invoice amounts |
| credit | NUMERIC(12,2) | Payments, returns |
| balance | NUMERIC(12,2) | |
| description | TEXT | |

### suppliers
Standard fields: id, name, phone, email, address, gstin, is_active.

### purchases / purchase_items
Purchase orders with items, stock-in via stock_ledger.

### purchase_returns / purchase_return_items
Returns against purchases, with debit notes.

### product_unit_conversions
| Column | Type | Notes |
|--------|------|-------|
| id | SERIAL PK | |
| product_id | INT FK | |
| unit_name | VARCHAR(20) | e.g., 'box', 'bag' |
| conversion_value | NUMERIC(12,3) | 1 box = 12 pieces → value=12 |
| is_purchase_unit | BOOLEAN | |
| is_sales_unit | BOOLEAN | |

### product_price_history
Tracks MRP/wholesale/cost price changes over time.

### settings
Key-value store for shop config (name, address, GSTIN, phone).

## Sequences (Auto Invoice Numbering)
- `retail_invoice_seq` → RETAIL-YYYY-NNNNN
- `wholesale_invoice_seq` → WHOLE-YYYY-NNNNN
- `quickbill_invoice_seq` → QB-YYYY-NNNNN
- `purchase_return_seq` → PR-YYYY-NNNNN
- `debit_note_seq` → DN-YYYY-NNNNN

## Critical Triggers

### fn_prevent_ledger_modify
Blocks UPDATE and DELETE on `stock_ledger` and `customer_ledger`. Raises exception. Ledgers are truly append-only.

### fn_sync_customer_outstanding
Fires AFTER INSERT on `customer_ledger`. Recalculates `customers.outstanding_balance` as `SUM(debit) - SUM(credit)`.

### fn_auto_invoice_no
Fires BEFORE INSERT on `invoices`. Generates sequential invoice number based on bill_type.

## Indexes
- GIN trigram index on `products.name` for fuzzy search
- B-tree on `invoices.customer_id`, `invoices.date`, `invoices.status`
- B-tree on `stock_ledger.product_id`, `customer_ledger.customer_id`
- UNIQUE on `products.sku`, `products.barcode`, `customers.phone`
