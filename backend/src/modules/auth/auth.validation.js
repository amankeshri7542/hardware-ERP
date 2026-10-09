const { body } = require('express-validator');

const loginSchema = [
  body('email')
    .isString().bail()
    .isLength({ max: 255 }).bail()
    .notEmpty()
    .withMessage('Username is required')
    .trim(),
  body('password')
    .isString().bail()
    .custom((value) => Buffer.byteLength(value, 'utf8') <= 72).withMessage('Invalid password length').bail()
    .notEmpty()
    .withMessage('Password is required'),
];

module.exports = { loginSchema };
