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
router.post('/validate-sl-username', authLimiter, AuthController.validateSlUsername);
router.post('/register', authLimiter, AuthController.register);
router.post('/login', authLimiter, AuthController.login);
router.post('/verify-sl', authLimiter, AuthController.verifySL);
router.post('/update-verification-code', authLimiter, AuthController.updateVerificationCode);
router.post('/check-verification', AuthController.checkVerification);
router.post('/refresh-verification-code', AuthController.refreshVerificationCode);

// Protected routes
router.post('/logout', authenticateToken, AuthController.logout);
router.post('/refresh', authenticateToken, AuthController.refreshToken);
router.get('/profile', authenticateToken, AuthController.getProfile);
router.get('/check', authenticateToken, AuthController.checkAuth);

// Session management
router.get('/sessions', authenticateToken, AuthController.getSessions);
router.delete('/sessions/:sessionId', authenticateToken, AuthController.revokeSession);

module.exports = router;