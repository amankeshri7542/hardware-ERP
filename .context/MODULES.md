> Phase 2 billing/payment behavior is defined in ../docs/BILLING-PAYMENT-CONTRACT.md
> and verified in ../docs/PHASE-2-REPORT.md. Billing/payment descriptions below are
> historical: client cost/base quantity is not authoritative, sales do not change
> catalog prices, and invoice/payment mutations require durable operation keys.
> Cashier billing, PDFs and attachments remain disabled.

> Historical reference. Phase 1 changes and verified behavior are documented in
> ../docs/PHASE-1-REPORT.md and ../docs/SECURITY-RUNBOOK.md. Old auth, PDF, upload,
> deployment and setup descriptions below are superseded. Do not use historical credentials.

# Backend Modules — Business Logic & Patterns

> Last updated: 2026-04-17

## Module Structure Convention

Every module in `backend/src/modules/{name}/`:
```
{name}.router.js       — Route definitions + middleware chain
{name}.controller.js   — req/res handling, calls service, sends JSON
{name}.service.js      — Business logic + all DB queries
{name}.validation.js   — express-validator schemas
```

**Rules:** Controllers never access the DB. Services never touch req/res.

---

## Auth Module (Phase 1)

Opaque sessions are persisted as HMAC digests with eight-hour expiry. Logout,
account deactivation and password changes revoke access; concurrent session reads
do not rotate credentials. Capability checks run before all business routes and
cashier catalog responses are redacted. See the security runbook and security tests.

## Products Module

**Files:** `products/products.router.js`, `products.controller.js`, `products.service.js`, `products.search.service.js`, `products.validation.js`

### Key Service Functions
- `getAllProducts({search, category, isActive, lowStockOnly, page, limit})` — Filtered list with pagination. Includes `unit_conversions` JSON array per product via subquery
- `getProductById(id)` — Single product lookup
- `createProduct(data)` — INSERT with 23505 duplicate handling (DUPLICATE_SKU/DUPLICATE_BARCODE)
- `updateProduct(id, data, userId)` — Dynamic UPDATE (only fields present in `data`). If `current_stock` changes: uses transaction, SELECT FOR UPDATE, creates stock_ledger adjustment entry
- `softDeleteProduct(id)` — Sets `is_active = false`. Blocked if product has invoice_items history (PRODUCT_HAS_HISTORY)
- `getProductStockLedger(productId, filters)` — Paginated ledger with date range
- `getLowStockProducts()` — Products where current_stock < min_stock
- `getProductPriceHistory(productId)` — Price change history
- `getProductSuppliers()` / `linkProductSupplier()` — Product-supplier links via `product_suppliers` table
- `getUnitConversions()` / `createUnitConversion()` / `deleteUnitConversion()` — Alt unit management

### Search Service (`products.search.service.js`)
- `searchByName(query, limit)` — pg_trgm similarity + ILIKE, max 8 results, sorted by similarity score
- `searchByBarcode(code)` — Exact B-tree lookup, single result
- **Critical:** All search responses must include `id, name, sku, barcode, unit, mrp, wholesale_price, purchase_price, current_stock, gst_rate, hsn_code` — billing breaks without them

---

## Invoices Module — The Most Critical Code

**Files:** `invoices/invoices.router.js`, `invoices.controller.js`, `invoices.service.js`, `invoices.validation.js`

### Invoice Creation — 10-Step Atomic Transaction

`createInvoice(data, userId)` runs all steps in a single `BEGIN...COMMIT`:

