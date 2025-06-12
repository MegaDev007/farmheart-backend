// server.js - FINAL CORS FIX
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

// Import configurations and utilities
const { testConnection } = require('./config/database');
const { connectRedis, redisClient, testRedisAvailability } = require('./config/redis');
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { generalLimiter, speedLimiter } = require('./middleware/rateLimiting');

// Import routes
const routes = require('./routes');

// Import services for scheduled tasks
const AuthService = require('./services/authService');
const VerificationService = require('./services/verificationService');

const app = express();
const PORT = process.env.PORT || 5000;

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// Security middleware
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
        },
    },
    crossOriginEmbedderPolicy: false
}));

// FIXED: Specific CORS configuration
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://192.168.103.179:5173', // Your local IP
    'https://farmheart-frontend.vercel.app', // Replace with your actual Vercel domain
    'https://farmheartvirtual.com',
    'https://www.farmheartvirtual.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        // Allow requests with no origin (mobile apps, Postman, etc.)
        if (!origin) return callback(null, true);
        
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        
        console.log(`❌ CORS BLOCKED: ${origin}`);
        console.log(`✅ ALLOWED ORIGINS: ${allowedOrigins.join(', ')}`);
        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    optionsSuccessStatus: 200
};

app.use(cors(corsOptions));

// General middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use(generalLimiter);
app.use(speedLimiter);

// Request logging
app.use((req, res, next) => {
    console.log(`${req.method} ${req.url} - Origin: ${req.headers.origin || 'none'}`);
    logger.info('Request received', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        origin: req.headers.origin,
        userAgent: req.get('User-Agent')
    });
    next();
});

// Debug endpoint to check CORS
app.get('/debug/cors', (req, res) => {
    res.json({
        message: 'CORS Debug Endpoint',
        origin: req.headers.origin,
        allowedOrigins: allowedOrigins,
        isAllowed: allowedOrigins.includes(req.headers.origin),
        timestamp: new Date().toISOString()
    });
});

// Health check endpoint
app.get('/health', async (req, res) => {
    let redisStatus = 'disconnected';
    try {
        await redisClient.ping();
        redisStatus = 'connected';
    } catch (error) {
        redisStatus = 'error';
    }

    res.json({
        success: true,
        message: 'Farmheart API is running',
        timestamp: new Date().toISOString(),
        version: '1.0.0',
        environment: process.env.NODE_ENV,
        origin: req.headers.origin,
        services: {
            database: 'connected',
            redis: redisStatus
        }
    });
});

// API routes
app.use('/api', routes);

// Serve static files in production
if (process.env.NODE_ENV === 'production') {
    app.use(express.static(path.join(__dirname, 'public')));
    
    app.get('*', (req, res) => {
        res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });
}

// 404 handler
app.use('*', (req, res) => {
    res.status(404).json({
        success: false,
        error: 'Route not found',
        message: 'The requested endpoint does not exist'
    });
});

// Global error handler
app.use(errorHandler);

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    global.server.close(() => {
        logger.info('HTTP server closed.');
        
        redisClient.quit().then(() => {
            logger.info('Redis connection closed.');
            
            require('./config/database').pool.end(() => {
                logger.info('Database connections closed.');
                process.exit(0);
            });
        }).catch((error) => {
            logger.error('Error closing Redis connection:', error);
            
            require('./config/database').pool.end(() => {
                logger.info('Database connections closed.');
                process.exit(0);
            });
        });
    });

    setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
}

app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    // Log all CORS-related info
    console.log('=== CORS DEBUG ===');
    console.log(`Method: ${req.method}`);
    console.log(`URL: ${req.url}`);
    console.log(`Origin: ${origin || 'none'}`);
    console.log(`Is Preflight: ${req.method === 'OPTIONS'}`);
    console.log(`Is Origin Allowed: ${allowedOrigins.includes(origin)}`);
    
    // Log response headers that will be sent
    res.on('finish', () => {
        console.log('Response Headers:');
        console.log(`  Access-Control-Allow-Origin: ${res.get('Access-Control-Allow-Origin') || 'not set'}`);
        console.log(`  Access-Control-Allow-Credentials: ${res.get('Access-Control-Allow-Credentials') || 'not set'}`);
        console.log('=== END CORS DEBUG ===\n');
    });
    
    next();
});

// Test endpoint specifically for CORS
app.get('/cors-test', (req, res) => {
    res.json({
        success: true,
        message: 'CORS test successful',
        requestOrigin: req.headers.origin,
        allowedOrigins: allowedOrigins,
        isOriginAllowed: allowedOrigins.includes(req.headers.origin),
        headers: req.headers,
        timestamp: new Date().toISOString()
    });
});

// Add preflight handler for login specifically
app.options('/api/v1/auth/login', (req, res) => {
    console.log('Preflight request for login endpoint');
    res.status(200).end();
});

// Scheduled tasks
const setupScheduledTasks = () => {
    setInterval(async () => {
        try {
            const deletedCount = await AuthService.cleanupExpiredSessions();
            if (deletedCount > 0) {
                logger.info(`Cleaned up ${deletedCount} expired sessions`);
            }
        } catch (error) {
            logger.error('Error cleaning up expired sessions:', error);
        }
    }, 60 * 60 * 1000); // 1 hour

    setInterval(async () => {
        try {
            const result = await VerificationService.cleanupExpiredCodes();
            if (result.expiredCount > 0) {
                logger.info(`Verification cleanup: ${result.totalKeys} total keys, ${result.expiredCount} expired`);
            }
        } catch (error) {
            logger.error('Error cleaning up verification codes:', error);
        }
    }, 15 * 60 * 1000); // 15 minutes

    logger.info('Scheduled tasks initialized');
};

// Start server
const startServer = async () => {
    try {
        await testConnection();
        logger.info('PostgreSQL connection established');

        const redisAvailable = await testRedisAvailability();
        
        if (redisAvailable) {
            try {
                await connectRedis();
                logger.info('Redis connection established successfully');
            } catch (redisError) {
                logger.error('Redis connection failed but server available:', redisError.message);
                logger.warn('Starting server without Redis - verification features will be limited');
            }
        } else {
            logger.warn('Redis server not available - starting without Redis');
        }

        setupScheduledTasks();

        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info(`Farmheart API server running on port ${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV}`);
            logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
            logger.info(`Debug endpoint: http://localhost:${PORT}/debug/cors`);
        });

        global.server = server;
        return server;

    } catch (error) {
        logger.error('Failed to start server:', error);
        process.exit(1);
    }
};

// Start the server
if (require.main === module) {
    startServer();
}

module.exports = app;