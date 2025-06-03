const { body, validationResult } = require('express-validator');

const handleValidationErrors = (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
        return res.status(400).json({
            success: false,
            error: 'Validation failed',
            details: errors.array()
        });
    }
    next();
};

const validateRegistration = [
    body('slUsername')
        .trim()
        .isLength({ min: 3, max: 100 })
        .withMessage('SL Username must be between 3 and 100 characters')
        .matches(/^[A-Za-z]+\s[A-Za-z]+$/)
        .withMessage('SL Username must be in format "FirstName LastName"'),
    body('password')
        .isLength({ min: 8, max: 128 })
        .withMessage('Password must be between 8 and 128 characters')
        .matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
        .withMessage('Password must contain at least one lowercase letter, one uppercase letter, and one number'),
    body('email')
        .optional()
        .isEmail()
        .normalizeEmail()
        .withMessage('Must be a valid email address'),
    handleValidationErrors
];

const validateLogin = [
    body('slUsername')
        .trim()
        .notEmpty()
        .withMessage('SL Username is required'),
    body('password')
        .notEmpty()
        .withMessage('Password is required'),
    handleValidationErrors
];

const validateSLVerification = [
    body('slUsername')
        .trim()
        .notEmpty()
        .withMessage('SL Username is required'),
    body('verificationCode')
        .trim()
        .isLength({ min: 4, max: 10 })
        .withMessage('Verification code must be between 4 and 10 characters'),
    body('slUuid')
        .optional()
        .isUUID()
        .withMessage('Invalid SL UUID format'),
    handleValidationErrors
];

module.exports = {
    validateRegistration,
    validateLogin,
    validateSLVerification,
    handleValidationErrors
};