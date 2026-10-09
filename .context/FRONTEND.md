> Phase 2 billing/payment behavior is defined in ../docs/BILLING-PAYMENT-CONTRACT.md
> and verified in ../docs/PHASE-2-REPORT.md. Billing/payment descriptions below are
> historical: client cost/base quantity is not authoritative, sales do not change
> catalog prices, and invoice/payment mutations require durable operation keys.
> Cashier billing, PDFs and attachments remain disabled.

> Historical reference. Phase 1 changes and verified behavior are documented in
> ../docs/PHASE-1-REPORT.md and ../docs/SECURITY-RUNBOOK.md. Old auth, PDF, upload,
> deployment and setup descriptions below are superseded. Do not use historical credentials.

# Frontend — React Application

> Last updated: 2026-04-17

## Stack
- **React 18** (functional components + hooks)
- **Ant Design 5** — the ONLY UI library. Do not introduce Tailwind, shadcn, Material UI
- **React Router 6** — client-side routing (28 routes)
- **Zustand** — auth state + billing draft persistence
- **Vite** — build tool (must build locally on Mac, not on t2.micro EC2)
- **dayjs** — date handling (used with Ant Design DatePicker)
- **Axios** — HTTP client with JWT interceptors

## Routes (App.jsx)

| Path | Component | Protected |
|------|-----------|-----------|
| `/login` | LoginPage | No |
| `/dashboard` | DashboardPage | Yes |
| `/billing` | BillingPage | Yes |
| `/billing/quick` | QuickBillPage | Yes |
| `/invoices` | InvoicesPage | Yes |
| `/invoices/:id` | InvoiceDetailPage | Yes |
| `/customers` | CustomersPage | Yes |
| `/customers/:id` | CustomerDetailPage | Yes |
| `/products` | ProductsPage | Yes |
| `/products/low-stock` | LowStockPage | Yes |
| `/products/:id` | ProductDetailPage | Yes |
| `/suppliers` | SuppliersPage | Yes |
| `/suppliers/:id` | SupplierDetailPage | Yes |
| `/purchases` | PurchasesPage | Yes |
| `/purchases/new` | NewPurchasePage | Yes |
| `/purchases/:id` | PurchaseDetailPage | Yes |
| `/payments` | PaymentsPage | Yes |
| `/reports` | ReportsIndexPage | Yes |
| `/reports/sales` | SalesReportPage | Yes |
| `/reports/gst` | GstReportPage | Yes |
| `/reports/stock` | StockReportPage | Yes |
| `/reports/stock-movement` | StockMovementPage | Yes |
| `/reports/dues` | CustomerDuesPage | Yes |
| `/reports/profit` | ProfitReportPage | Yes |
| `/reports/collections` | CollectionsReportPage | Yes |
| `/settings` | SettingsPage | Yes |

## State Management

### Auth Store (Phase 1)

The store initializes once from `GET /api/auth/session` and keeps only the user and
capabilities in memory. Cookies are HttpOnly. Legacy auth storage keys are removed;
unrelated drafts are preserved. A 401 clears the in-memory session without page
reload, refresh loops or mutation retries. Logout waits for backend revocation.

### Billing Store (`store/billingStore.js` — Zustand with persistence)
- Persists billing draft to localStorage (`hardware-erp-billing-draft`)
- State: `draftItems, draftCustomer, draftBillType, draftPayment`
- Strips `cost_price_snapshot` before persisting (security)
- Methods: `saveDraft()`, `clearDraft()`

### Local State
All page-level state uses `useState`/`useCallback`. No Redux, no React Query.

## Key Hooks

### useBilling (`hooks/useBilling.js`)
Central hook for the billing page. Manages:
- **Customer:** `customer`, `setCustomer` — auto-sets bill type based on customer.type
- **Bill type:** `billType`, `setBillType` — 'retail' | 'wholesale' | 'quickbill'
- **Items:** `items`, `addItem(product)`, `updateItem(idx, field, value)`, `updateItemFields(idx, fields)`, `removeItem(idx)`
- **Payment:** `payment`, `setPaymentAmount`, `addPaymentMode`, `removePaymentMode`, `setDueDate`
- **Totals:** Computed via `billing.calculations.js` — subtotal, discount_total, taxable_total, gst_total, grand_total, total_profit, profit_pct
- **Submit:** `submitInvoice(overrides)` → validates → POST /api/invoices → returns invoice or null
- **Reset:** `resetBilling()` — clears all state

### useProductSearch (`hooks/useProductSearch.js`)
- **Text search:** 150ms debounce, min 2 chars, max 8 results
- **Barcode search:** Instant lookup (no debounce)
- Adds `stock_status` and `display_price` to results
- Returns: `{ query, setQuery, results, isLoading, searchByBarcode }`

### useKeyboardBilling (`hooks/useKeyboardBilling.js`)
- Registers keyboard shortcuts for billing page
- Ignores when Ant Design modal is open (checks `.ant-modal-root`)

## Billing Page — Keyboard-First UX

### Keyboard Shortcuts
| Key | Action |
|-----|--------|
| F2 | Toggle Quick Bill mode |
| F4 | Pay Full amount |
| F9 | Finalize bill (submit) |
| Esc | Clear bill |
| Ctrl+P | Print last invoice PDF |

### Field Navigation (Tab/Enter progresses)
```
Customer Search → Product Search → [select product] →
Qty → Rate → Discount% → GST% → Product Search (loop)
```

