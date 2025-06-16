// server.js - Add Socket.IO support with WebSocket fixes
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

// Set up Socket.IO with enhanced configuration for production
const io = new Server(httpServer, {
    cors: {
        origin: allowedOrigins,
        methods: ["GET", "POST"],
        credentials: true
    },
    transports: ['websocket', 'polling'],
    allowEIO3: true, // Enable Engine.IO v3 compatibility
    pingTimeout: 60000, // Increase ping timeout
    pingInterval: 25000, // Ping interval
    upgradeTimeout: 30000, // WebSocket upgrade timeout
    maxHttpBufferSize: 1e6, // 1MB buffer size
    allowRequest: (req, callback) => {
        // Additional validation for Socket.IO connections
        const origin = req.headers.origin;
        const allowed = !origin || allowedOrigins.includes(origin);
        
        if (!allowed) {
            console.log(`❌ Socket.IO BLOCKED: ${origin}`);
            return callback('Origin not allowed', false);
        }
        
        console.log(`✅ Socket.IO ALLOWED: ${origin || 'no-origin'}`);
        callback(null, true);
    }
});

// Make io available globally for notifications
global.io = io;

// Enhanced security middleware with WebSocket considerations
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            scriptSrc: ["'self'"],
            imgSrc: ["'self'", "data:", "https:"],
            connectSrc: ["'self'", "wss:", "ws:"], // Allow WebSocket connections
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

// Request logging with WebSocket upgrade detection
app.use((req, res, next) => {
    const isUpgrade = req.headers.upgrade === 'websocket';
    const logMessage = isUpgrade 
        ? `WebSocket UPGRADE ${req.url} - Origin: ${req.headers.origin || 'none'}`
        : `${req.method} ${req.url} - Origin: ${req.headers.origin || 'none'}`;
    
    console.log(logMessage);
    logger.info('Request received', {
        method: req.method,
        url: req.url,
        ip: req.ip,
        origin: req.headers.origin,
        userAgent: req.get('User-Agent'),
        isWebSocketUpgrade: isUpgrade
    });
    next();
});

// Health check endpoint with Socket.IO status
app.get('/health', async (req, res) => {
    let redisStatus = 'disconnected';
    try {
        await redisClient.ping();
        redisStatus = 'connected';
    } catch (error) {
        redisStatus = 'error';
    }

    // Check Socket.IO engine status
    const socketIOStatus = {
        connected: true,
        clientsCount: io.engine.clientsCount || 0,
        transports: ['websocket', 'polling']
    };

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
            socketio: socketIOStatus
        }
    });
});

