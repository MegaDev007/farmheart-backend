
const AuthService = require('../services/authService');
const logger = require('../utils/logger');

class AuthController {
    static async register(req, res, next) {
        try {
            const { slUsername, password, email } = req.body;
            const ipAddress = req.ip;

            const result = await AuthService.register(slUsername, password, email);

            res.status(201).json({
                success: true,
                message: 'Account created successfully. Please verify your SL identity.',
                data: {
                    userId: result.user.id,
                    slUsername: result.user.slUsername,
                    verificationCode: result.verificationCode,
                    expiresAt: result.expiresAt,
                    instructions: 'Go to your SL account and send this verification code to our in-world verification system within 30 minutes.'
                }
            });

        } catch (error) {
            if (error.message.includes('already exists')) {
                return res.status(409).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    static async login(req, res, next) {
        try {
            const { slUsername, password } = req.body;
            const ipAddress = req.ip;
            const userAgent = req.get('User-Agent');

            const result = await AuthService.login(slUsername, password, ipAddress, userAgent);

            res.json({
                success: true,
                message: 'Login successful',
                data: {
                    token: result.token,
                    user: result.user,
                    expiresAt: result.expiresAt
                }
            });

        } catch (error) {
            if (error.message.includes('Invalid credentials') || 
                error.message.includes('not verified') ||
                error.message.includes('deactivated')) {
                return res.status(401).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    static async verifySL(req, res, next) {
        try {
            const { slUsername, verificationCode, slUuid, slObjectKey } = req.body;
            const ipAddress = req.ip;

            const result = await AuthService.verifySLIdentity(
                slUsername, 
                verificationCode, 
                slUuid, 
                slObjectKey, 
                ipAddress
            );

            res.json({
                success: true,
                message: result.message,
                data: {
                    user: result.user
                }
            });

        } catch (error) {
            if (error.message.includes('Invalid or expired')) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    static async logout(req, res, next) {
        try {
            const { sessionToken } = req.user;

            await AuthService.logout(sessionToken);

            res.json({
                success: true,
                message: 'Logged out successfully'
            });

        } catch (error) {
            next(error);
        }
    }

    static async refreshToken(req, res, next) {
        try {
            const { sessionToken } = req.user;

            const result = await AuthService.refreshToken(sessionToken);

            res.json({
                success: true,
                message: 'Token refreshed successfully',
                data: {
                    token: result.token,
                    expiresAt: result.expiresAt
                }
            });

        } catch (error) {
            if (error.message.includes('Invalid or expired')) {
                return res.status(401).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    static async getProfile(req, res, next) {
        try {
            const { userId } = req.user;
            const User = require('../models/User');

            const user = await User.findById(userId);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            res.json({
                success: true,
                data: {
                    user: user.toJSON()
                }
            });

        } catch (error) {
            next(error);
        }
    }

    static async getSessions(req, res, next) {
        try {
            const { userId } = req.user;

            const sessions = await AuthService.getUserSessions(userId);

            res.json({
                success: true,
                data: {
                    sessions
                }
            });

        } catch (error) {
            next(error);
        }
    }

    static async revokeSession(req, res, next) {
        try {
            const { userId } = req.user;
            const { sessionId } = req.params;

            await AuthService.revokeSession(userId, parseInt(sessionId));

            res.json({
                success: true,
                message: 'Session revoked successfully'
            });

        } catch (error) {
            if (error.message.includes('not found')) {
                return res.status(404).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }

    static async checkAuth(req, res) {
        // This endpoint is just for checking if user is authenticated
        // The middleware already validates the token
        res.json({
            success: true,
            data: {
                user: {
                    id: req.user.userId,
                    slUsername: req.user.slUsername
                },
                authenticated: true
            }
        });
    }
}

module.exports = AuthController;