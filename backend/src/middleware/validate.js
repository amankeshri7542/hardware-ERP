const { validationResult } = require('express-validator');

/**
 * Express middleware that checks express-validator results.
 * If there are validation errors, responds with 422 and the field errors.
 * Otherwise calls next().
 */
function validate(req, res, next) {
  const errors = validationResult(req);

  if (!errors.isEmpty()) {
    require('../utils/securityLog').securityLog('validation.failed', {
      requestId: req.requestId, method: req.method, status: 422,
    });
    return res.status(422).json({
      success: false,
      errors: errors.array().map((err) => ({
        field: err.path,
        message: err.msg,
      })),
    });
  }

  return next();
}

module.exports = validate;
