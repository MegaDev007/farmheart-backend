const express = require('express');
const router = express.Router();

const AuthController = require('../controllers/authController');
const { authenticateToken } = require('../middleware/auth');
const { authLimiter } = require('../middleware/rateLimiting');
const { 
    validateRegistration, 
    validateLogin, 
    validateSLVerification 
} = require('../middleware/validation');

// Public routes
router.post('/register', authLimiter, validateRegistration, AuthController.register);
router.post('/login', authLimiter, validateLogin, AuthController.login);
router.post('/verify-sl', validateSLVerification, AuthController.verifySL);

// Protected routes
router.post('/logout', authenticateToken, AuthController.logout);
router.post('/refresh', authenticateToken, AuthController.refreshToken);
router.get('/profile', authenticateToken, AuthController.getProfile);
router.get('/check', authenticateToken, AuthController.checkAuth);

// Session management
router.get('/sessions', authenticateToken, AuthController.getSessions);
router.delete('/sessions/:sessionId', authenticateToken, AuthController.revokeSession);

module.exports = router;