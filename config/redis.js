// config/redis.js
const { createClient } = require('redis');
const logger = require('../utils/logger');

// Debug Redis configuration
const redisConfig = {
    socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: parseInt(process.env.REDIS_PORT) || 6379,
        connectTimeout: 5000,
        lazyConnect: true
    },
    password: process.env.REDIS_PASSWORD || undefined,
    database: parseInt(process.env.REDIS_DB) || 0
};

logger.info('Redis configuration:', {
    host: redisConfig.socket.host,
    port: redisConfig.socket.port,
    database: redisConfig.database,
    hasPassword: !!redisConfig.password
});

const redisClient = createClient(redisConfig);

redisClient.on('connect', () => {
    logger.info('Redis client connecting...');
});

redisClient.on('ready', () => {
    logger.info('Redis client ready and connected');
});

redisClient.on('error', (err) => {
    logger.error('Redis client error:', {
        message: err.message,
        code: err.code,
        errno: err.errno,
        syscall: err.syscall,
        address: err.address,
        port: err.port
    });
});

redisClient.on('end', () => {
    logger.info('Redis client connection ended');
});

redisClient.on('reconnecting', () => {
    logger.info('Redis client reconnecting...');
});

const connectRedis = async () => {
    try {
        logger.info('Attempting to connect to Redis...', {
            host: redisConfig.socket.host,
            port: redisConfig.socket.port
        });

        if (!redisClient.isOpen) {
            await redisClient.connect();
            
            // Test the connection
            const pong = await redisClient.ping();
            logger.info('Redis connection established successfully', { ping: pong });
            
            // Test set/get operation
            await redisClient.set('connection_test', 'ok', { EX: 10 });
            const testValue = await redisClient.get('connection_test');
            logger.info('Redis test operation successful', { testValue });
            
            return redisClient;
        } else {
            logger.info('Redis client already connected');
            return redisClient;
        }
    } catch (error) {
        logger.error('Failed to connect to Redis:', {
            message: error.message,
            code: error.code,
            errno: error.errno,
            syscall: error.syscall,
            address: error.address,
            port: error.port,
            stack: error.stack
        });
        throw error;
    }
};

// Test Redis availability without connecting
const testRedisAvailability = async () => {
    const net = require('net');
    
    return new Promise((resolve) => {
        const socket = new net.Socket();
        const timeout = 2000;
        
        socket.setTimeout(timeout);
        
        socket.on('connect', () => {
            socket.destroy();
            resolve(true);
        });
        
        socket.on('timeout', () => {
            socket.destroy();
            resolve(false);
        });
        
        socket.on('error', () => {
            resolve(false);
        });
        
        socket.connect(redisConfig.socket.port, redisConfig.socket.host);
    });
};

module.exports = {
    redisClient,
    connectRedis,
    testRedisAvailability
};