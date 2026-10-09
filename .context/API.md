> Phase 2 billing/payment behavior is defined in ../docs/BILLING-PAYMENT-CONTRACT.md
> and verified in ../docs/PHASE-2-REPORT.md. Billing/payment descriptions below are
> historical: client cost/base quantity is not authoritative, sales do not change
> catalog prices, and invoice/payment mutations require Idempotency-Key plus
> Idempotency-Actor headers bound to the original authenticated user.
> Cashier billing, PDFs and attachments remain disabled.

> Historical reference. Phase 1 changes and verified behavior are documented in
> ../docs/PHASE-1-REPORT.md and ../docs/SECURITY-RUNBOOK.md. Old auth, PDF, upload,
> deployment and setup descriptions below are superseded. Do not use historical credentials.

# API Reference

> Last updated: 2026-04-17

Base URL: `/api`. Private endpoints require the revocable HttpOnly session cookie.

## Response Format

```json
// Success
{ "success": true, "data": { ... } }

// Error
{ "success": false, "error": "Human-readable message", "code": "MACHINE_CODE" }
```

**Status codes:** 200 OK, 201 Created, 400 Bad Request, 401 Unauthorized, 404 Not Found, 409 Conflict, 422 Unprocessable Entity, 429 Too Many Requests, 500 Internal Server Error.

## Auth (Phase 1)

All private API routes require the HttpOnly session cookie. Login returns
`{success:true,data:{user:{id,name,role,capabilities}}}` without a bearer token.
`GET /auth/session` reads the current session; `POST /auth/refresh` is an idempotent
compatibility read and does not extend or rotate it. `POST /auth/logout` revokes it.
All unsafe API requests require an allowlisted Origin. Login is rate limited.
Cashier catalog responses use an explicit field allowlist; other capabilities are
unassigned. PDF and attachment routes return an explicit disabled response.

## Products

| Method | Path | Params/Body | Response |
|--------|------|-------------|----------|
| GET | `/products` | `?search&category&is_active&low_stock_only&page&limit` | `{ products[], pagination }` |
| POST | `/products` | Product fields | Created product |
| GET | `/products/:id` | — | Full product object |
| PUT | `/products/:id` | Partial update fields | Updated product |
| DELETE | `/products/:id` | — | Soft-delete (is_active=false). Blocked if invoice_items exist |
| GET | `/products/search` | `?q=&limit=8` or `?barcode=` | Product array (includes gst_rate, purchase_price, hsn_code) |
| GET | `/products/barcode/:code` | — | Single product or 404 |
| GET | `/products/low-stock` | — | Products where current_stock < min_stock |
| GET | `/products/:id/stock-ledger` | `?from&to&page&limit` | `{ entries[], total }` |
| GET | `/products/:id/price-history` | — | Price history array |
| GET | `/products/:id/suppliers` | — | Linked suppliers array |
| POST | `/products/:id/suppliers` | `{ supplier_id, last_price, is_primary_supplier }` | Upsert result |
| GET | `/products/:id/unit-conversions` | — | Unit conversions array |
| POST | `/products/:id/unit-conversions` | `{ unit_name, conversion_value, is_purchase_unit, is_sales_unit }` | Created conversion |
| DELETE | `/products/unit-conversions/:conversionId` | — | 204 |

**Products list** includes `unit_conversions` JSON array per product (subquery from `product_unit_conversions`).

## Customers

| Method | Path | Params/Body | Response |
|--------|------|-------------|----------|
| GET | `/customers` | `?search&type&city&dues_filter&page&limit` | `{ customers[], total }` |
| POST | `/customers` | Customer fields | Created customer (reactivates soft-deleted on same phone) |
| GET | `/customers/:id` | — | Full customer object |
| PUT | `/customers/:id` | Partial update | Updated customer |
| DELETE | `/customers/:id` | — | Soft-delete. Blocked if outstanding_balance > 0 |
| GET | `/customers/search` | `?q=` (name/phone prefix, max 10) | Customer array |
| GET | `/customers/:id/ledger` | `?from&to&page&limit` | `{ entries[], total, outstanding_balance }` |
| GET | `/customers/:id/summary` | — | `{ outstanding_balance, total_invoices, total_paid, ... }` |

