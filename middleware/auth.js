const jwt = require('jsonwebtoken');
const { pool } = require('../config/database');
const authConfig = require('../config/auth');
const logger = require('../utils/logger');

const authenticateToken = async (req, res, next) => {
    try {
        const authHeader = req.headers['authorization'];
        const token = authHeader && authHeader.split(' ')[1];

        if (!token) {
            return res.status(401).json({ 
                success: false,
                error: 'Access token required' 
            });
        }

        // Verify JWT token
        const decoded = jwt.verify(token, authConfig.jwt.secret);
        
        // Check if session is still valid in database
        const sessionResult = await pool.query(
            'SELECT us.*, u.sl_username, u.is_verified FROM user_sessions us JOIN users u ON us.user_id = u.id WHERE us.session_token = $1 AND us.expires_at > NOW()',
            [decoded.sessionToken]
        );

        if (sessionResult.rows.length === 0) {
            return res.status(401).json({ 
                success: false,
                error: 'Session expired or invalid' 
            });
        }

        const session = sessionResult.rows[0];

        // Check if user is still verified
        if (!session.is_verified) {
            return res.status(401).json({ 
                success: false,
                error: 'Account verification required' 
            });
        }

        // Add user info to request
        req.user = {
            userId: decoded.userId,
            slUsername: decoded.slUsername,
            sessionToken: decoded.sessionToken,
            sessionId: session.id
        };

        next();
    } catch (error) {
        if (error.name === 'JsonWebTokenError') {
            return res.status(403).json({ 
                success: false,
                error: 'Invalid token' 
            });
        } else if (error.name === 'TokenExpiredError') {
            return res.status(401).json({ 
                success: false,
                error: 'Token expired' 
            });
        }
        
        logger.error('Auth middleware error:', error);
        return res.status(500).json({ 
            success: false,
            error: 'Authentication error' 
        });
    }
};

// Optional auth - doesn't fail if no token
const optionalAuth = async (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        req.user = null;
        return next();
    }

    try {
        const decoded = jwt.verify(token, authConfig.jwt.secret);
        
        const sessionResult = await pool.query(
            'SELECT us.*, u.sl_username FROM user_sessions us JOIN users u ON us.user_id = u.id WHERE us.session_token = $1 AND us.expires_at > NOW()',
            [decoded.sessionToken]
        );

        if (sessionResult.rows.length > 0) {
            req.user = {
                userId: decoded.userId,
                slUsername: decoded.slUsername,
                sessionToken: decoded.sessionToken
            };
        } else {
            req.user = null;
        }
    } catch (error) {
        req.user = null;
    }

    next();
};

module.exports = {
    authenticateToken,
    optionalAuth
};