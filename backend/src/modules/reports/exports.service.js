const ExcelJS = require('exceljs');
const reportsService = require('./reports.service');
const { pool } = require('../../config/db');

// ---------------------------------------------------------------------------
// Styling constants
// ---------------------------------------------------------------------------
const HEADER_STYLE = {
  font: { bold: true, color: { argb: 'FFFFFFFF' }, size: 11 },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F4E79' } },
  alignment: { horizontal: 'center', vertical: 'middle', wrapText: true },
  border: { bottom: { style: 'thin', color: { argb: 'FF000000' } } },
};

const CURRENCY_FORMAT = '₹#,##0.00';
const DATE_FORMAT = 'DD-MM-YYYY';
const PERCENT_FORMAT = '0.00%';

const TOTAL_ROW_STYLE = {
  font: { bold: true, size: 11 },
  fill: { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFF2CC' } },
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Apply header styling to the first row of a worksheet.
 */
function applyHeaderStyle(sheet) {
  const headerRow = sheet.getRow(1);
  headerRow.eachCell((cell) => {
    cell.font = HEADER_STYLE.font;
    cell.fill = HEADER_STYLE.fill;
    cell.alignment = HEADER_STYLE.alignment;
    cell.border = HEADER_STYLE.border;
  });
  headerRow.height = 22;
}

/**
 * Auto-fit column widths based on cell content length.
 */
function autoFitColumns(sheet) {
  sheet.eachRow((row, number) => { if (number > 1) row.eachCell(cell => {
    if (typeof cell.value === 'string' && /^[\s]*[=+\-@\t\r]/.test(cell.value)) cell.value = "'" + cell.value;
  }); });
  sheet.columns.forEach((column) => {
    let maxWidth = column.header ? String(column.header).length : 10;
    column.eachCell({ includeEmpty: false }, (cell) => {
      const cellValue = cell.value != null ? String(cell.value) : '';
      maxWidth = Math.max(maxWidth, cellValue.length);
    });
    column.width = Math.min(maxWidth + 2, 50);
  });
}

/**
 * Add a bold totals row with sums for specified numeric columns.
 * @param {ExcelJS.Worksheet} sheet
 * @param {Object} totals - key/value map of column keys to total values
 * @param {string} [labelColumn] - column key where "TOTAL" label is placed
 */
function addTotalRow(sheet, totals, labelColumn) {
  const row = {};
  if (labelColumn) {
    row[labelColumn] = 'TOTAL';
  }
  Object.entries(totals).forEach(([key, value]) => {
    row[key] = value;
  });

  const addedRow = sheet.addRow(row);
  addedRow.eachCell((cell) => {
    cell.font = TOTAL_ROW_STYLE.font;
    cell.fill = TOTAL_ROW_STYLE.fill;
  });

  return addedRow;
}

/**
 * Freeze the first (header) row of a worksheet.
 */
function freezeHeaderRow(sheet) {
  sheet.views = [{ state: 'frozen', ySplit: 1 }];
}

/**
 * Format a date value as DD-MM-YYYY string for display.
 */
function formatDateValue(val) {
  if (!val) return '';
  const d = new Date(val);
  if (isNaN(d.getTime())) return '';
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

// ---------------------------------------------------------------------------
// Sales Report Export
// ---------------------------------------------------------------------------

async function buildSalesExport({ from, to, billType, customerId }) {
  const result = await reportsService.getSalesReport({
    from,
    to,
    billType,
    customerId,
    page: 1,
  }, true);

  const rows = result.invoices || result.records || [];
  const summary = result.summary || {};

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hardware Store ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Sales Report');

  sheet.columns = [
    { header: 'Invoice No', key: 'invoice_no', width: 20 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Customer', key: 'customer_name', width: 25 },
    { header: 'Bill Type', key: 'bill_type', width: 12 },
    { header: 'Subtotal', key: 'subtotal', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Discount', key: 'discount_total', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Taxable', key: 'taxable_total', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'GST', key: 'gst_total', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Grand Total', key: 'grand_total', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Direct receipts as of end', key: 'amount_paid', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Balance', key: 'balance_due', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Profit', key: 'profit_amount', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Margin %', key: 'profit_pct', width: 10, style: { numFmt: PERCENT_FORMAT } },
  ];

  rows.forEach((r) => {
    sheet.addRow({
      invoice_no: r.invoiceNo || r.invoice_no,
      date: formatDateValue(r.date),
      customer_name: r.customerName || r.customer_name || 'Walk-in',
      bill_type: r.billType || r.bill_type,
      subtotal: Number(r.subtotal) || 0,
      discount_total: Number(r.discountTotal) || Number(r.discount_total) || 0,
      taxable_total: Number(r.taxableTotal) || Number(r.taxable_total) || 0,
      gst_total: Number(r.gstTotal) || Number(r.gst_total) || 0,
      grand_total: Number(r.grandTotal) || Number(r.grand_total) || 0,
      amount_paid: Number(r.amountPaid) || Number(r.amount_paid) || 0,
      balance_due: r.balance_due === null ? null : Number(r.balanceDue ?? r.balance_due ?? 0),
      status: r.status,
      profit_amount: Number(r.profitAmount) || Number(r.profit_amount) || 0,
      profit_pct: (Number(r.profitPct) || Number(r.profit_pct) || 0) / 100,
    });
  });

  applyHeaderStyle(sheet);
  freezeHeaderRow(sheet);

  // Summary total row
  addTotalRow(
    sheet,
    {
      grand_total: Number(summary.total_sales) || 0,
      gst_total: summary.totalGst || summary.total_gst || 0,
      amount_paid: Number(summary.total_paid) || 0,
      balance_due: Number(summary.total_outstanding) || 0,
      profit_amount: summary.totalProfit || summary.total_profit || 0,
    },
    'invoice_no'
  );

  autoFitColumns(sheet);

  return workbook.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// GST Report Export
// ---------------------------------------------------------------------------

async function buildGstExport({ month, year }) {
  const result = await reportsService.getGstReport({ month, year });

  const invoices = result.invoices || result.data || [];
  const rateSummary = result.rateSummary || result.rate_summary || [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hardware Store ERP';
  workbook.created = new Date();

  // Sheet 1: Invoice List
  const invoiceSheet = workbook.addWorksheet('Invoice List');
  invoiceSheet.columns = [
    { header: 'Invoice No', key: 'invoice_no', width: 20 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Customer', key: 'customer_name', width: 25 },
    { header: 'GSTIN', key: 'gstin', width: 18 },
    { header: 'Category', key: 'category', width: 10 },
    { header: 'Taxable', key: 'taxable_total', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'CGST', key: 'cgst', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'SGST', key: 'sgst', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Total GST', key: 'gst_total', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Invoice Total', key: 'grand_total', width: 16, style: { numFmt: CURRENCY_FORMAT } },
  ];

  invoices.forEach((r) => {
    const gst = Number(r.gstTotal) || Number(r.gst_total) || 0;
    const gstin = r.customerGstin || r.customer_gstin || r.gstin || '';
    invoiceSheet.addRow({
      invoice_no: r.invoiceNo || r.invoice_no,
      date: formatDateValue(r.date),
      customer_name: r.customerName || r.customer_name || 'Walk-in',
      gstin: gstin,
      category: r.invoiceCategory || r.invoice_category || (gstin ? 'B2B' : 'B2C'),
      taxable_total: Number(r.taxableTotal) || Number(r.taxable_total) || 0,
      cgst: gst / 2,
      sgst: gst / 2,
      gst_total: gst,
      grand_total: Number(r.grandTotal) || Number(r.grand_total) || 0,
    });
  });

  applyHeaderStyle(invoiceSheet);
  freezeHeaderRow(invoiceSheet);
  autoFitColumns(invoiceSheet);

  // Sheet 2: GST Rate Summary
  const rateSheet = workbook.addWorksheet('GST Rate Summary');
  rateSheet.columns = [
    { header: 'GST Rate %', key: 'gst_rate', width: 12 },
    { header: 'Taxable Amount', key: 'taxable_amount', width: 18, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'CGST', key: 'cgst', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'SGST', key: 'sgst', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Total Tax', key: 'total_tax', width: 14, style: { numFmt: CURRENCY_FORMAT } },
  ];

  rateSummary.forEach((r) => {
    const totalTax = Number(r.totalTax) || Number(r.total_tax) || 0;
    rateSheet.addRow({
      gst_rate: Number(r.gstPct) || Number(r.gst_rate) || 0,
      taxable_amount: Number(r.taxableAmount) || Number(r.taxable_amount) || 0,
      cgst: Number(r.cgst) || totalTax / 2,
      sgst: Number(r.sgst) || totalTax / 2,
      total_tax: totalTax,
    });
  });

  applyHeaderStyle(rateSheet);
  freezeHeaderRow(rateSheet);
  autoFitColumns(rateSheet);

  // Sheet 3: B2B Invoices only
  const b2bSheet = workbook.addWorksheet('B2B Invoices');
  b2bSheet.columns = [
    { header: 'Invoice No', key: 'invoice_no', width: 20 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Customer', key: 'customer_name', width: 25 },
    { header: 'GSTIN', key: 'gstin', width: 18 },
    { header: 'Taxable', key: 'taxable_total', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'CGST', key: 'cgst', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'SGST', key: 'sgst', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Total GST', key: 'gst_total', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Invoice Total', key: 'grand_total', width: 16, style: { numFmt: CURRENCY_FORMAT } },
  ];

  const b2bInvoices = invoices.filter((r) => r.customerGstin || r.customer_gstin || r.gstin);
  b2bInvoices.forEach((r) => {
    const gst = Number(r.gstTotal) || Number(r.gst_total) || 0;
    const gstin = r.customerGstin || r.customer_gstin || r.gstin;
    b2bSheet.addRow({
      invoice_no: r.invoiceNo || r.invoice_no,
      date: formatDateValue(r.date),
      customer_name: r.customerName || r.customer_name || 'Walk-in',
      gstin: gstin,
      taxable_total: Number(r.taxableTotal) || Number(r.taxable_total) || 0,
      cgst: gst / 2,
      sgst: gst / 2,
      gst_total: gst,
      grand_total: Number(r.grandTotal) || Number(r.grand_total) || 0,
    });
  });

  applyHeaderStyle(b2bSheet);
  freezeHeaderRow(b2bSheet);
  autoFitColumns(b2bSheet);

  return workbook.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// Stock Report Export
// ---------------------------------------------------------------------------

async function buildStockExport({ category, lowStockOnly }) {
  const result = await reportsService.getStockReport({ category, lowStockOnly });

  const rows = result.products || result.data || [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hardware Store ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Stock Report');
  sheet.columns = [
    { header: 'Product', key: 'name', width: 30 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Brand', key: 'brand', width: 16 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'HSN', key: 'hsn_code', width: 10 },
    { header: 'GST %', key: 'gst_rate', width: 8 },
    { header: 'MRP', key: 'mrp', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Wholesale', key: 'wholesale_price', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Cost', key: 'purchase_price', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Current Stock', key: 'current_stock', width: 14 },
    { header: 'Min Stock', key: 'min_stock', width: 12 },
    { header: 'Low Stock?', key: 'low_stock', width: 12 },
    { header: 'Value (Cost)', key: 'value_cost', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Value (MRP)', key: 'value_mrp', width: 16, style: { numFmt: CURRENCY_FORMAT } },
  ];

  let totalValueCost = 0;
  let totalValueMrp = 0;

  rows.forEach((r) => {
    const stock = Number(r.currentStock) || Number(r.current_stock) || 0;
    const minStk = Number(r.minStock) || Number(r.min_stock) || 0;
    const cost = Number(r.purchasePrice) || Number(r.purchase_price) || 0;
    const mrpVal = Number(r.mrp) || 0;
    const isLow = r.isLowStock != null ? r.isLowStock : stock <= minStk;
    const valueCost = Number(r.stockValueCost) || stock * cost;
    const valueMrp = Number(r.stockValueMrp) || stock * mrpVal;

    totalValueCost += valueCost;
    totalValueMrp += valueMrp;

    const addedRow = sheet.addRow({
      name: r.name,
      sku: r.sku || '',
      category: r.category || '',
      brand: r.brand || '',
      unit: r.unit || '',
      hsn_code: r.hsnCode || r.hsn_code || '',
      gst_rate: Number(r.gstRate) || Number(r.gst_rate) || 0,
      mrp: mrpVal,
      wholesale_price: Number(r.wholesalePrice) || Number(r.wholesale_price) || 0,
      purchase_price: cost,
      current_stock: stock,
      min_stock: minStk,
      low_stock: isLow ? 'YES' : 'No',
      value_cost: valueCost,
      value_mrp: valueMrp,
    });

    // Conditional red/green font for Low Stock column
    const lowStockCell = addedRow.getCell('low_stock');
    lowStockCell.font = {
      bold: true,
      color: { argb: isLow ? 'FFCC0000' : 'FF008000' },
    };
  });

  applyHeaderStyle(sheet);
  freezeHeaderRow(sheet);

  addTotalRow(
    sheet,
    { value_cost: totalValueCost, value_mrp: totalValueMrp },
    'name'
  );

  autoFitColumns(sheet);

  return workbook.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// Stock Movement Export
// ---------------------------------------------------------------------------

async function buildStockMovementExport({ from, to, productId, movementType }) {
  const result = await reportsService.getStockMovementReport({
    from,
    to,
    productId,
    movementType,
    page: 1,
  }, true);

  const rows = result.movements || result.records || [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hardware Store ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Stock Movement');
  sheet.columns = [
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Product', key: 'product_name', width: 30 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Movement Type', key: 'movement_type', width: 16 },
    { header: 'Qty In', key: 'qty_in', width: 12 },
    { header: 'Qty Out', key: 'qty_out', width: 12 },
    { header: 'Stock After', key: 'stock_after', width: 14 },
    { header: 'Reference Type', key: 'reference_type', width: 16 },
    { header: 'Reference ID', key: 'reference_id', width: 14 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Recorded By', key: 'recorded_by', width: 18 },
  ];

  rows.forEach((r) => {
    sheet.addRow({
      date: formatDateValue(r.date),
      product_name: r.productName || r.product_name || '',
      sku: r.sku || '',
      movement_type: r.movementType || r.movement_type,
      qty_in: Number(r.qtyIn) || Number(r.qty_in) || 0,
      qty_out: Number(r.qtyOut) || Number(r.qty_out) || 0,
      stock_after: Number(r.stockAfter) || Number(r.stock_after) || 0,
      reference_type: r.referenceType || r.reference_type || '',
      reference_id: r.referenceId || r.reference_id || '',
      notes: r.notes || '',
      recorded_by: r.createdByName || r.created_by_name || '',
    });
  });

  applyHeaderStyle(sheet);
  freezeHeaderRow(sheet);
  autoFitColumns(sheet);

  return workbook.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// Customer Dues Export
// ---------------------------------------------------------------------------

async function buildCustomerDuesExport({ overdueOnly, customerType, as_of }) {
  const result = await reportsService.getCustomerDuesReport({
    overdueOnly,
    customerType,
    as_of,
    page: 1,
  }, true);

  const rows = result.customers || result.records || [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hardware Store ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Customer Dues');
  sheet.columns = [
    { header: 'Customer', key: 'name', width: 25 },
    { header: 'Business Name', key: 'business_name', width: 25 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Invoice due', key: 'outstanding_balance', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Available credits', key: 'available_credit', width: 18, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Overdue', key: 'overdue_amount', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'As of', key: 'as_of', width: 14 },
    { header: 'Evidence', key: 'evidence', width: 24 },
    { header: 'Credit Limit', key: 'credit_limit', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Unpaid Invoices', key: 'unpaid_invoices', width: 16 },
    { header: 'Last Invoice Date', key: 'last_invoice_date', width: 16 },
    { header: 'Oldest Unpaid Date', key: 'oldest_unpaid_date', width: 18 },
  ];

  const now = new Date();

  rows.forEach((r) => {
    const oldestUnpaid = r.oldestUnpaidDate || r.oldest_unpaid_date;
    const addedRow = sheet.addRow({
      name: r.name,
      business_name: r.businessName || r.business_name || '',
      phone: r.phone,
      type: r.type || '',
      outstanding_balance: Number(r.outstandingBalance) || Number(r.outstanding_balance) || 0,
      available_credit: Number(r.available_credit),
      overdue_amount: Number(r.overdue_amount),
      as_of: r.as_of,
      evidence: r.reconciliation_required ? 'Reconciliation required' : 'Reconciled',
      credit_limit: Number(r.creditLimit) || Number(r.credit_limit) || 0,
      unpaid_invoices: Number(r.unpaid_invoice_count ?? r.unpaidInvoiceCount ?? r.unpaid_invoices ?? 0),
      last_invoice_date: formatDateValue(r.lastInvoiceDate || r.last_invoice_date),
      oldest_unpaid_date: formatDateValue(oldestUnpaid),
    });

    // Conditional row coloring based on age of oldest unpaid date
    if (oldestUnpaid) {
      const oldestDate = new Date(oldestUnpaid);
      const daysDiff = Math.floor((now - oldestDate) / (1000 * 60 * 60 * 24));

      let fillColor = null;
      if (daysDiff >= 90) {
        fillColor = 'FFFFE0E0'; // red
      } else if (daysDiff >= 31) {
        fillColor = 'FFFFF0E0'; // orange
      } else if (daysDiff >= 0) {
        fillColor = 'FFFFFFD0'; // yellow
      }

      if (fillColor) {
        addedRow.eachCell((cell) => {
          cell.fill = {
            type: 'pattern',
            pattern: 'solid',
            fgColor: { argb: fillColor },
          };
        });
      }
    }
  });

  applyHeaderStyle(sheet);
  freezeHeaderRow(sheet);
  autoFitColumns(sheet);

  return workbook.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// Profit Report Export
// ---------------------------------------------------------------------------

async function buildProfitExport({ from, to }) {
  const result = await reportsService.getProfitReport({
    from,
    to,
    page: 1,
  }, true);

  const rows = result.invoices || result.records || [];
  const summary = result.summary || {};

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hardware Store ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Profit Report');
  sheet.columns = [
    { header: 'Invoice No', key: 'invoice_no', width: 20 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Customer', key: 'customer_name', width: 25 },
    { header: 'Bill Type', key: 'bill_type', width: 12 },
    { header: 'Revenue', key: 'grand_total', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Cost', key: 'total_cost', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Gross Profit', key: 'profit_amount', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Margin %', key: 'profit_pct', width: 10, style: { numFmt: PERCENT_FORMAT } },
  ];

  let totalRevenue = 0;
  let totalCost = 0;
  let totalProfit = 0;

  rows.forEach((r) => {
    const revenue = Number(r.grandTotal) || Number(r.grand_total) || 0;
    const cost = Number(r.totalCost) || Number(r.total_cost) || 0;
    const profit = Number(r.profitAmount) || Number(r.profit_amount) || 0;

    totalRevenue += revenue;
    totalCost += cost;
    totalProfit += profit;

    const addedRow = sheet.addRow({
      invoice_no: r.invoiceNo || r.invoice_no,
      date: formatDateValue(r.date),
      customer_name: r.customerName || r.customer_name || 'Walk-in',
      bill_type: r.billType || r.bill_type,
      grand_total: revenue,
      total_cost: cost,
      profit_amount: profit,
      profit_pct: (Number(r.profitPct) || Number(r.profit_pct) || 0) / 100,
    });

    // Red font for negative profit rows
    if (profit < 0) {
      addedRow.eachCell((cell) => {
        cell.font = { color: { argb: 'FFCC0000' } };
      });
    }
  });

  applyHeaderStyle(sheet);
  freezeHeaderRow(sheet);

  addTotalRow(
    sheet,
    {
      grand_total: summary.totalRevenue || summary.total_revenue || totalRevenue,
      total_cost: summary.totalCogs || summary.total_cost || totalCost,
      profit_amount: summary.grossProfit || summary.total_profit || totalProfit,
    },
    'invoice_no'
  );

  autoFitColumns(sheet);

  return workbook.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// Payment Collections Export
// ---------------------------------------------------------------------------

async function buildCollectionsExport({ from, to, mode }) {
  const result = await reportsService.getPaymentCollectionsReport({
    from,
    to,
    mode,
    page: 1,
  }, true);

  const rows = result.payments || result.records || [];

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hardware Store ERP';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Payment Collections');
  sheet.columns = [
    { header: 'Date', key: 'payment_date', width: 14 },
    { header: 'Customer', key: 'customer_name', width: 25 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Invoice No', key: 'invoice_no', width: 20 },
    { header: 'Tender portion', key: 'amount', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Kind', key: 'kind', width: 22 },
    { header: 'Direction', key: 'direction', width: 12 },
    { header: 'Mode', key: 'mode', width: 10 },
    { header: 'Reference No', key: 'reference_no', width: 20 },
    { header: 'Notes', key: 'notes', width: 30 },
  ];

  rows.forEach((r) => {
    sheet.addRow({
      payment_date: formatDateValue(r.paymentDate || r.payment_date),
      customer_name: r.customerName || r.customer_name || '',
      phone: r.customerPhone || r.phone || '',
      invoice_no: r.invoiceNo || r.invoice_no || '',
      amount: Number(r.amount) || 0,
      kind: r.kind,
      direction: r.direction,
      mode: r.mode || '',
      reference_no: r.referenceNo || r.reference_no || '',
      notes: r.notes || '',
    });
  });

  applyHeaderStyle(sheet);
  freezeHeaderRow(sheet);
  autoFitColumns(sheet);

  return workbook.xlsx.writeBuffer();
}

// ---------------------------------------------------------------------------
// Full Data Export (streams directly to response)
// ---------------------------------------------------------------------------

async function buildFullDataExport(res) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Hardware Store ERP';
  workbook.created = new Date();

  // ---- Sheet 1: Customers ----
  const customersSheet = workbook.addWorksheet('Customers');
  const { rows: customers } = await pool.query(`
    SELECT id, name, business_name, phone, alt_phone, email, address,
           city, pincode, gstin, type, credit_limit, outstanding_balance,
           payment_terms, notes, created_at
    FROM customers
    WHERE is_active = true
    ORDER BY name
  `);

  customersSheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Name', key: 'name', width: 25 },
    { header: 'Business Name', key: 'business_name', width: 25 },
    { header: 'Phone', key: 'phone', width: 14 },
    { header: 'Alt Phone', key: 'alt_phone', width: 14 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'Address', key: 'address', width: 30 },
    { header: 'City', key: 'city', width: 16 },
    { header: 'Pincode', key: 'pincode', width: 10 },
    { header: 'GSTIN', key: 'gstin', width: 18 },
    { header: 'Type', key: 'type', width: 12 },
    { header: 'Credit Limit', key: 'credit_limit', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Net ledger balance', key: 'outstanding_balance', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Payment Terms', key: 'payment_terms', width: 16 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Created At', key: 'created_at', width: 14 },
  ];

  customers.forEach((r) => {
    customersSheet.addRow({
      ...r,
      credit_limit: Number(r.credit_limit) || 0,
      outstanding_balance: Number(r.outstanding_balance) || 0,
      created_at: formatDateValue(r.created_at),
    });
  });

  applyHeaderStyle(customersSheet);
  freezeHeaderRow(customersSheet);
  autoFitColumns(customersSheet);

  // ---- Sheet 2: Products ----
  const productsSheet = workbook.addWorksheet('Products');
  const { rows: products } = await pool.query(`
    SELECT id, name, category, brand, sku, barcode, hsn_code, gst_rate,
           mrp, wholesale_price, purchase_price, current_stock, min_stock,
           unit, created_at, updated_at
    FROM products
    WHERE is_active = true
    ORDER BY name
  `);

  productsSheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Name', key: 'name', width: 30 },
    { header: 'Category', key: 'category', width: 16 },
    { header: 'Brand', key: 'brand', width: 16 },
    { header: 'SKU', key: 'sku', width: 16 },
    { header: 'Barcode', key: 'barcode', width: 16 },
    { header: 'HSN', key: 'hsn_code', width: 10 },
    { header: 'GST %', key: 'gst_rate', width: 8 },
    { header: 'MRP', key: 'mrp', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Wholesale', key: 'wholesale_price', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Cost', key: 'purchase_price', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Current Stock', key: 'current_stock', width: 14 },
    { header: 'Min Stock', key: 'min_stock', width: 12 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Created At', key: 'created_at', width: 14 },
    { header: 'Updated At', key: 'updated_at', width: 14 },
  ];

  products.forEach((r) => {
    productsSheet.addRow({
      ...r,
      gst_rate: Number(r.gst_rate) || 0,
      mrp: Number(r.mrp) || 0,
      wholesale_price: Number(r.wholesale_price) || 0,
      purchase_price: Number(r.purchase_price) || 0,
      current_stock: Number(r.current_stock) || 0,
      min_stock: Number(r.min_stock) || 0,
      created_at: formatDateValue(r.created_at),
      updated_at: formatDateValue(r.updated_at),
    });
  });

  applyHeaderStyle(productsSheet);
  freezeHeaderRow(productsSheet);
  autoFitColumns(productsSheet);

  // ---- Sheet 3: Invoices ----
  const invoicesSheet = workbook.addWorksheet('Invoices');
  const { rows: invoices } = await pool.query(`
    SELECT i.id, i.invoice_no, i.customer_id, COALESCE(i.customer_snapshot->>'name','Unknown issued party') AS customer_name,
           i.customer_name_walkin, i.bill_type, i.date, i.subtotal,
           i.discount_total, i.taxable_total, i.gst_total, i.grand_total,
           i.total_cost, i.profit_amount, i.profit_pct, i.amount_paid,
           i.balance_due, i.due_date, i.status, i.created_at
    FROM invoices i
    LEFT JOIN customers c ON c.id = i.customer_id
    ORDER BY i.id DESC
  `);

  invoicesSheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Invoice No', key: 'invoice_no', width: 20 },
    { header: 'Customer ID', key: 'customer_id', width: 12 },
    { header: 'Customer', key: 'customer_name', width: 25 },
    { header: 'Walk-in Name', key: 'customer_name_walkin', width: 20 },
    { header: 'Bill Type', key: 'bill_type', width: 12 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Subtotal', key: 'subtotal', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Discount', key: 'discount_total', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Taxable', key: 'taxable_total', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'GST', key: 'gst_total', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Grand Total', key: 'grand_total', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Cost', key: 'total_cost', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Profit', key: 'profit_amount', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Margin %', key: 'profit_pct', width: 10 },
    { header: 'Direct receipts as of end', key: 'amount_paid', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Balance', key: 'balance_due', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Due Date', key: 'due_date', width: 14 },
    { header: 'Status', key: 'status', width: 10 },
    { header: 'Created At', key: 'created_at', width: 14 },
  ];

  invoices.forEach((r) => {
    invoicesSheet.addRow({
      id: r.id,
      invoice_no: r.invoice_no,
      customer_id: r.customer_id,
      customer_name: r.customer_name || '',
      customer_name_walkin: r.customer_name_walkin || '',
      bill_type: r.bill_type,
      date: formatDateValue(r.date),
      subtotal: Number(r.subtotal) || 0,
      discount_total: Number(r.discount_total) || 0,
      taxable_total: Number(r.taxable_total) || 0,
      gst_total: Number(r.gst_total) || 0,
      grand_total: Number(r.grand_total) || 0,
      total_cost: Number(r.total_cost) || 0,
      profit_amount: Number(r.profit_amount) || 0,
      profit_pct: Number(r.profit_pct) || 0,
      amount_paid: Number(r.amount_paid) || 0,
      balance_due: Number(r.balance_due) || 0,
      due_date: formatDateValue(r.due_date),
      status: r.status,
      created_at: formatDateValue(r.created_at),
    });
  });

  applyHeaderStyle(invoicesSheet);
  freezeHeaderRow(invoicesSheet);
  autoFitColumns(invoicesSheet);

  // ---- Sheet 4: Invoice Items ----
  const itemsSheet = workbook.addWorksheet('Invoice Items');
  const { rows: items } = await pool.query(`
    SELECT ii.id, i.invoice_no, ii.invoice_id, ii.product_id,
           ii.product_name_snapshot, ii.hsn_snapshot, ii.qty, ii.unit,
           ii.rate, ii.discount_pct, ii.discount_amount, ii.taxable_amount,
           ii.gst_pct, ii.gst_amount, ii.line_total,
           ii.cost_price_snapshot, ii.line_profit
    FROM invoice_items ii
    JOIN invoices i ON i.id = ii.invoice_id
    ORDER BY ii.invoice_id, ii.id
  `);

  itemsSheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Invoice No', key: 'invoice_no', width: 20 },
    { header: 'Invoice ID', key: 'invoice_id', width: 10 },
    { header: 'Product ID', key: 'product_id', width: 10 },
    { header: 'Product', key: 'product_name_snapshot', width: 30 },
    { header: 'HSN', key: 'hsn_snapshot', width: 10 },
    { header: 'Qty', key: 'qty', width: 10 },
    { header: 'Unit', key: 'unit', width: 10 },
    { header: 'Rate', key: 'rate', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Disc %', key: 'discount_pct', width: 10 },
    { header: 'Disc Amt', key: 'discount_amount', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Taxable', key: 'taxable_amount', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'GST %', key: 'gst_pct', width: 8 },
    { header: 'GST Amt', key: 'gst_amount', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Line Total', key: 'line_total', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Cost Snapshot', key: 'cost_price_snapshot', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Line Profit', key: 'line_profit', width: 14, style: { numFmt: CURRENCY_FORMAT } },
  ];

  items.forEach((r) => {
    itemsSheet.addRow({
      id: r.id,
      invoice_no: r.invoice_no,
      invoice_id: r.invoice_id,
      product_id: r.product_id,
      product_name_snapshot: r.product_name_snapshot,
      hsn_snapshot: r.hsn_snapshot || '',
      qty: Number(r.qty) || 0,
      unit: r.unit || '',
      rate: Number(r.rate) || 0,
      discount_pct: Number(r.discount_pct) || 0,
      discount_amount: Number(r.discount_amount) || 0,
      taxable_amount: Number(r.taxable_amount) || 0,
      gst_pct: Number(r.gst_pct) || 0,
      gst_amount: Number(r.gst_amount) || 0,
      line_total: Number(r.line_total) || 0,
      cost_price_snapshot: Number(r.cost_price_snapshot) || 0,
      line_profit: Number(r.line_profit) || 0,
    });
  });

  applyHeaderStyle(itemsSheet);
  freezeHeaderRow(itemsSheet);
  autoFitColumns(itemsSheet);

  // ---- Sheet 5: Payments ----
  const paymentsSheet = workbook.addWorksheet('Original Receipts');
  const { rows: payments } = await pool.query(`
    SELECT p.id, p.customer_id, COALESCE(p.customer_snapshot->>'name','Unknown issued party') AS customer_name,
           p.invoice_id, i.invoice_no, p.amount, p.mode,
           p.reference_no, p.payment_date, p.notes, p.created_at
    FROM payments p
    LEFT JOIN customers c ON c.id = p.customer_id
    LEFT JOIN invoices i ON i.id = p.invoice_id
    ORDER BY p.id DESC
  `);

  paymentsSheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Customer ID', key: 'customer_id', width: 12 },
    { header: 'Customer', key: 'customer_name', width: 25 },
    { header: 'Invoice ID', key: 'invoice_id', width: 10 },
    { header: 'Invoice No', key: 'invoice_no', width: 20 },
    { header: 'Amount', key: 'amount', width: 16, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Mode', key: 'mode', width: 10 },
    { header: 'Reference No', key: 'reference_no', width: 20 },
    { header: 'Payment Date', key: 'payment_date', width: 14 },
    { header: 'Notes', key: 'notes', width: 30 },
    { header: 'Created At', key: 'created_at', width: 14 },
  ];

  payments.forEach((r) => {
    paymentsSheet.addRow({
      id: r.id,
      customer_id: r.customer_id,
      customer_name: r.customer_name || '',
      invoice_id: r.invoice_id,
      invoice_no: r.invoice_no || '',
      amount: Number(r.amount) || 0,
      mode: r.mode,
      reference_no: r.reference_no || '',
      payment_date: formatDateValue(r.payment_date),
      notes: r.notes || '',
      created_at: formatDateValue(r.created_at),
    });
  });

  applyHeaderStyle(paymentsSheet);
  freezeHeaderRow(paymentsSheet);
  autoFitColumns(paymentsSheet);

  // ---- Sheet 6: Customer Ledger (last 2 years) ----
  const ledgerSheet = workbook.addWorksheet('Ledger');
  const twoYearsAgo = new Date();
  twoYearsAgo.setFullYear(twoYearsAgo.getFullYear() - 2);
  const twoYearsAgoStr = twoYearsAgo.toISOString().slice(0, 10);

  const { rows: ledger } = await pool.query(
    `SELECT cl.id, cl.customer_id, c.name AS customer_name,
            cl.date, cl.entry_type, cl.reference_id, cl.reference_type,
            cl.debit, cl.credit, cl.balance, cl.description, cl.created_at
     FROM customer_ledger cl
     JOIN customers c ON c.id = cl.customer_id
     WHERE cl.date >= $1
     ORDER BY cl.customer_id, cl.id`,
    [twoYearsAgoStr]
  );

  ledgerSheet.columns = [
    { header: 'ID', key: 'id', width: 8 },
    { header: 'Customer ID', key: 'customer_id', width: 12 },
    { header: 'Customer', key: 'customer_name', width: 25 },
    { header: 'Date', key: 'date', width: 14 },
    { header: 'Entry Type', key: 'entry_type', width: 14 },
    { header: 'Reference ID', key: 'reference_id', width: 12 },
    { header: 'Reference Type', key: 'reference_type', width: 14 },
    { header: 'Debit', key: 'debit', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Credit', key: 'credit', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Balance', key: 'balance', width: 14, style: { numFmt: CURRENCY_FORMAT } },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Created At', key: 'created_at', width: 14 },
  ];

  ledger.forEach((r) => {
    ledgerSheet.addRow({
      id: r.id,
      customer_id: r.customer_id,
      customer_name: r.customer_name,
      date: formatDateValue(r.date),
      entry_type: r.entry_type,
      reference_id: r.reference_id,
      reference_type: r.reference_type || '',
      debit: Number(r.debit) || 0,
      credit: Number(r.credit) || 0,
      balance: Number(r.balance) || 0,
      description: r.description || '',
      created_at: formatDateValue(r.created_at),
    });
  });

  applyHeaderStyle(ledgerSheet);
  freezeHeaderRow(ledgerSheet);
  autoFitColumns(ledgerSheet);

  // Stream directly to the response
  await workbook.xlsx.write(res);
}

// Report PDFs share the same containment as invoice PDFs.
async function disabledReportPdf() {
  throw require('../../utils/documentContainment').disabledDocumentError('PDF');
}

module.exports = {
  buildSalesExport,
  buildGstExport,
  buildStockExport,
  buildStockMovementExport,
  buildCustomerDuesExport,
  buildProfitExport,
  buildCollectionsExport,
  buildFullDataExport,
  // PDF exports
  buildSalesPdfExport: disabledReportPdf,
  buildGstPdfExport: disabledReportPdf,
  buildStockPdfExport: disabledReportPdf,
  buildStockMovementPdfExport: disabledReportPdf,
  buildCustomerDuesPdfExport: disabledReportPdf,
  buildProfitPdfExport: disabledReportPdf,
  buildCollectionsPdfExport: disabledReportPdf,
};