## Invoices

| Method | Path | Params/Body | Response |
|--------|------|-------------|----------|
| POST | `/invoices` | See creation payload below | `{ invoice_id, invoice_no, grand_total, status, pdf_status }` |
| GET | `/invoices` | `?status&billType&customerId&customerSearch&invoiceNo&from&to&page&limit` | `{ invoices[], summary, total }` |
| GET | `/invoices/:id` | — | Full invoice + items + payments + customer info |
| GET | `/invoices/:id/pdf-status` | — | `{ pdf_status, pdf_url }` |
| GET | `/invoices/:id/pdf` | — | Pre-signed S3 URL or generates on-the-fly |
| POST | `/invoices/:id/regenerate-pdf` | — | `{ message }` |
| POST | `/invoices/:id/return` | See return payload below | Credit note result |

### Invoice Creation Payload
```json
{
  "bill_type": "retail|wholesale|quickbill",
  "customer_id": 123,
  "customer_name_walkin": "Walk-in name",
  "items": [
    {
      "product_id": 1,
      "product_name_snapshot": "Product Name",
      "hsn_snapshot": "1234",
      "qty": 5,
      "unit": "piece",
      "rate": 100.00,
      "discount_pct": 0,
      "gst_pct": 18,
      "cost_price_snapshot": 80.00,
      "alt_qty": 1,
      "alt_unit": "box",
      "base_qty": 12
    }
  ],
  "amount_paid": 500,
  "payment_modes": [
    { "mode": "cash", "amount": 300 },
    { "mode": "upi", "amount": 200, "reference_no": "UPI123" }
  ],
  "due_date": "2026-05-01"
}
```

**Items array capped at 500** (DoS prevention).

### Return Payload
```json
{
  "items": [
    { "invoice_item_id": 42, "product_id": 7, "qty_returned": 2 }
  ],
  "reason": "Defective product"
}
```

Returns are validated: `requested + already_returned ≤ original_qty`. Tracked via `invoice_items.qty_returned`.

## Payments

| Method | Path | Params/Body | Response |
|--------|------|-------------|----------|
| POST | `/payments` | `{ customer_id, invoice_id?, amount, mode, reference_no?, notes?, modes_detail[]? }` | Payment result + updated outstanding |
| GET | `/payments` | `?from&to&mode&page&limit` | `{ payments[], total }` |
| GET | `/payments/invoice/:invoiceId` | — | Payments for that invoice |

**Guards:** Amount cannot exceed invoice `balance_due`. Already-paid invoices rejected.

## Purchases

| Method | Path | Params/Body | Response |
|--------|------|-------------|----------|
| POST | `/purchases` | `{ supplier_id, date, items[], notes? }` | Created purchase (auto-numbered PO-YYYYMMDD-XXXX) |
| GET | `/purchases` | `?supplier_id&from&to&page&limit` | `{ purchases[], total }` |
| GET | `/purchases/:id` | — | Full purchase + items + supplier |
| PUT | `/purchases/:id/notes` | `{ notes }` | Updated purchase |
| POST | `/purchases/:id/returns` | `{ items: [{ product_id, qty_returned, unit_price, reason }] }` | Return + debit note |
| GET | `/purchases/:id/returns` | — | Returns for that purchase |
| POST | `/purchases/:id/invoice` | multipart (file, 5MB max, PDF/JPEG/PNG/WebP) | Upload result |
| GET | `/purchases/:id/invoice` | — | Pre-signed S3 URL or local file |

## Suppliers

| Method | Path | Params/Body | Response |
|--------|------|-------------|----------|
| POST | `/suppliers` | Supplier fields | Created supplier |
| GET | `/suppliers` | `?search&isActive` | Suppliers array |
| GET | `/suppliers/:id` | — | Full supplier |
| PUT | `/suppliers/:id` | Partial update | Updated supplier |
| GET | `/suppliers/:id/products` | — | Products linked via product_suppliers |
| GET | `/suppliers/:id/debit-notes` | — | Debit notes for supplier |

