const logger = require('../utils/logger');

const errorHandler = (err, req, res, next) => {
    logger.error('Error occurred:', {
        error: err.message,
        stack: err.stack,
        url: req.url,
        method: req.method,
        ip: req.ip
    });

    // Default error
    let error = { ...err };
    error.message = err.message;

    // PostgreSQL errors
    if (err.code === '23505') {
        error.message = 'Duplicate entry - resource already exists';
        error.statusCode = 409;
    }

    if (err.code === '23503') {
        error.message = 'Referenced resource not found';
        error.statusCode = 400;
    }

    // Validation errors
    if (err.name === 'ValidationError') {
        error.message = 'Invalid input data';
        error.statusCode = 400;
    }

    res.status(error.statusCode || 500).json({
        success: false,
        error: error.message || 'Internal Server Error'
    });
};

module.exports = errorHandler;