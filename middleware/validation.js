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

// Animal validation rules
const validateAnimalRegistration = [
    body('ownerUsername')
        .trim()
        .notEmpty()
        .withMessage('Owner username is required'),
    body('breedType')
        .trim()
        .isIn(['horse', 'dog', 'cat'])
        .withMessage('Breed type must be horse, dog, or cat'),
    body('gender')
        .isIn(['male', 'female'])
        .withMessage('Gender must be male or female'),
    body('animalName')
        .optional()
        .trim()
        .isLength({ max: 100 })
        .withMessage('Animal name must be 100 characters or less'),
    body('slRegion')
        .optional()
        .trim()
        .isLength({ max: 255 })
        .withMessage('SL region name too long'),
    body('traits')
        .optional()
        .isObject()
        .withMessage('Traits must be an object'),
    handleValidationErrors
];

const validateAnimalStats = [
    body('hungerPercent')
        .optional()
        .isInt({ min: 0, max: 100 })
        .withMessage('Hunger percent must be between 0 and 100'),
    body('happinessPercent')
        .optional()
        .isInt({ min: 0, max: 100 })
        .withMessage('Happiness percent must be between 0 and 100'),
    body('heatPercent')
        .optional()
        .isInt({ min: 0, max: 100 })
        .withMessage('Heat percent must be between 0 and 100'),
    body('ageDays')
        .optional()
        .isInt({ min: 0 })
        .withMessage('Age days must be a positive integer'),
    body('isBreedable')
        .optional()
        .isBoolean()
        .withMessage('Is breedable must be a boolean'),
    body('isOperable')
        .optional()
        .isBoolean()
        .withMessage('Is operable must be a boolean'),
    body('slRegion')
        .optional()
        .trim()
        .isLength({ max: 255 })
        .withMessage('SL region name too long'),
    handleValidationErrors
];

const validateBreeding = [
    body('motherSlObjectKey')
        .isUUID()
        .withMessage('Mother SL object key must be a valid UUID'),
    body('fatherSlObjectKey')
        .isUUID()
        .withMessage('Father SL object key must be a valid UUID'),
    body('breedingRegion')
        .trim()
        .notEmpty()
        .withMessage('Breeding region is required'),
    body('isTwins')
        .optional()
        .isBoolean()
        .withMessage('Is twins must be a boolean'),
    body('offspringData')
        .optional()
        .isArray()
        .withMessage('Offspring data must be an array'),
    handleValidationErrors
];

const validateConsumption = [
    body('consumableType')
        .trim()
        .isIn(['basic_food', 'breeding_food', 'minerals'])
        .withMessage('Consumable type must be basic_food, breeding_food, or minerals'),
    body('amount')
        .optional()
        .isInt({ min: 1 })
        .withMessage('Amount must be a positive integer'),
    handleValidationErrors
];

module.exports = {
    validateRegistration,
    validateLogin,
    validateSLVerification,
    validateAnimalRegistration,
    validateAnimalStats,
    validateBreeding,
    validateConsumption,
    handleValidationErrors
};