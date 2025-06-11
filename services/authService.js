const jwt = require('jsonwebtoken');
const crypto = require('crypto');
const { pool } = require('../config/database');
const authConfig = require('../config/auth');
const User = require('../models/user');
const logger = require('../utils/logger');
const { generateVerificationCode } = require('../utils/generators');

class AuthService {

    static async validateSlUsername(slUsername, email) {
        try {
            // SL usernames must be between 2 and 32 characters
            if (!slUsername || slUsername.length < 2 || slUsername.length > 32) {
                throw new Error('SL username must be between 2 and 32 characters');
            }

            // SL usernames can only contain letters and numbers
            if (!/^[a-zA-Z0-9]+$/.test(slUsername)) {
                throw new Error('SL username can only contain letters and numbers');
            }

            // SL username cannot be only numbers
            if (/^\d+$/.test(slUsername)) {
                throw new Error('SL username cannot contain only numbers');
            }

            // Check if username is already taken
            const existingUser = await User.findBySlUsername(slUsername);
            if (existingUser) {
                throw new Error('This SL username is already taken');
            }

            // Check if email is already registered (if email is provided)
            if (email) {
                const existingEmail = await User.findByEmail(email);
                if (existingEmail) {
                    throw new Error('This email is already registered');
                }
            }

            return {
                isValid: true,
                message: 'SL username and email are valid'
            };

        } catch (error) {
            logger.error('Validation error', { 
                error: error.message, 
                slUsername,
                email 
            });
            
            return {
                isValid: false,
                message: error.message
            };
        }
    }

    // Register a new user
    static async register(slUsername, password, email) {
        try {
            // Check if user already exists
            const existingUser = await User.findBySlUsername(slUsername);
            if (existingUser) {
                throw new Error('User with this SL username already exists');
            }

            // Create user
            const user = await User.create({ slUsername, password, email });

            // Generate verification code
            const verificationCode = generateVerificationCode();
            const verificationData = await user.setVerificationCode(
                verificationCode, 
                authConfig.verification.codeExpiresMinutes
            );

            // Log registration attempt
            await pool.query(
                'INSERT INTO sl_verification_attempts (sl_username, verification_code, ip_address) VALUES ($1, $2, $3)',
                [slUsername, verificationCode, null] // IP will be added by controller
            );

            logger.info('User registered successfully', { 
                userId: user.id, 
                slUsername: user.slUsername 
            });

            return {
                user: user.toPublicJSON(),
                verificationCode,
                expiresAt: verificationData.expiresAt
            };

        } catch (error) {
            logger.error('Registration error', { error: error.message, slUsername });
            throw error;
        }
    }

    static async login(slUsername, password, ipAddress, userAgent) {
        try {

            // Find user
            const user = await User.findBySlUsername(slUsername);
            if (!user) {
                throw new Error('Invalid credentials');
            }
    
            // Validate password first
            const isValidPassword = await user.validatePassword(password);
            if (!isValidPassword) {
                throw new Error('Invalid credentials');
            }
    
            // Check if user is verified AFTER password validation
            if (!user.isVerified) {
                // Create a special error object with user data for unverified users
                const unverifiedError = new Error('Account not verified. Please complete SL verification first.');
                unverifiedError.isUnverified = true;
                unverifiedError.userData = {
                    email: user.email,
                    slUsername: user.slUsername,
                    userId: user.id
                };
                throw unverifiedError;
            }
    
            // Check if user is active
            if (!user.isActive) {
                throw new Error('Account is deactivated');
            }
    
            // Generate session
            const sessionData = await this.createSession(user.id, ipAddress, userAgent);
    
            // Update last login
            await user.updateLastLogin();
    
            logger.info('User logged in successfully', { 
                userId: user.id, 
                slUsername: user.slUsername 
            });
    
            return {
                user: user.toJSON(),
                token: sessionData.token,
                expiresAt: sessionData.expiresAt
            };
    
        } catch (error) {
            logger.error('Login error', { error: error.message, slUsername });
            throw error;
        }
    }

