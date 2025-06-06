const AuthService = require('../services/authService');
const VerificationService = require('../services/verificationService');
const logger = require('../utils/logger');
const User = require('../models/user');


class AuthController {

    static async validateSlUsername(req, res, next) {
        try {
            const { slUsername, email } = req.body;
            
            const result = await AuthService.validateSlUsername(slUsername, email);
            
            if (!result.isValid) {
                return res.status(400).json({
                    success: false,
                    error: result.message
                });
            }

            res.json({
                success: true,
                message: result.message
            });

        } catch (error) {
            next(error);
        }
    }

    static async register(req, res, next) {
        try {
            const { slUsername, password, email } = req.body;
            
            // Check if user already exists
            const existingUser = await User.findBySlUsername(slUsername);
            if (existingUser) {
                return res.status(409).json({
                    success: false,
                    error: 'User with this SL username already exists'
                });
            }
            
            // Create user (unverified)
            const user = await User.create({ slUsername, password, email });
            
            // Generate verification code in Redis
            const verification = await VerificationService.generateVerificationCode(slUsername, email)
            
            res.status(201).json({
                success: true,
                message: 'Account created successfully. Please verify your SL identity.',
                data: {
                    userId: user.id,
                    slUsername: user.slUsername,
                    verificationCode: verification.code,
                    expiresAt: verification.expiresAt
                }
            });
            
        } catch (error) {
            next(error);
        }
    }

    static async login(req, res, next) {
        try {
            const { slName, password } = req.body;
            const ipAddress = req.ip;
            const userAgent = req.get('User-Agent');
    
            const result = await AuthService.login(slName, password, ipAddress, userAgent);
    
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
            if (error.message.includes('Invalid credentials')) {
                return res.status(401).json({
                    success: false,
                    error: error.message
                });
            }
            
            // Handle unverified user case
            if (error.isUnverified) {
                try {
                    // Generate a fresh verification code for the unverified user
                    const verification = await VerificationService.generateVerificationCode(
                        error.userData.slUsername, 
                        error.userData.email
                    );
    
                    return res.status(403).json({
                        success: false,
                        error: error.message,
                        needsVerification: true,
                        userData: {
                            email: error.userData.email,
                            slUsername: error.userData.slUsername,
                            verificationCode: verification.code,
                            expiresAt: verification.expiresAt
                        }
                    });
                } catch (verificationError) {
                    logger.error('Failed to generate verification code for unverified login:', verificationError);
                    return res.status(403).json({
                        success: false,
                        error: error.message,
                        needsVerification: true,
                        userData: {
                            email: error.userData.email,
                            slUsername: error.userData.slUsername
                        }
                    });
                }
            }
            
            // Handle the case where error doesn't have isUnverified flag but message indicates unverified
            if (error.message.includes('not verified')) {
                try {
                    // We need to get user data from the database since it wasn't in the error
                    const User = require('../models/user');
                    const user = await User.findBySlUsername(slName);
                    
                    if (user && !user.isVerified) {
                        // Generate a fresh verification code
                        const verification = await VerificationService.generateVerificationCode(
                            user.slUsername, 
                            user.email
                        );
    
                        return res.status(403).json({
                            success: false,
                            error: error.message,
                            needsVerification: true,
                            userData: {
                                email: user.email,
                                slUsername: user.slUsername,
                                verificationCode: verification.code,
                                expiresAt: verification.expiresAt
                            }
                        });
                    }
                } catch (verificationError) {
                    logger.error('Failed to handle unverified user:', verificationError);
                    // Fall back to basic error response
                    return res.status(403).json({
                        success: false,
                        error: error.message
                    });
                }
            }
            
            if (error.message.includes('deactivated')) {
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

            // Extract username from full SL name (e.g., "byddev Resident" -> "byddev")
            const username = slUsername.split(' ')[0];
            
            if (!username) {
                return res.status(400).json({
                    success: false,
                    error: 'Invalid SL username format'
                });
            }
            
            const result = await VerificationService.verifyCode(
                username, 
                verificationCode, 
                slUuid, 
                slObjectKey
            );
            
            res.json({
                success: true,
                message: result.message,
                data: {
                    user: result.user
                }
            });
            
        } catch (error) {
            if (error.message.includes('Invalid') || 
                error.message.includes('expired') ||
                error.message.includes('not match')) {
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

    static async updateVerificationCode(req, res, next) {
        try {
            const { slUsername } = req.body;
            const User = require('../models/user');
            const { generateVerificationCode } = require('../utils/generators');
            const authConfig = require('../config/auth');

            // Find user by username
            const user = await User.findBySlUsername(slUsername);
            if (!user) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }
            if (user.isVerified) {
                return res.status(400).json({
                    success: false,
                    error: 'User already verified'
                });
            }

            // Generate and set new code
            const newCode = generateVerificationCode();
            const { expiresAt } = await user.setVerificationCode(newCode, authConfig.verification.codeExpiresMinutes);

            res.json({
                success: true,
                message: 'Verification code updated',
                data: {
                    slUsername: user.slUsername,
                    verificationCode: newCode,
                    expiresAt
                }
            });
        } catch (error) {
            next(error);
        }
    }

    // Check verification status for frontend polling
    static async checkVerification(req, res, next) {
        try {
            const { slUsername } = req.body;
            
            if (!slUsername) {
                return res.status(400).json({
                    success: false,
                    error: 'SL username is required'
                });
            }
            
            const status = await VerificationService.checkVerificationStatus(slUsername);
            
            res.json({
                success: true,
                data: status
            });
            
        } catch (error) {
            next(error);
        }
    }

    static async refreshVerificationCode(req, res, next) {
        try {
            logger.info('refresh-verification-code handler called', { body: req.body });
            const { email } = req.body;
            
            if (!email) {
                return res.status(400).json({
                    success: false,
                    error: 'Email is required'
                });
            }
            
            const verification = await VerificationService.refreshVerificationCode(email);
            
            logger.info('Verification code generated', { code: verification.code, user: req.body.user });
            res.json({
                success: true,
                message: 'Verification code refreshed successfully',
                data: {
                    verificationCode: verification.code,
                    expiresAt: verification.expiresAt
                }
            });
            
        } catch (error) {
            logger.error('Error in refresh-verification-code:', error);
            if (error.message.includes('not found') || 
                error.message.includes('already verified')) {
                return res.status(400).json({
                    success: false,
                    error: error.message
                });
            }
            next(error);
        }
    }
}

module.exports = AuthController;