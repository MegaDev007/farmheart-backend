const { redisClient } = require('../config/redis');
const { generateVerificationCode } = require('../utils/generators');
const User = require('../models/user');
const logger = require('../utils/logger');

class VerificationService {
    // Generate and store verification code in Redis
    static async generateVerificationCode(slUsername, email) {
        try {
            const code = generateVerificationCode(); // Generates random code like "FH-ABC123"
            const verificationKey = `verify:${code}`;
            
            const verificationData = {
                slUsername,
                email,
                code,
                createdAt: new Date().toISOString(),
                attempts: 0
            };
            
            // Store in Redis with 10 minute expiration (600 seconds)
            await redisClient.setEx(verificationKey, 600, JSON.stringify(verificationData));
            
            // Also store by username for easy lookup
            const usernameKey = `verify:user:${slUsername}`;
            await redisClient.setEx(usernameKey, 600, code);
            
            logger.info('Verification code generated', { slUsername, code });
            
            return {
                code,
                expiresAt: new Date(Date.now() + 10 * 60 * 1000) // 10 minutes
            };
            
        } catch (error) {
            logger.error('Error generating verification code:', error);
            throw new Error('Failed to generate verification code');
        }
    }
    
    // Check code expiration
    static async checkCodeExpiration(slUsername) {
        try {
            const usernameKey = `verify:user:${slUsername}`;
            const code = await redisClient.get(usernameKey);
            
            if (!code) {
                return { isExpired: true };
            }
            
            const verificationKey = `verify:${code}`;
            const ttl = await redisClient.ttl(verificationKey);
            
            return {
                isExpired: ttl <= 0,
                timeLeft: ttl > 0 ? ttl : 0
            };
        } catch (error) {
            logger.error('Error checking code expiration:', error);
            return { isExpired: true };
        }
    }
    
    // Verify code and mark user as verified
    static async verifyCode(slUsername, verificationCode, slUuid) {
        try {
            const verificationKey = `verify:${verificationCode}`;
            
            // Find user in database
            const user = await User.findBySlUsername(slUsername);
            if (!user) {
                throw new Error('User not found');
            }
            
            // Check if already verified
            if (user.isVerified) {
                throw new Error('User already verified');
            }

            // Get verification data from Redis
            const verificationDataStr = await redisClient.get(verificationKey);
            
            if (!verificationDataStr) {
                throw new Error('Invalid or expired verification code');
            }
            
            const verificationData = JSON.parse(verificationDataStr);
            
            // Check if username matches
            if (verificationData.slUsername !== slUsername) {
                throw new Error('Verification code does not match username');
            }
            
            // Check if code is expired
            const ttl = await redisClient.ttl(verificationKey);
            if (ttl <= 0) {
                throw new Error('Verification code has expired');
            }
            

            // Verify the user in database
            await user.verify(slUuid);
            
            // Remove verification code from Redis (one-time use)
            await redisClient.del(verificationKey);
            await redisClient.del(`verify:user:${slUsername}`);
            
            // Store successful verification flag for frontend polling
            const successKey = `verified:${slUsername}`;
            await redisClient.setEx(successKey, 300, 'true'); // 5 minutes
            
            logger.info('User verified successfully', { slUsername, slUuid });
            
            return {
                user: user.toJSON(),
                message: 'SL identity verified successfully. You can now login to the website.'
            };
            
        } catch (error) {
            logger.error('Verification error:', error);
            
            // Track failed attempts
            try {
                const verificationKey = `verify:${verificationCode}`;
                const verificationDataStr = await redisClient.get(verificationKey);
                
                if (verificationDataStr) {
                    const verificationData = JSON.parse(verificationDataStr);
                    verificationData.attempts = (verificationData.attempts || 0) + 1;
                    verificationData.lastAttempt = new Date().toISOString();
                    
                    await redisClient.setEx(verificationKey, 600, JSON.stringify(verificationData));
                }
            } catch (trackingError) {
                logger.error('Error tracking failed attempt:', trackingError);
            }
            
            throw error;
        }
    }
    
    // Check verification status
    static async checkVerificationStatus(slUsername) {
        try {
            // Check if user exists and is verified in database
            const user = await User.findBySlUsername(slUsername);
            
            if (!user) {
                return {
                    isVerified: false,
                    hasAccount: false
                };
            }
            
            // Check for recent verification success flag
            const successKey = `verified:${slUsername}`;
            const isRecentlyVerified = await redisClient.get(successKey);
            
            // Check code expiration
            const expirationStatus = await this.checkCodeExpiration(slUsername);
            
            return {
                isVerified: user.isVerified,
                hasAccount: true,
                isRecentlyVerified: !!isRecentlyVerified,
                userId: user.id,
                isExpired: expirationStatus.isExpired,
                timeLeft: expirationStatus.timeLeft
            };
            
        } catch (error) {
            logger.error('Error checking verification status:', error);
            throw new Error('Failed to check verification status');
        }
    }
    
    // Refresh verification code
    static async refreshVerificationCode(email) {
        try {
            console.log('email in refreshVerificationCode', email);
            // Find user by email
            const user = await User.findByEmail(email);
            if (!user) {
                throw new Error('User not found');
            }
            
            if (user.isVerified) {
                throw new Error('User already verified');
            }
            
            // Delete old verification code
            const oldUsernameKey = `verify:user:${user.slUsername}`;
            const oldCode = await redisClient.get(oldUsernameKey);
            if (oldCode) {
                await redisClient.del(`verify:${oldCode}`);
                await redisClient.del(oldUsernameKey);
            }
            
            // Generate new code
            const newVerification = await this.generateVerificationCode(user.slUsername, email);
            console.log('newVerification', newVerification);
            
            logger.info('Verification code refreshed', { 
                slUsername: user.slUsername, 
                newCode: newVerification.code 
            });
            
            return newVerification;
            
        } catch (error) {
            logger.error('Error refreshing verification code:', error);
            throw error;
        }
    }

    // Clean up expired verification codes
    static async cleanupExpiredCodes() {
        try {
            // Get all verification keys
            const keys = await redisClient.keys('verify:*');
            let expiredCount = 0;

            // Check each key's TTL
            for (const key of keys) {
                const ttl = await redisClient.ttl(key);
                if (ttl <= 0) {
                    await redisClient.del(key);
                    expiredCount++;
                }
            }

            return {
                totalKeys: keys.length,
                expiredCount
            };
        } catch (error) {
            logger.error('Error cleaning up expired verification codes:', error);
            throw error;
        }
    }
}

module.exports = VerificationService; 