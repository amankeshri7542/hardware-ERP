const asyncHandler = require('../../utils/asyncHandler');
const reportsService = require('./reports.service');

const getSalesReport = asyncHandler(async (req, res) => {
  const { from, to, bill_type, customer_id, page, limit } = req.query;
  const data = await reportsService.getSalesReport({
    from,
    to,
    billType: bill_type || null,
    customerId: customer_id ? parseInt(customer_id, 10) : null,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
  });
  return res.json({ success: true, data });
});

const getGstReport = asyncHandler(async (req, res) => {
  const { month, year } = req.query;
  const data = await reportsService.getGstReport({
    month: month || null,
    year: year || null,
  });
  return res.json({ success: true, data });
});

const getStockReport = asyncHandler(async (req, res) => {
  const { category, lowStockOnly } = req.query;
  const data = await reportsService.getStockReport({
    category: category || null,
    lowStockOnly: lowStockOnly === 'true',
  });
  return res.json({ success: true, data });
});

const getStockMovementReport = asyncHandler(async (req, res) => {
  const { from, to, productId, movementType, page, limit } = req.query;
  const data = await reportsService.getStockMovementReport({
    from,
    to,
    productId: productId ? parseInt(productId, 10) : null,
    movementType: movementType || null,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
  });
  return res.json({ success: true, data });
});

const getCustomerDuesReport = asyncHandler(async (req, res) => {
  const { overdueOnly, customerType, as_of, page, limit } = req.query;
  const data = await reportsService.getCustomerDuesReport({
    as_of,
    overdueOnly: overdueOnly === 'true',
    customerType: customerType || null,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
  });
  return res.json({ success: true, data });
});

const getProfitReport = asyncHandler(async (req, res) => {
  const { from, to, page, limit } = req.query;
  const data = await reportsService.getProfitReport({
    from,
    to,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
  });
  return res.json({ success: true, data });
});

const getPaymentCollectionsReport = asyncHandler(async (req, res) => {
  const { from, to, mode, page, limit } = req.query;
  const data = await reportsService.getPaymentCollectionsReport({
    from,
    to,
    mode: mode || null,
    page: Math.max(1, parseInt(page, 10) || 1),
    limit: Math.min(100, Math.max(1, parseInt(limit, 10) || 50)),
  });
  return res.json({ success: true, data });
});

const getProductCategories = asyncHandler(async (req, res) => {
  const data = await reportsService.getProductCategories();
  return res.json({ success: true, data });
});

module.exports = {
  getSalesReport,
  getGstReport,
  getStockReport,
  getStockMovementReport,
  getCustomerDuesReport,
  getProfitReport,
  getPaymentCollectionsReport,
  getProductCategories,
};
