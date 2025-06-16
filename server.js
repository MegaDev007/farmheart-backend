// server.js - Add Socket.IO support
require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const compression = require('compression');
const path = require('path');
const fs = require('fs');
const { createServer } = require('http');
const { Server } = require('socket.io');

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
const NotificationScheduler = require('./utils/notificationScheduler');

const app = express();
const httpServer = createServer(app);
const PORT = process.env.PORT || 5000;

// Create logs directory if it doesn't exist
const logsDir = path.join(__dirname, 'logs');
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir);
}

// CORS configuration for both Express and Socket.IO
const allowedOrigins = [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://192.168.103.179:5173',
    'https://farmheart-frontend.vercel.app',
    'https://farmheartvirtual.com',
    'https://www.farmheartvirtual.com'
];

const corsOptions = {
    origin: function (origin, callback) {
        if (!origin) return callback(null, true);
        if (allowedOrigins.includes(origin)) {
            return callback(null, true);
        }
        console.log(`❌ CORS BLOCKED: ${origin}`);
        return callback(new Error('Not allowed by CORS'), false);
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept', 'Origin'],
    optionsSuccessStatus: 200
};

// Set up Socket.IO with CORS
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling']
});


// Make io available globally for notifications
global.io = io;

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

app.use(cors(corsOptions));
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
            redis: redisStatus,
            socketio: 'connected'
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

// Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id);
    
    // User authentication and room joining
    socket.on('authenticate', async (data) => {
        try {
            const { token, userId } = data;
            
            // Verify JWT token here if needed
            // const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            if (userId) {
                socket.userId = userId;
                socket.join(`user_${userId}`);
                console.log(`✅ User ${userId} authenticated and joined room`);
                
                // Send confirmation
                socket.emit('authenticated', {
                    success: true,
                    message: 'Connected to real-time notifications',
                    userId: userId
                });
                
                // Send any unread notification count
                try {
                    const NotificationService = require('./services/notificationService');
                    const stats = await NotificationService.getNotificationStats(userId);
                    socket.emit('notification_stats', stats);
                } catch (error) {
                    console.error('Error getting notification stats:', error);
                }
            }
        } catch (error) {
            console.error('Authentication error:', error);
            socket.emit('auth_error', { message: 'Authentication failed' });
        }
    });
    
    // Handle notification mark as read
    socket.on('mark_notification_read', async (data) => {
        try {
            const { notificationId } = data;
            const userId = socket.userId;
            
            if (userId && notificationId) {
                const NotificationService = require('./services/notificationService');
                await NotificationService.markAsRead(notificationId, userId);
                
                // Send updated stats
                const stats = await NotificationService.getNotificationStats(userId);
                socket.emit('notification_stats', stats);
                
                console.log(`📖 Notification ${notificationId} marked as read by user ${userId}`);
            }
        } catch (error) {
            console.error('Error marking notification as read:', error);
        }
    });
    
    // Handle requesting notification history
    socket.on('get_notifications', async (data) => {
        try {
            const userId = socket.userId;
            const { limit = 20, unreadOnly = false } = data || {};
            
            if (userId) {
                const NotificationService = require('./services/notificationService');
                const notifications = await NotificationService.getUserNotifications(userId, {
                    limit,
                    unreadOnly
                });
                
                socket.emit('notifications_list', notifications);
            }
        } catch (error) {
            console.error('Error getting notifications:', error);
            socket.emit('notifications_error', { message: 'Failed to get notifications' });
        }
    });
    
    // Handle disconnection
    socket.on('disconnect', () => {
        console.log('🔌 Client disconnected:', socket.id);
        if (socket.userId) {
            console.log(`👋 User ${socket.userId} disconnected`);
        }
    });
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    httpServer.close(() => {
        logger.info('HTTP server closed.');
        
        io.close(() => {
            logger.info('Socket.IO server closed.');
            
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
    });

    setTimeout(() => {
        logger.error('Could not close connections in time, forcefully shutting down');
        process.exit(1);
    }, 30000);
}

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

    // Initialize notification scheduler
    NotificationScheduler.startScheduledTasks();

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

        httpServer.listen(PORT, '0.0.0.0', () => {
            logger.info(`🚀 Farmheart API server running on port ${PORT}`);
            logger.info(`🔌 Socket.IO server ready for real-time notifications`);
            logger.info(`Environment: ${process.env.NODE_ENV}`);
            logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
        });

        global.server = httpServer;
        return httpServer;

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