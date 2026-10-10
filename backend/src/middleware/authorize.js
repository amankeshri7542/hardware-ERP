const CAPABILITIES = Object.freeze({
  admin: Object.freeze(['catalog.read', 'catalog.write', 'stock.read', 'stock.adjust', 'cost.read',
    'billing.create', 'invoices.read', 'returns.create', 'customers.read', 'customers.write',
    'suppliers.read', 'suppliers.write', 'purchases.read', 'purchases.write', 'payments.read',
    'payments.write', 'dashboard.read', 'reports.read', 'exports.read', 'settings.read', 'finance.read', 'finance.write', 'documents.read', 'documents.write']),
  cashier: Object.freeze(['catalog.read']),
});

// New endpoints have no privilege until explicitly classified here.
const ROUTES = [
  ['GET', /^\/documents(?:\/(?:capabilities|[a-fA-F0-9-]+(?:\/download)?))?\/?$/, 'documents.read'],
  ['POST', /^\/documents(?:\/[a-fA-F0-9-]+\/retry)?\/?$/, 'documents.write'],
  ['GET', /^\/finance\/(?:customers|suppliers)\/\d+(?:\/statement)?\/?$/, 'finance.read'],
  ['GET', /^\/finance\/statements\/(?:customer|supplier)\/\d+\/?$/, 'finance.read'],
  ['GET', /^\/finance\/(?:anonymous|days|reports|summary|export\.csv)\/?$/, 'finance.read'],
  ['POST', /^\/finance\/(?:customer|supplier)\/(?:quote|commands)\/?$/, 'finance.write'],
  ['POST', /^\/finance\/days\/(?:quote|open|close)\/?$/, 'finance.write'],
  ['GET', /^\/products(?:\/(?:search|low-stock|barcode\/[^/]+|\d+(?:\/unit-conversions)?))?\/?$/, 'catalog.read'],
  ['GET', /^\/products\/\d+\/stock-ledger\/?$/, 'stock.read'],
  ['GET', /^\/products\/\d+\/(?:price-history|suppliers)\/?$/, 'cost.read'],
  ['POST', /^\/products(?:\/\d+\/(?:suppliers|unit-conversions))?\/?$/, 'catalog.write'],
  ['PUT', /^\/products\/\d+\/?$/, 'catalog.write'],
  ['POST', /^\/products\/\d+\/stock-adjustments\/?$/, 'stock.adjust'],
  ['DELETE', /^\/products\/(?:\d+|unit-conversions\/\d+)\/?$/, 'catalog.write'],
  ['GET', /^\/customers(?:\/(?:search|\d+(?:\/(?:ledger|summary))?))?\/?$/, 'customers.read'],
  ['POST', /^\/customers\/?$/, 'customers.write'],
  ['PUT', /^\/customers\/\d+\/?$/, 'customers.write'],
  ['DELETE', /^\/customers\/\d+\/?$/, 'customers.write'],
  ['GET', /^\/suppliers(?:\/\d+(?:\/(?:products|debit-notes))?)?\/?$/, 'suppliers.read'],
  ['POST', /^\/suppliers\/?$/, 'suppliers.write'],
  ['PUT', /^\/suppliers\/\d+\/?$/, 'suppliers.write'],
  ['GET', /^\/purchases(?:\/\d+(?:\/returns)?)?\/?$/, 'purchases.read'],
  ['GET', /^\/purchases\/[^/]+\/invoice\/?$/, 'purchases.read'],
  ['POST', /^\/purchases\/?$/, 'purchases.write'],
  ['POST', /^\/purchases\/quote\/?$/, 'purchases.write'],
  ['POST', /^\/purchases\/[^/]+\/invoice\/?$/, 'purchases.write'],
  ['PUT', /^\/purchases\/\d+\/notes\/?$/, 'purchases.write'],
  ['POST', /^\/purchases\/\d+\/returns\/?$/, 'returns.create'],
  ['POST', /^\/purchases\/\d+\/returns\/quote\/?$/, 'returns.create'],
  ['GET', /^\/payments(?:\/invoice\/\d+)?\/?$/, 'payments.read'],
  ['POST', /^\/payments\/?$/, 'payments.write'],
  ['GET', /^\/invoices(?:\/\d+(?:\/(?:pdf|pdf-status))?)?\/?$/, 'invoices.read'],
  ['POST', /^\/invoices\/?$/, 'billing.create'],
  ['POST', /^\/invoices\/quote\/?$/, 'billing.create'],
  ['POST', /^\/invoices\/\d+\/return\/?$/, 'returns.create'],
  ['POST', /^\/invoices\/\d+\/return\/quote\/?$/, 'returns.create'],
  ['POST', /^\/invoices\/\d+\/regenerate-pdf\/?$/, 'invoices.read'],
  ['GET', /^\/dashboard\/(?:summary|sales-overview|overdue-invoices|overdue-customers|recent-activity|payment-modes)\/?$/, 'dashboard.read'],
  ['GET', /^\/reports\/(?:sales|gst|stock|stock-movement|customer-dues|profit|collections|product-categories)\/?$/, 'reports.read'],
  ['GET', /^\/reports\/(?:(?:sales|gst|stock|stock-movement|customer-dues|profit|collections)\/(?:export|export-pdf)|full-export)\/?$/, 'exports.read'],
  ['GET', /^\/settings\/?$/, 'settings.read'],
];