1. **Resolve unit conversions** — For items with `alt_unit`: look up `conversion_value` from `product_unit_conversions`, compute `base_qty = alt_qty × conversion_value`
2. **Calculate totals** — Pure function: `calculateInvoiceTotals(items)`
3. **Lock products** — `SELECT id, current_stock FROM products WHERE id IN (...) FOR UPDATE` — prevents race conditions
4. **Validate stock** — Check each item's `base_qty` (or `qty`) against `current_stock`. Fail with INSUFFICIENT_STOCK listing all failures
5. **INSERT invoice header** — Trigger `fn_auto_invoice_no` auto-generates: RETAIL-YYYY-NNNNN, WHOLE-YYYY-NNNNN, or QB-YYYY-NNNNN
6. **INSERT invoice_items** — `cost_price_snapshot` frozen here. Also stores `alt_qty`, `alt_unit`, `base_qty`
7. **UPDATE products.current_stock** — Decrement by `base_qty` (or `qty` if no alt unit)
8. **INSERT stock_ledger** — movement_type = 'out', qty_out = base_qty, records `stock_after`
9. **INSERT customer_ledger DEBIT** — (if not quickbill) Invoice amount. Trigger syncs `customers.outstanding_balance`
10. **INSERT payment + customer_ledger CREDIT** — (if amount_paid > 0) Payment record + modes_detail

**After COMMIT:** Queue PDF job via BullMQ (Redis). Fallback: synchronous Puppeteer if Redis unavailable.

### Bill Types
| Type | Default Pricing | Customer Required |
|------|----------------|------------------|
| retail | MRP | Yes |
| wholesale | Wholesale price | Yes (should have GSTIN) |
| quickbill | MRP | No (optional walk-in name) |

### Line Item Calculation
```
discount_amount = rate × (discount_pct / 100)
taxable_amount  = (rate - discount_amount) × qty
gst_amount      = taxable_amount × (gst_pct / 100)
line_total      = taxable_amount + gst_amount
line_profit     = (rate - discount_amount - cost_price_snapshot) × qty
```

### Sales Returns — `processReturn(invoiceId, data, userId)`

Single atomic transaction:
1. **Fetch original invoice items** — includes `qty_returned` (cumulative)
2. **Validate quantities** — `requested + already_returned ≤ original_qty`. Error: RETURN_QTY_EXCEEDS_ORIGINAL
3. **INSERT credit note** — New invoice with negative `grand_total`
4. **INSERT return items** — Mirror of original items with return quantities
5. **UPDATE original `invoice_items.qty_returned`** — Increment by returned amount
6. **UPDATE products.current_stock** — Increment (restore stock)
7. **INSERT stock_ledger** — movement_type = 'return_in'
8. **UPDATE original invoice** — Reduce `balance_due` (never modify `grand_total`)
9. **INSERT customer_ledger CREDIT** — Return amount

### Other Functions
- `listInvoices(filters)` — Paginated with summary: total_sales, total_gst, total_profit
- `getInvoiceById(id)` — Full invoice + items (includes alt_qty, alt_unit, base_qty, qty_returned) + payments + flat customer fields
- `getPdfStatus()` / `getPresignedPdfUrl()` / `regeneratePdf()` — PDF lifecycle

---

## Payments Module

**Files:** `payments/payments.router.js`, `payments.controller.js`, `payments.service.js`, `payments.validation.js`

- `recordPayment(data, userId)` — Atomic transaction:
  1. Validate invoice exists, has balance_due > 0
  2. Cap amount to balance_due (PAYMENT_EXCEEDS_BALANCE / INVOICE_ALREADY_PAID)
  3. INSERT payment + modes_detail (if mixed)
  4. UPDATE invoice: amount_paid, balance_due, status
  5. INSERT customer_ledger credit → trigger syncs outstanding_balance
- `listAllPayments(filters)` — Paginated with customer/invoice info
- `getPaymentsByInvoice(invoiceId)` — All payments for specific invoice

---

## Purchases Module

**Files:** `purchases/purchases.router.js`, `purchases.controller.js`, `purchases.service.js`, `purchases.validation.js`

- `createPurchaseWithStockIn(data, userId)` — Atomic transaction:
  1. Generate PO number (PO-YYYYMMDD-XXXX)
  2. INSERT purchase + items
  3. For each item: UPDATE products.current_stock (increment) + UPDATE products.purchase_price
  4. Upsert `product_suppliers` link
  5. INSERT stock_ledger (movement_type = 'in')
