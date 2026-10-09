const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const errorHandler = require('./middleware/errorHandler');
const { validateEnvironment } = require('./config/env');
const { requestContext } = require('./utils/securityLog');
const checkOrigin = require('./middleware/checkOrigin');
const authenticateSession = require('./middleware/authenticateJWT');
const { authorize } = require('./middleware/authorize');
const config = validateEnvironment();

const app = express();

app.set('trust proxy', config.trustProxy);
app.use(requestContext);

// Security headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      fontSrc: ["'self'", 'data:'],
      objectSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));

// Global API rate limiter: 200 requests per minute per IP
const apiLimiter = rateLimit({
  keyGenerator: require('./middleware/rateLimitKey'),
  windowMs: 60 * 1000,
  max: 200,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many requests. Please slow down.', code: 'RATE_LIMIT' },
});
app.use('/api/', apiLimiter);

app.use(cors({ origin: config.corsOrigins, credentials: true }));
app.use('/api', checkOrigin);

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Cookie parser
app.use(cookieParser());

// Health check
app.get('/api/health', (req, res) => {
  res.json({ success: true, message: 'Hardware ERP API is running' });
});

// Mount module routers
const authRouter = require('./modules/auth/auth.router');
app.use('/api/auth', authRouter);
app.use('/api', authenticateSession, authorize);

const productsRouter = require('./modules/products/products.router');
app.use('/api/products', productsRouter);

const { suppliersRouter, purchasesRouter } = require('./modules/purchases/purchases.router');
app.use('/api/suppliers', suppliersRouter);
app.use('/api/purchases', purchasesRouter);

const paymentsRouter = require('./modules/payments/payments.router');
app.use('/api/payments', paymentsRouter);

const invoicesRouter = require('./modules/invoices/invoices.router');
app.use('/api/invoices', invoicesRouter);

const customersRouter = require('./modules/customers/customers.router');
app.use('/api/customers', customersRouter);

const dashboardRouter = require('./modules/dashboard/dashboard.router');
app.use('/api/dashboard', dashboardRouter);

const reportsRouter = require('./modules/reports/reports.router');
const exportsRouter = require('./modules/reports/exports.router');
app.use('/api/reports', reportsRouter);
app.use('/api/reports', exportsRouter);

const settingsRouter = require('./modules/settings/settings.router');
app.use('/api/settings', settingsRouter);

// Serve Frontend in Production (fallback if nginx is not used)
// When nginx handles static files, this block is harmless but provides a safety net.
if (process.env.NODE_ENV === 'production') {
  const path = require('path');
  const frontendDistPath = path.join(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDistPath));

  // Only serve index.html for non-API routes (avoid catching /api/* 404s)
  app.get(/^(?!\/api).*/, (req, res, next) => {
    const indexPath = path.join(frontendDistPath, 'index.html');
    const fs = require('fs');
    if (fs.existsSync(indexPath)) {
      res.sendFile(indexPath);
    } else {
      next();
    }
  });
}

// Global error handler (must be last)
app.use(errorHandler);

module.exports = app;