// Socket.IO specific health check
app.get('/socket-health', (req, res) => {
    res.json({
        success: true,
        socketio: {
            status: 'running',
            clients: io.engine.clientsCount || 0,
            transports: ['websocket', 'polling'],
            allowedOrigins: allowedOrigins
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

// Enhanced Socket.IO Connection Handling
io.on('connection', (socket) => {
    console.log('🔌 New client connected:', socket.id, 'Transport:', socket.conn.transport.name);
    
    // Monitor transport upgrades
    socket.conn.on('upgrade', () => {
        console.log('🚀 Client upgraded to:', socket.conn.transport.name);
    });
    
    socket.conn.on('upgradeError', (err) => {
        console.error('❌ Client upgrade error:', err.message);
    });
    
    // User authentication and room joining
    socket.on('authenticate', async (data) => {
        try {
            const { token, userId } = data;
            
            console.log(`🔐 Authentication attempt for user ${userId}`);
            
            // Verify JWT token here if needed
            // const jwt = require('jsonwebtoken');
            // const decoded = jwt.verify(token, process.env.JWT_SECRET);
            
            if (userId) {
                socket.userId = userId;
                socket.join(`user_${userId}`);
                console.log(`✅ User ${userId} authenticated and joined room (Transport: ${socket.conn.transport.name})`);
                
                // Send confirmation
                socket.emit('authenticated', {
                    success: true,
                    message: 'Connected to real-time notifications',
                    userId: userId,
                    transport: socket.conn.transport.name,
                    socketId: socket.id
                });
                
                // Send any unread notification count
                try {
                    const NotificationService = require('./services/notificationService');
                    const stats = await NotificationService.getNotificationStats(userId);
                    socket.emit('notification_stats', stats);
                    console.log(`📊 Sent notification stats to user ${userId}:`, stats);
                } catch (error) {
                    console.error('Error getting notification stats:', error);
                }
            } else {
                console.log('❌ Authentication failed: No userId provided');
                socket.emit('auth_error', { message: 'User ID required' });
            }
        } catch (error) {
            console.error('❌ Authentication error:', error);
            socket.emit('auth_error', { message: 'Authentication failed' });
        }
    });
    
    // Handle notification mark as read
    socket.on('mark_notification_read', async (data) => {
        try {
            const { notificationId } = data;
            const userId = socket.userId;
            
            console.log(`📖 Mark as read request: notification ${notificationId} by user ${userId}`);
            
            if (userId && notificationId) {
                const NotificationService = require('./services/notificationService');
                await NotificationService.markAsRead(notificationId, userId);
                
                // Send updated stats
                const stats = await NotificationService.getNotificationStats(userId);
                socket.emit('notification_stats', stats);
                
                console.log(`✅ Notification ${notificationId} marked as read by user ${userId}`);
            }
        } catch (error) {
            console.error('❌ Error marking notification as read:', error);
        }
    });
    
    // Handle requesting notification history
    socket.on('get_notifications', async (data) => {
        try {
            const userId = socket.userId;
            const { limit = 20, unreadOnly = false } = data || {};
            
            console.log(`📋 Get notifications request from user ${userId} (limit: ${limit}, unreadOnly: ${unreadOnly})`);
            
            if (userId) {
                const NotificationService = require('./services/notificationService');
                const notifications = await NotificationService.getUserNotifications(userId, {
                    limit,
                    unreadOnly
                });
                
                socket.emit('notifications_list', notifications);
                console.log(`📤 Sent ${notifications.notifications?.length || 0} notifications to user ${userId}`);
            }
        } catch (error) {
            console.error('❌ Error getting notifications:', error);
            socket.emit('notifications_error', { message: 'Failed to get notifications' });
        }
    });
    
    // Handle connection errors
    socket.on('connect_error', (error) => {
        console.error('🔌 Socket connection error:', error.message);
    });
    
    // Handle disconnection
    socket.on('disconnect', (reason) => {
        console.log('🔌 Client disconnected:', socket.id, 'Reason:', reason);
        if (socket.userId) {
            console.log(`👋 User ${socket.userId} disconnected (${reason})`);
        }
    });
    
    // Handle Socket.IO errors
    socket.on('error', (error) => {
        console.error('🔌 Socket error:', error);
    });
});

// Monitor Socket.IO server events
io.engine.on('connection_error', (err) => {
    console.error('🔌 Socket.IO engine connection error:', {
        message: err.message,
        description: err.description,
        context: err.context,
        type: err.type
    });
});

// Graceful shutdown
process.on('SIGTERM', gracefulShutdown);
process.on('SIGINT', gracefulShutdown);

function gracefulShutdown(signal) {
    logger.info(`Received ${signal}. Starting graceful shutdown...`);
    
    // Close Socket.IO connections gracefully
    io.disconnectSockets();
    
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
            logger.info(`🌐 WebSocket endpoint: wss://api.farmheartvirtual.com/socket.io/`);
            logger.info(`Environment: ${process.env.NODE_ENV}`);
            logger.info(`Allowed origins: ${allowedOrigins.join(', ')}`);
            
            // Log Socket.IO configuration
            console.log('🔧 Socket.IO Configuration:');
            console.log('   - Transports: websocket, polling');
            console.log('   - Ping Timeout: 60s');
            console.log('   - Ping Interval: 25s');
            console.log('   - Upgrade Timeout: 30s');
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