const { fail } = require('../utils/financial');

// A shared browser cookie may change while another tab retains an uncertain intent.
// Bind that intent to its original actor before any idempotency lookup or write.
module.exports = function requireFinancialActor(req, res, next) {
  try {
    const actor = req.get('Idempotency-Actor');
    if (typeof actor !== 'string' || !/^[1-9]\d{0,9}$/.test(actor) || Number(actor) > 2147483647) {
      fail('INVALID_OPERATION_ACTOR', 400);
    }
    if (Number(actor) !== req.user.id) fail('OPERATION_ACTOR_MISMATCH', 409);
    next();
  } catch (error) { next(error); }
};