## Dashboard

| Method | Path | Response |
|--------|------|----------|
| GET | `/dashboard/summary` | `{ today_sales, today_collections, total_outstanding, low_stock_count, ... }` |
| GET | `/dashboard/sales-overview` | `?from&to` — Daily sales array (default 30 days) |
| GET | `/dashboard/overdue-invoices` | `?page&limit&days_overdue` — Overdue unpaid/partial invoices |
| GET | `/dashboard/overdue-customers` | Customers with outstanding > 0 |
| GET | `/dashboard/recent-activity` | Latest invoices + payments |
| GET | `/dashboard/payment-modes` | Cash/UPI/bank/cheque breakdown for current month |

## Reports

All report endpoints support `?from=YYYY-MM-DD&to=YYYY-MM-DD`.

| Method | Path | Extra Params | Response |
|--------|------|-------------|----------|
| GET | `/reports/sales` | `?bill_type&customer_id&page&limit` | `{ invoices[], summary, total, totalPages }` |
| GET | `/reports/gst` | `?month=YYYY-MM` | `{ invoices[], rate_summary[] }` |
| GET | `/reports/stock` | `?category&lowStockOnly` | `{ products[], summary }` |
| GET | `/reports/stock-movement` | `?productId&movementType&page&limit` | `{ movements[], summary }` |
| GET | `/reports/customer-dues` | `?overdueOnly&customerType&page&limit` | `{ customers[], pagination }` |
| GET | `/reports/profit` | `?page&limit` | `{ invoices[], summary, pagination }` |
| GET | `/reports/collections` | `?mode&page&limit` | `{ payments[], summary, pagination }` |
| GET | `/reports/product-categories` | — | String array of categories |

## Excel Exports

All return `Content-Disposition: attachment; filename=...xlsx`. Server-side ExcelJS.

| Method | Path | Params |
|--------|------|--------|
| GET | `/reports/sales/export` | Same as sales report |
| GET | `/reports/gst/export` | Same as GST report |
| GET | `/reports/stock/export` | Same as stock report |
| GET | `/reports/stock-movement/export` | Same as stock movement |
| GET | `/reports/customer-dues/export` | Same as customer dues |
| GET | `/reports/profit/export` | Same as profit report |
| GET | `/reports/collections/export` | Same as collections |
| GET | `/reports/full-export` | — | Multi-sheet workbook |

## Settings

| Method | Path | Response |
|--------|------|----------|
| GET | `/settings` | Store settings + DB statistics |

## Health

| Method | Path | Response |
|--------|------|----------|
| GET | `/api/health` | `{ success: true, message: 'Hardware ERP API is running' }` |

## Error Codes

| Code | HTTP | Meaning |
|------|------|---------|
| INSUFFICIENT_STOCK | 422 | Stock check failed (includes `failures` array with details) |
| DUPLICATE_SKU | 409 | SKU already exists |
| DUPLICATE_BARCODE | 409 | Barcode already exists |
| DUPLICATE_PHONE | 409 | Phone number already exists |
| INVOICE_NOT_FOUND | 404 | Invoice ID not found |
| PRODUCT_NOT_FOUND | 404 | Product ID not found |
| CUSTOMER_NOT_FOUND | 404 | Customer ID not found |
| PRODUCT_HAS_HISTORY | 422 | Cannot delete product with billing history |
| PDF_NOT_READY | 202 | PDF still generating |
| RETURN_QTY_EXCEEDS_ORIGINAL | 422 | Return qty > remaining returnable qty |
| PAYMENT_EXCEEDS_BALANCE | 422 | Payment amount > invoice balance due |
| INVOICE_ALREADY_PAID | 422 | Invoice has no remaining balance |
| RATE_LIMIT | 429 | Too many login attempts (5/15min) |
| NO_FIELDS | 422 | No valid fields in update request |
