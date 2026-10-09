const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const { login, logout, session } = require('./auth.controller');
const authenticateSession = require('../../middleware/authenticateJWT');
const checkOrigin = require('../../middleware/checkOrigin');
const { loginSchema } = require('./auth.validation');
const validate = require('../../middleware/validate');

// Limit login attempts: 5 per 15 minutes per IP
const loginLimiter = rateLimit({
  keyGenerator: require('../../middleware/rateLimitKey'),
  windowMs: 15 * 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, error: 'Too many login attempts. Try again in 15 minutes.', code: 'RATE_LIMIT' },
});

router.use(checkOrigin);
router.post('/login', loginLimiter, loginSchema, validate, login);
router.post('/logout', logout);
router.get('/session', authenticateSession, session);
router.post('/refresh', authenticateSession, session);

module.exports = router;