    static async createSession(userId, ipAddress, userAgent) {
        const sessionToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date(Date.now() + authConfig.session.expiresInDays * 24 * 60 * 60 * 1000);

        // Create session in database
        await pool.query(
            `INSERT INTO user_sessions (user_id, session_token, expires_at, ip_address, user_agent) 
             VALUES ($1, $2, $3, $4, $5)`,
            [userId, sessionToken, expiresAt, ipAddress, userAgent]
        );

        // Get user info for JWT
        const user = await User.findById(userId);

        // Generate JWT token
        const jwtToken = jwt.sign(
            { 
                userId: user.id, 
                slUsername: user.slUsername,
                sessionToken: sessionToken
            },
            authConfig.jwt.secret,
            { expiresIn: authConfig.jwt.expiresIn }
        );

        return {
            token: jwtToken,
            sessionToken,
            expiresAt
        };
    }

    static async logout(sessionToken) {
        try {
            const result = await pool.query(
                'DELETE FROM user_sessions WHERE session_token = $1 RETURNING user_id',
                [sessionToken]
            );

            if (result.rows.length > 0) {
                logger.info('User logged out successfully', { 
                    userId: result.rows[0].user_id 
                });
            }

            return { success: true };

        } catch (error) {
            logger.error('Logout error', { error: error.message, sessionToken });
            throw error;
        }
    }

    static async refreshToken(oldSessionToken) {
        try {
            // Find current session
            const sessionResult = await pool.query(
                `SELECT us.*, u.sl_username FROM user_sessions us 
                 JOIN users u ON us.user_id = u.id 
                 WHERE us.session_token = $1 AND us.expires_at > NOW()`,
                [oldSessionToken]
            );

            if (sessionResult.rows.length === 0) {
                throw new Error('Invalid or expired session');
            }

            const session = sessionResult.rows[0];

            // Delete old session
            await pool.query(
                'DELETE FROM user_sessions WHERE session_token = $1',
                [oldSessionToken]
            );

            // Create new session
            const newSessionData = await this.createSession(
                session.user_id, 
                session.ip_address, 
                session.user_agent
            );

            logger.info('Token refreshed successfully', { 
                userId: session.user_id 
            });

            return newSessionData;

        } catch (error) {
            logger.error('Token refresh error', { error: error.message });
            throw error;
        }
    }

    static async cleanupExpiredSessions() {
        try {
            const result = await pool.query(
                'DELETE FROM user_sessions WHERE expires_at < NOW()'
            );

            logger.info('Cleaned up expired sessions', { 
                deletedCount: result.rowCount 
            });

            return result.rowCount;

        } catch (error) {
            logger.error('Session cleanup error', { error: error.message });
            throw error;
        }
    }

    static async getUserSessions(userId) {
        try {
            const result = await pool.query(
                `SELECT id, session_token, expires_at, ip_address, user_agent, created_at 
                 FROM user_sessions 
                 WHERE user_id = $1 AND expires_at > NOW() 
                 ORDER BY created_at DESC`,
                [userId]
            );

            return result.rows.map(session => ({
                id: session.id,
                ipAddress: session.ip_address,
                userAgent: session.user_agent,
                createdAt: session.created_at,
                expiresAt: session.expires_at,
                isCurrent: session.session_token === sessionToken
            }));

        } catch (error) {
            logger.error('Get user sessions error', { error: error.message, userId });
            throw error;
        }
    }

    static async revokeSession(userId, sessionId) {
        try {
            const result = await pool.query(
                'DELETE FROM user_sessions WHERE id = $1 AND user_id = $2 RETURNING id',
                [sessionId, userId]
            );

            if (result.rows.length === 0) {
                throw new Error('Session not found');
            }

            logger.info('Session revoked', { userId, sessionId });
            return { success: true };

        } catch (error) {
            logger.error('Revoke session error', { error: error.message, userId, sessionId });
            throw error;
        }
    }
}

module.exports = AuthService;