function capabilitiesFor(role) {
  return Object.hasOwn(CAPABILITIES, role) ? CAPABILITIES[role] : [];
}

const PRODUCT_FIELDS = ['id', 'name', 'category', 'sku', 'barcode', 'unit', 'base_unit', 'mrp',
  'wholesale_price', 'current_stock', 'gst_rate', 'hsn_code', 'min_stock', 'is_active',
  'created_at', 'updated_at', 'stock_status', 'score'];
const CONVERSION_FIELDS = ['id', 'product_id', 'unit_name', 'conversion_value', 'is_purchase_unit', 'is_sales_unit'];
function pick(value, fields) {
  return Object.fromEntries(fields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]));
}

function redactCatalog(body) {
  if (!body.success || !body.data) return body;
  const data = body.data;
  if (Array.isArray(data.products)) {
    return { success: true, data: {
      ...pick(data, ['pagination', 'count', 'searchType', 'query']),
      products: data.products.map((product) => pick(product, PRODUCT_FIELDS)),
    } };
  }
  if (Array.isArray(data.conversions)) return { success: true, data: {
    ...pick(data, PRODUCT_FIELDS),
    conversions: data.conversions.map((conversion) => pick(conversion, CONVERSION_FIELDS)),
  } };
  return { success: true, data: pick(data, PRODUCT_FIELDS) };
}

function authorize(req, res, next) {
  const method = req.method === 'HEAD' ? 'GET' : req.method;
  const route = ROUTES.find(([verb, pattern]) => verb === method && pattern.test(req.path));
  const capabilities = capabilitiesFor(req.user.role);
  const stockAdjustment = route?.[2] === 'catalog.write' && req.body && Object.hasOwn(req.body, 'current_stock');
  if (!route || !capabilities.includes(route[2]) || (stockAdjustment && !capabilities.includes('stock.adjust'))) {
    require('../utils/securityLog').securityLog('authorization.denied', {
      requestId: req.requestId, userId: req.user.id, method: req.method, status: 403,
    });
    return res.status(403).json({ success: false, error: 'Permission denied', code: 'FORBIDDEN' });
  }
  if (route[2] === 'catalog.read' && !capabilitiesFor(req.user.role).includes('cost.read')) {
    const json = res.json.bind(res);
    res.json = (body) => json(redactCatalog(body));
  }
  return next();
}

module.exports = { authorize, capabilitiesFor, redactCatalog };
