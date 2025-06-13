const express = require('express');
const router = express.Router();

const authRoutes = require('./auth');
const animalRoutes = require('./animals');
const notificationRoutes = require('./notifications');
// const userRoutes = require('./users');
// const slRoutes = require('./sl');

// API versioning
router.use('/v1/auth', authRoutes);
router.use('/v1/animals', animalRoutes);
router.use('/v1/notifications', notificationRoutes);
// router.use('/v1/users', userRoutes);
// router.use('/v1/sl', slRoutes);

// Health check endpoint
router.get('/health', (req, res) => {
    res.json({
        success: true,
        message: 'Farmheart API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
    });
});

// API documentation endpoint
router.get('/', (req, res) => {
    res.json({
        success: true,
        message: 'Welcome to Farmheart API',
        version: '1.0.0',
        documentation: '/docs',
        endpoints: {
            auth: '/api/v1/auth',
            animals: '/api/v1/animals',
            users: '/api/v1/users',
            sl: '/api/v1/sl'
        }
    });
});

module.exports = router;