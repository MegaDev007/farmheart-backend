// server.js
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');

// Import configurations and utilities
const { testConnection } = require('./config/database');
const { connectRedis, redisClient, testRedisAvailability } = require('./config/redis'); // FIXED: Import all functions
const logger = require('./utils/logger');
const errorHandler = require('./middleware/errorHandler');
const { generalLimiter, speedLimiter } = require('./middleware/rateLimiting');

// Import routes
const routes = require('./routes');

// Import services for scheduled tasks
const AuthService = require('./services/authService');
const VerificationService = require('./services/verificationService'); // ADD: Verification service

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

// CORS configuration that allows ngrok headers
const corsOptions = {
    origin: [
      'http://localhost:3000',
      'http://localhost:5173',
      'http://localhost:5174',
      'https://your-vercel-app.vercel.app',
      /\.vercel\.app$/,
      /\.ngrok-free\.app$/,
      /\.ngrok\.io$/
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS', 'PATCH'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'Accept',
      'Origin',
      'ngrok-skip-browser-warning'  // ← This is the key addition
    ],
    exposedHeaders: [
      'Content-Range',
      'X-Content-Range'
    ]
  };
  
  // Apply CORS middleware
  app.use(cors(corsOptions));
  
  // Handle preflight OPTIONS requests
  app.options('*', (req, res) => {
    res.header('Access-Control-Allow-Origin', req.headers.origin || '*');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept, Origin, ngrok-skip-browser-warning');
    res.header('Access-Control-Allow-Credentials', true);
    res.sendStatus(200);
  });
  
  // Additional middleware to ensure CORS headers are always set
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    
    if (corsOptions.origin.some(allowedOrigin => {
      if (typeof allowedOrigin === 'string') {
        return allowedOrigin === origin;
      }
      return allowedOrigin.test(origin);
    })) {
      res.header('Access-Control-Allow-Origin', origin);
    }
    
    res.header('Access-Control-Allow-Credentials', true);
    res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization, Content-Length, X-Requested-With, Accept, Origin, ngrok-skip-browser-warning');
    res.header('Access-Control-Allow-Methods', 'GET,PUT,POST,DELETE,OPTIONS,PATCH');
    
    next();
  });
  
  // Your other middleware and routes...
  app.use(express.json());
  
  // Test endpoint to verify CORS is working
  app.get('/api/v1/test-cors', (req, res) => {
    res.json({ 
      message: 'CORS is working!', 
      headers: req.headers,
      timestamp: new Date().toISOString()
    });
  });

// General middleware
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Rate limiting
app.use(generalLimiter);
app.use(speedLimiter);

// Request logging
app.use((req, res, next) => {
    logger.info('Request received', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        userAgent: req.get('User-Agent')
    });
    next();
});

// Health check endpoint (before rate limiting)
app.get('/health', async (req, res) => {
    // ADD: Include Redis status in health check
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
        services: {
            database: 'connected', // Assume connected if we reach here
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
        
        // ADD: Close Redis connection
        redisClient.quit().then(() => {
            logger.info('Redis connection closed.');
            
            // Close database connections
            require('./config/database').pool.end(() => {
                logger.info('Database connections closed.');
                process.exit(0);
            });
        }).catch((error) => {
            logger.error('Error closing Redis connection:', error);
            
            // Still close database
            require('./config/database').pool.end(() => {
                logger.info('Database connections closed.');
                process.exit(0);
            });
        });
    });

    // Force close after 30 seconds
    setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
}

// UPDATED: Scheduled tasks with Redis cleanup
const setupScheduledTasks = () => {
    // Clean up expired sessions every hour
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

    // ADD: Clean up expired verification codes every 15 minutes
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

// UPDATED: Start server with better Redis error handling
const startServer = async () => {
    try {
        // Test database connection
        await testConnection();
        logger.info('PostgreSQL connection established');

        // Test Redis availability first
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
            logger.info('To enable verification features, please install and start Redis:');
            logger.info('  Ubuntu/Debian: sudo apt install redis-server && sudo systemctl start redis-server');
            logger.info('  macOS: brew install redis && brew services start redis');
            logger.info('  Docker: docker run -d -p 6379:6379 --name farmheart-redis redis:alpine');
        }

        // Setup scheduled tasks
        setupScheduledTasks();

        // Start HTTP server
        const server = app.listen(PORT, '0.0.0.0', () => {
            logger.info(`Farmheart API server running on port ${PORT}`);
            logger.info(`Environment: ${process.env.NODE_ENV}`);
            logger.info(`API Documentation: http://localhost:${PORT}/api`);
            logger.info(`Health check: http://localhost:${PORT}/health`);
        });

        // Make server available for graceful shutdown
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