- `getPurchases(filters)` / `getPurchaseById(id)` — List and detail
- `updatePurchaseNotes(id, notes)` — Update PO notes
- `createPurchaseReturn(purchaseId, data, userId)` — Atomic: INSERT return + items → UPDATE stock (decrement) → INSERT stock_ledger (return_out) → CREATE debit note (auto-numbered DN-YYYY-NNNNN)
- `uploadInvoiceFile(id, file)` — multer upload (5MB max, PDF/JPEG/PNG/WebP) to S3
- `getInvoiceFileUrl(id)` — Pre-signed S3 URL

---

## Customers Module

**Files:** `customers/customers.router.js`, `customers.controller.js`, `customers.service.js`, `customers.validation.js`

- `createCustomer(data)` — INSERT with phone uniqueness. Reactivates soft-deleted customer with same phone
- `updateCustomer(id, data)` — Dynamic partial update with phone uniqueness check
- `listCustomers(filters)` — Paginated with search, type, city, dues_filter (outstanding|paid|overdue)
- `searchCustomers(query)` — Name/phone prefix, max 10 results. Prioritizes exact phone match
- `deactivateCustomer(id)` — Blocked if outstanding_balance > 0
- `getCustomerLedger(customerId, filters)` — Paginated ledger entries
- `getCustomerSummary(customerId)` — Outstanding, total invoices, last invoice, total paid, last payment

---

## Suppliers Module

**Files:** Shared controller/service in `purchases/` module. Separate `suppliers.router.js`

- `createSupplier()`, `getSuppliers()`, `getSupplierById()`, `updateSupplier()` — Standard CRUD
- `getSupplierProducts(supplierId)` — Products linked via `product_suppliers` table
- `getSupplierDebitNotes(supplierId)` — Outstanding debit notes against supplier

---

## Reports Module

**Files:** `reports/reports.router.js`, `reports.service.js`, `exports.router.js`, `exports.service.js`, separate controllers

### Data Reports (`reports.service.js`)
All return raw snake_case DB column names (no camelCase mapping).

| Function | Key Return Shape |
|----------|-----------------|
| `getSalesReport()` | `{ invoices[], summary: {total_sales, total_gst, total_profit}, total, totalPages }` |
| `getGstReport()` | `{ invoices[], rate_summary: [{gst_pct, taxable_amount, cgst, sgst}] }` |
| `getStockReport()` | `{ products[], summary }` |
| `getStockMovementReport()` | `{ movements[], summary, pagination }` |
| `getCustomerDuesReport()` | `{ customers[], pagination }` |
| `getProfitReport()` | `{ invoices[], summary, pagination }` |
| `getPaymentCollectionsReport()` | `{ payments[], summary, pagination }` |
| `getProductCategories()` | String array |

### Excel Exports (`exports.service.js`)
Server-side ExcelJS workbook generation. Streamed as `Content-Disposition: attachment`.
- Frozen header row with blue background
- Auto-width columns
- `₹#,##0.00` for money, `DD-MM-YYYY` for dates
- Bold total/summary rows
- Full export: multi-sheet workbook (Customers, Products, Invoices, Items, Payments, Ledger)

---

## Dashboard Module

**Files:** `dashboard/dashboard.router.js`, `dashboard.controller.js`, `dashboard.service.js`

- `getDashboardSummary()` — today_sales, today_collections, total_outstanding, total_customers, total_products, low_stock_count, out_of_stock_count, outstanding_debit_notes_total/count
- `getSalesOverview({from, to})` — Daily sales chart data (default 30 days)
- `getOverdueInvoices()` — Unpaid/partial where due_date < today
- `getOverdueCustomers()` — Customers with outstanding > 0
- `getRecentActivity()` — Latest 10 invoices + payments
- `getPaymentModeBreakdown()` — Cash/UPI/bank/cheque split for current month

---

## Settings Module

**Files:** `settings/settings.router.js`, `settings.controller.js`, `settings.service.js`

- `getStoreSettings()` — Returns store config from env vars (name, address, phone, GSTIN)
- `getDatabaseStats()` — Record counts for all tables + DB size