### Unit Conversion in Billing
- When product has unit conversions, unit dropdown shows base unit + alt units
- Selecting alt unit (e.g., "box") auto-fills: `alt_qty`, `alt_unit`, `base_qty = alt_qty × conversion_value`
- Rate adjusts to per-alt-unit price (e.g., rate per box)

## Billing Calculations (`utils/billing.calculations.js`)

**Must stay in sync with backend `invoices.service.js`.** This is Absolute Rule #4.

### Exported Functions
1. **`calculateLineItem(item)`** — Computes discount_amount, taxable_amount, gst_amount, line_total, line_profit
2. **`calculateInvoiceTotals(items)`** — Sums to subtotal, discount_total, taxable_total, gst_total, grand_total, total_profit, profit_pct
3. **`getPaymentStatus(grand_total, amount_paid)`** — Returns 'paid' | 'partial' | 'unpaid'
4. **`buildGstBreakdown(items)`** — Groups by GST rate, splits CGST/SGST (each = GST/2)

### Formulas
```
discount_amount = rate × (discount_pct / 100)
taxable_amount  = (rate - discount_amount) × qty
gst_amount      = taxable_amount × (gst_pct / 100)
line_total      = taxable_amount + gst_amount
line_profit     = (rate - discount_amount - cost_price_snapshot) × qty

Invoice totals:
grand_total = taxable_total + gst_total
profit_pct  = (profit_amount / taxable_total) × 100
```

## API Layer (`api/axios.js`)

```js
baseURL: import.meta.env.VITE_API_URL || '/api'
withCredentials: true  // for httpOnly refresh cookie
```

**Request interceptor:** Attaches `Authorization: Bearer <token>` from Zustand store.
**Response interceptor:** On 401 (except /auth/refresh) → `logout()` + redirect to `/login`.

**WARNING:** Empty string `VITE_API_URL=""` is truthy in JS — the `||` fallback won't trigger. Set it to a real URL or omit it entirely.

### API Files (one per module)
- `auth.api.js` — login, logout, refreshToken
- `products.api.js` — CRUD, search, stock ledger, price history, unit conversions, suppliers
- `customers.api.js` — CRUD, search, ledger, summary
- `invoices.api.js` — create, list, detail, PDF status/download, return, regenerate
- `payments.api.js` — record, list by customer/invoice
- `purchases.api.js` — create, list, detail, returns, invoice upload/download
- `suppliers.api.js` — CRUD, products, debit-notes
- `dashboard.api.js` — summary, sales-overview, overdue, activity, payment-modes
- `reports.api.js` — all 7 reports + categories + export (blob download)
- `settings.api.js` — get settings

## Components

### AppLayout (`components/AppLayout.jsx`)
- Collapsible sidebar: Dashboard, Billing, Invoices, Customers, Products, Purchases, Suppliers, Reports, Settings
- Header: menu toggle + PWA install button + user name + logout
- Footer: "UMA Enterprises v1.0"

### PrivateRoute (`components/PrivateRoute.jsx`)
Auth guard — redirects to `/login` if not authenticated.

### PWAInstallButton (`components/PWAInstallButton.jsx`)
- Listens for `beforeinstallprompt` event, shows Download icon button when installable
- Requires HTTPS + service worker (not active on HTTP)

### ProductSearch / CustomerSearch
Reusable autocomplete dropdowns with debounce, arrow-key navigation, Enter to select.
- ProductSearch: shows name, SKU, stock status, display price
- CustomerSearch: shows name, business, phone, type tag, outstanding balance

### PaymentModal / ReturnModal / PurchaseReturnModal
Modal dialogs for recording payments, processing sales returns, and purchase returns.

### PriceHistoryChart
SVG line chart showing purchase_price, wholesale_price, MRP over time.

### ReportLayout (`components/Reports/ReportLayout.jsx`)
Standard report page wrapper: title, export button, filters card, summary, spinning table.

## Key Page Behaviors

### Products Page
- Stock column shows base quantity + unit (e.g., "442 piece")
- Below shows box equivalent from unit_conversions (e.g., "36 box + 10 piece")
- Low-stock items highlighted in red with warning icon

### Product Detail Page
- Stock card shows conversion breakdown (e.g., "10 Box + 4 Pcs")
- Shows conversion label (e.g., "1 box = 12 piece")
- Tabs: Stock Ledger, Price History, Unit Conversions, Suppliers

### Invoice Detail Page
- Items table includes alt_qty, alt_unit, base_qty columns when present
- Return modal validates against `qty_returned` to prevent duplicate returns

### Dashboard Page
- Auto-refresh every 60 seconds
- 5 summary cards, recent activity, payment mode chart, overdue table

## Formatting (`utils/formatCurrency.js`)
```js
formatINR(amount)   → "₹1,234.56" (en-IN locale)
formatDate(dateStr) → "DD-MM-YYYY" or '—' if empty
```

## Key Frontend Conventions
- All DB field names used as-is (snake_case) — no camelCase mapping
- Invoice detail returns flat customer fields: `customer_name`, `customer_phone` (not nested)
- Invoice status field is `status` (not `payment_status`)
- Payment date field is `payment_date` (not `date`)
- PDF never exposes purchase_price, profit, or cost to customers
- PWA manifest at `public/manifest.json` — needs HTTPS + service worker to activate
