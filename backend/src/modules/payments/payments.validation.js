const { normalizePaymentIntent } = require('./paymentPosting');

function recordPaymentSchema(req, res, next) {
  try {
    normalizePaymentIntent(req.body);
    next();
  } catch (error) { next(error); }
}

module.exports = { recordPaymentSchema };
