// services/notificationService.js - Updated with animal position data

const { pool } = require('../config/database');
const logger = require('../utils/logger');
const EmailService = require('../services/emailService');

class NotificationService {

        // Get user's notification preferences
        static async getNotificationPreferences(req, res, next) {
            try {
                const { userId } = req.user;
    
                const preferences = await NotificationService.getUserNotificationPreferences(userId);
    
                res.json({
                    success: true,
                    data: preferences
                });
    
            } catch (error) {
                next(error);
            }
        }

         // Update user's notification preferences
    static async updateNotificationPreferences(req, res, next) {
        try {
            const { userId } = req.user;
            const { inAppEnabled, emailEnabled } = req.body;

            // Validate input
            if (typeof inAppEnabled !== 'boolean' || typeof emailEnabled !== 'boolean') {
                return res.status(400).json({
                    success: false,
                    error: 'inAppEnabled and emailEnabled must be boolean values'
                });
            }

            const updatedPreferences = await NotificationService.updateUserNotificationPreferences(
                userId,
                { inAppEnabled, emailEnabled }
            );

            res.json({
                success: true,
                message: 'Notification preferences updated successfully',
                data: {
                    inAppEnabled: updatedPreferences.in_app_enabled,
                    emailEnabled: updatedPreferences.email_enabled
                }
            });

        } catch (error) {
            next(error);
        }
    }

      // Send test email notification
      static async sendTestEmail(req, res, next) {
        try {
            const { userId } = req.user;
            
            // Get user email
            const { pool } = require('../config/database');
            const userResult = await pool.query(
                'SELECT email, display_name FROM users WHERE id = $1',
                [userId]
            );

            if (userResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'User not found'
                });
            }

            const user = userResult.rows[0];
            if (!user.email) {
                return res.status(400).json({
                    success: false,
                    error: 'No email address found for this user'
                });
            }

            await EmailService.sendTestEmail(user.email, {
                userId: userId,
                displayName: user.display_name,
                timestamp: new Date().toISOString()
            });

            res.json({
                success: true,
                message: 'Test email sent successfully',
                data: {
                    email: user.email
                }
            });

        } catch (error) {
            console.error('Error sending test email:', error);
            next(error);
        }
    }


    // Enhanced method to check animal status and notify with position data
    static async checkAnimalStatusAndNotify(animalId, newStats, previousStats = null) {
        try {
            const animal = await NotificationService.getAnimalById(animalId);
            
            if (!animal) {
                logger.warn('Animal not found for notification check:', animalId);
                return 0;
            }

            // Get user notification preferences
            const preferences = await NotificationService.getUserNotificationPreferences(animal.owner_id);

            // Skip notifications if both are disabled
            if (!preferences.inAppEnabled && !preferences.emailEnabled) {
                await NotificationService.recordAnimalStats(animalId, newStats, animal.status);
                return 0;
            }

            // Get previous stats if not provided
            if (!previousStats) {
                previousStats = await NotificationService.getPreviousAnimalStats(animalId);
            }

            // Enhanced animal position data for notifications
            const positionData = {
                region: animal.sl_region || 'Unknown Region',
                coordinates: {
                    x: animal.sl_position_x || 0,
                    y: animal.sl_position_y || 0,
                    z: animal.sl_position_z || 0
                },
                slUrl: NotificationService.generateSLURL(animal.sl_region, {
                    x: animal.sl_position_x,
                    y: animal.sl_position_y,
                    z: animal.sl_position_z
                })
            };

            // Don't send notifications for pet animals (except one-time pet notification)
            if (animal.status === 'pet') {
                const wasPreviouslyPet = previousStats?.animal_status === 'pet';
                
                if (!wasPreviouslyPet) {
                    const petNotification = {
                        type: 'animal_became_pet',
                        severity: 'medium',
                        data: {
                            animalName: animal.name || 'Unnamed Animal',
                            age: animal.age_days || 0,
                            ...positionData
                        }
                    };

                    await NotificationService.sendNotification(
                        animal.owner_id, 
                        animalId, 
                        petNotification, 
                        preferences,
                        animal
                    );

                    await NotificationService.recordAnimalStats(animalId, newStats, animal.status);
                    return 1;
                }
                
                await NotificationService.recordAnimalStats(animalId, newStats, animal.status);
                return 0;
            }

            // Don't send notifications for eden animals
            if (animal.status === 'eden') {
                await NotificationService.recordAnimalStats(animalId, newStats, animal.status);
                return 0;
            }

            const notificationsToCreate = [];

            // 1. INOPERABLE NOTIFICATIONS
            const previousOperable = previousStats?.is_operable !== false;
            
            if (!newStats.isOperable && previousOperable) {
                notificationsToCreate.push({
                    type: 'animal_inoperable',
                    severity: 'critical',
                    data: {
                        animalName: animal.name || 'Unnamed Animal',
                        hungerPercent: newStats.hungerPercent,
                        happinessPercent: newStats.happinessPercent,
                        heatPercent: newStats.heatPercent,
                        ...positionData
                    }
                });
            }

            // 2. BREEDING READY NOTIFICATIONS
            if (newStats.isOperable) {
                const previousBreedable = previousStats?.is_breedable || false;
                
                if (newStats.isBreedable && !previousBreedable) {
                    notificationsToCreate.push({
                        type: 'breeding_ready',
                        severity: 'medium',
                        data: {
                            animalName: animal.name || 'Unnamed Animal',
                            heatPercent: newStats.heatPercent,
                            happinessPercent: newStats.happinessPercent,
                            hungerPercent: newStats.hungerPercent,
                            ...positionData
                        }
                    });
                }
            }

            // 3. HUNGER NOTIFICATIONS (only for in-app, not email)
            if (newStats.isOperable && preferences.inAppEnabled) {
                const hungerThreshold = 75;
                const hungerCriticalThreshold = 95;
                const previousHunger = previousStats?.hunger_percent || 0;
                
                if (newStats.hungerPercent >= hungerThreshold) {
                    const isHungerIncreasing = !previousStats || newStats.hungerPercent > previousHunger;
                    
                    if (isHungerIncreasing) {
                        const severity = newStats.hungerPercent >= hungerCriticalThreshold ? 'critical' : 'high';
                        const notificationType = newStats.hungerPercent >= hungerCriticalThreshold ? 'animal_critical_hunger' : 'animal_hunger';
                        
                        notificationsToCreate.push({
                            type: notificationType,
                            severity,
                            data: {
                                animalName: animal.name || 'Unnamed Animal',
                                hungerPercent: newStats.hungerPercent,
                                previousHunger: previousHunger,
                                threshold: newStats.hungerPercent >= hungerCriticalThreshold ? hungerCriticalThreshold : hungerThreshold,
                                emailOnly: false,
                                ...positionData
                            }
                        });
                    }
                }
            }

            // 4. HAPPINESS NOTIFICATIONS (only for in-app, not email)
            if (newStats.isOperable && preferences.inAppEnabled) {
                const happinessThreshold = 25;
                const happinessCriticalThreshold = 5;
                const previousHappiness = previousStats?.happiness_percent || 100;
                
                if (newStats.happinessPercent <= happinessThreshold) {
                    const isHappinessDecreasing = !previousStats || newStats.happinessPercent < previousHappiness;
                    
                    if (isHappinessDecreasing) {
                        const severity = newStats.happinessPercent <= happinessCriticalThreshold ? 'critical' : 'high';
                        const notificationType = newStats.happinessPercent <= happinessCriticalThreshold ? 'animal_happiness_critical' : 'animal_happiness_low';
                        
                        notificationsToCreate.push({
                            type: notificationType,
                            severity,
                            data: {
                                animalName: animal.name || 'Unnamed Animal',
                                happinessPercent: newStats.happinessPercent,
                                previousHappiness: previousHappiness,
                                threshold: newStats.happinessPercent <= happinessCriticalThreshold ? happinessCriticalThreshold : happinessThreshold,
                                emailOnly: false,
                                ...positionData
                            }
                        });
                    }
                }
            }

            // Send all notifications
            let createdCount = 0;
            for (const notification of notificationsToCreate) {
                try {
                    // Check for spam
                    const isDuplicate = await NotificationService.checkForDuplicateNotification(
                        animal.owner_id, 
                        animalId, 
                        notification.type
                    );

                    if (!isDuplicate) {
                        await NotificationService.sendNotification(
                            animal.owner_id, 
                            animalId, 
                            notification, 
                            preferences,
                            animal
                        );
                        createdCount++;
                    }
                } catch (error) {
                    logger.error('Error creating individual notification:', error);
                }
            }

            await NotificationService.recordAnimalStats(animalId, newStats, animal.status);
            return createdCount;

        } catch (error) {
            logger.error('Error checking animal status for notifications:', error);
            return 0;
        }
    }

    // Generate Second Life URL for teleporting to animal location
    static generateSLURL(region, coordinates) {
        if (!region || !coordinates) {
            return null;
        }

        const { x, y, z } = coordinates;
        
        // Format: secondlife://Region Name/x/y/z
        const formattedRegion = region.replace(/\s+/g, '%20');
        return `secondlife://${formattedRegion}/${Math.round(x)}/${Math.round(y)}/${Math.round(z)}`;
    }

    // Enhanced createInAppNotification with position data
    static async createInAppNotification(userId, animalId, notificationData) {
        try {
            const { type, severity, data } = notificationData;

            const templates = {
                'animal_hunger': {
                    title: '{animalName} is getting hungry',
                    body: '{animalName} hunger level has reached {hungerPercent}% (up from {previousHunger}%). Please provide food soon to prevent health issues.',
                    category: 'animal_care'
                },
                'animal_critical_hunger': {
                    title: '{animalName} is critically hungry!',
                    body: 'URGENT: {animalName} hunger level is at {hungerPercent}% - immediate feeding required! Your animal will become inoperable if not fed soon.',
                    category: 'animal_care'
                },
                'animal_happiness_low': {
                    title: '{animalName} is feeling sad',
                    body: '{animalName} happiness has dropped to {happinessPercent}% (down from {previousHappiness}%). Consider brushing or providing minerals to improve mood.',
                    category: 'animal_care'
                },
                'animal_happiness_critical': {
                    title: '{animalName} is very unhappy!',
                    body: 'URGENT: {animalName} happiness is critically low at {happinessPercent}%. Immediate care needed - brush your animal or provide minerals!',
                    category: 'animal_care'
                },
                'breeding_ready': {
                    title: '{animalName} is ready to breed',
                    body: 'Great news! {animalName} has reached optimal breeding conditions with {heatPercent}% heat, {happinessPercent}% happiness, and {hungerPercent}% satiation.',
                    category: 'breeding'
                },
                'animal_inoperable': {
                    title: '{animalName} has become inoperable',
                    body: 'CRITICAL: {animalName} is no longer functional due to neglect (Hunger: {hungerPercent}%, Happiness: {happinessPercent}%). Feed and care for your animal immediately to restore functionality!',
                    category: 'animal_care'
                },
                'animal_became_pet': {
                    title: '{animalName} became a pet!',
                    body: 'Congratulations! {animalName} has completed its breeding cycle at {age} days old and is now a beloved pet. No more feeding or care required - just enjoy riding and companionship!',
                    category: 'achievement'
                }
            };

            const template = templates[type];
            if (!template) {
                logger.warn('Unknown notification type:', type);
                return null;
            }

            const title = NotificationService.replaceTemplateVariables(template.title, data);
            const message = NotificationService.replaceTemplateVariables(template.body, data);
            const category = template.category;

            // Enhanced metadata with position and action URL
            const metadata = {
                ...data,
                actionUrl: `/animals/${animalId}`,
                slUrl: data.slUrl || null,
                position: data.coordinates || null,
                region: data.region || null
            };

            try {
                const result = await pool.query(
                    `INSERT INTO notifications (user_id, animal_id, title, message, severity, category, metadata, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                     RETURNING *`,
                    [userId, animalId, title, message, severity, category, JSON.stringify(metadata)]
                );

                const notification = result.rows[0];

                // Send real-time notification
                try {
                    await NotificationService.sendRealTimeNotification(userId, notification);
                } catch (realtimeError) {
                    logger.warn('Failed to send real-time notification:', realtimeError.message);
                }

                return notification;

            } catch (dbError) {
                logger.info('📝 In-app notification would be created (DB table missing):', {
                    userId, animalId, type, title: title.substring(0, 50) + '...', severity
                });
                return { id: Date.now(), title, message, severity, metadata };
            }

        } catch (error) {
            logger.error('Error creating in-app notification:', error);
            return null;
        }
    }

    // Rest of the methods remain the same...
    static async sendNotification(userId, animalId, notificationData, preferences, animal) {
        try {
            const { type, severity, data } = notificationData;

            // Determine which notifications should be sent via email
            const emailEligibleTypes = ['animal_became_pet', 'animal_inoperable', 'breeding_ready'];
            const shouldSendEmail = preferences.emailEnabled && emailEligibleTypes.includes(type);
            const shouldSendInApp = preferences.inAppEnabled && !data.emailOnly;

            // Send in-app notification
            if (shouldSendInApp) {
                await NotificationService.createInAppNotification(userId, animalId, notificationData);
            }

            // Send email notification
            if (shouldSendEmail) {
                await NotificationService.sendEmailNotification(userId, animalId, notificationData, animal);
            }

        } catch (error) {
            logger.error('Error sending notification:', error);
        }
    }

    // Enhanced getAnimalById with position data
    static async getAnimalById(animalId) {
        try {
            const result = await pool.query(
                `SELECT a.*, u.id as owner_id, ab.name as breed_name
                 FROM animals a
                 JOIN users u ON a.owner_id = u.id
                 LEFT JOIN animal_breeds ab ON a.breed_id = ab.id
                 WHERE a.id = $1`,
                [animalId]
            );

            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            logger.error('Error getting animal by ID:', error);
            return null;
        }
    }

    // All other existing methods remain the same...
    static async getUserNotificationPreferences(userId) {
        try {
            const result = await pool.query(
                'SELECT in_app_enabled, email_enabled FROM user_notification_preferences WHERE user_id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                await pool.query(
                    'INSERT INTO user_notification_preferences (user_id, in_app_enabled, email_enabled) VALUES ($1, $2, $3)',
                    [userId, true, false]
                );
                return { inAppEnabled: true, emailEnabled: false };
            }

            const prefs = result.rows[0];
            return {
                inAppEnabled: prefs.in_app_enabled,
                emailEnabled: prefs.email_enabled
            };
        } catch (error) {
            logger.error('Error getting user notification preferences:', error);
            return { inAppEnabled: true, emailEnabled: false };
        }
    }

    static async updateUserNotificationPreferences(userId, preferences) {
        try {
            const { inAppEnabled, emailEnabled } = preferences;

            const result = await pool.query(
                `INSERT INTO user_notification_preferences (user_id, in_app_enabled, email_enabled, updated_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (user_id) 
                 DO UPDATE SET 
                     in_app_enabled = EXCLUDED.in_app_enabled,
                     email_enabled = EXCLUDED.email_enabled,
                     updated_at = NOW()
                 RETURNING *`,
                [userId, inAppEnabled, emailEnabled]
            );

            return result.rows[0];
        } catch (error) {
            logger.error('Error updating user notification preferences:', error);
            throw error;
        }
    }

    static async sendEmailNotification(userId, animalId, notificationData, animal) {
        try {
            const { type, severity, data } = notificationData;
            
            const userResult = await pool.query(
                'SELECT email, sl_username, sl_username FROM users WHERE id = $1',
                [userId]
            );

            if (userResult.rows.length === 0) {
                logger.warn('User not found for email notification:', userId);
                return;
            }

            const user = userResult.rows[0];
            if (!user.email) {
                logger.warn('User has no email address for notification:', userId);
                return;
            }

            try {
                switch (type) {
                    case 'animal_became_pet':
                        await EmailService.sendPetNotificationEmail(
                            user.email,
                            data.animalName,
                            data.age,
                            data.region,
                            user.sl_username || user.sl_username
                        );
                        break;
                        
                    case 'animal_inoperable':
                        await EmailService.sendInoperableNotificationEmail(
                            user.email,
                            data.animalName,
                            {
                                hungerPercent: data.hungerPercent,
                                happinessPercent: data.happinessPercent,
                                heatPercent: data.heatPercent
                            },
                            data.region,
                            user.sl_username || user.sl_username
                        );
                        break;
                        
                    case 'breeding_ready':
                        await EmailService.sendBreedingReadyEmail(
                            user.email,
                            data.animalName,
                            {
                                heatPercent: data.heatPercent,
                                happinessPercent: data.happinessPercent,
                                hungerPercent: data.hungerPercent
                            },
                            data.region,
                            user.sl_username || user.sl_username
                        );
                        break;
                        
                    default:
                        logger.warn('Unknown email notification type:', type);
                        return;
                }

                logger.info('Email notification sent successfully', {
                    userId,
                    animalId,
                    type,
                    email: user.email
                });

            } catch (emailError) {
                logger.error('Error sending specific email type:', {
                    error: emailError.message,
                    userId,
                    animalId,
                    type,
                    email: user.email
                });
            }

        } catch (error) {
            logger.error('Error sending email notification:', error);
        }
    }

    // Include all other existing methods here...
    static async checkForDuplicateNotification(userId, animalId, notificationType) {
        try {
            const result = await pool.query(
                `SELECT id FROM notifications 
                 WHERE user_id = $1 
                   AND animal_id = $2 
                   AND title LIKE '%' || $3 || '%'
                   AND created_at > NOW() - INTERVAL '1 hour'
                   AND is_dismissed = false`,
                [userId, animalId, notificationType.replace('animal_', '').replace('_', ' ')]
            );

            return result.rows.length > 0;
        } catch (error) {
            logger.error('Error checking for duplicate notification:', error);
            return false;
        }
    }

    static async sendRealTimeNotification(userId, notification) {
        try {
            const io = global.io;
            
            if (!io) {
                console.log('⚠️  Socket.IO not available for real-time notification');
                return;
            }

            const formattedNotification = {
                id: notification.id,
                title: notification.title,
                message: notification.message,
                severity: notification.severity,
                category: notification.category,
                animalId: notification.animal_id,
                isRead: false,
                is_read: false,
                isDismissed: false,
                is_dismissed: false,
                createdAt: notification.created_at,
                metadata: notification.metadata
            };

            io.to(`user_${userId}`).emit('new_notification', formattedNotification);
            
            try {
                const stats = await NotificationService.getNotificationStats(userId);
                io.to(`user_${userId}`).emit('notification_stats', stats);
            } catch (statsError) {
                console.error("Error getting/sending stats:", statsError);
            }
            
            logger.info('Real-time notification sent', {
                userId,
                notificationId: notification.id,
                title: notification.title,
                severity: notification.severity
            });

        } catch (error) {
            logger.error('Error sending real-time notification:', error);
            throw error;
        }
    }

    static replaceTemplateVariables(template, data) {
        let result = template;
        for (const [key, value] of Object.entries(data)) {
            const regex = new RegExp(`{${key}}`, 'g');
            result = result.replace(regex, value);
        }
        return result;
    }

    // Include remaining methods for completeness...
    static async getUserNotifications(userId, options = {}) {
        try {
            const { 
                limit = 10, 
                offset = 0, 
                unreadOnly = false, 
                category = null 
            } = options;

            let whereClause = 'WHERE user_id = $1 AND is_dismissed = false';
            let params = [userId];
            let paramCount = 1;

            if (unreadOnly) {
                whereClause += ` AND is_read = false`;
            }

            if (category) {
                paramCount++;
                whereClause += ` AND category = $${paramCount}`;
                params.push(category);
            }

            const countQuery = `SELECT COUNT(*) FROM notifications ${whereClause}`;
            const countResult = await pool.query(countQuery, params);
            const totalCount = parseInt(countResult.rows[0].count);

            paramCount++;
            const limitParam = paramCount;
            paramCount++;
            const offsetParam = paramCount;
            
            const query = `
                SELECT id, user_id, animal_id, title, message, severity, category, 
                       is_read, is_dismissed, created_at, read_at, metadata
                FROM notifications 
                ${whereClause}
                ORDER BY created_at DESC
                LIMIT $${limitParam} OFFSET $${offsetParam}
            `;
            
            params.push(limit, offset);
            const result = await pool.query(query, params);

            const notifications = result.rows.map(row => ({
                id: row.id,
                title: row.title,
                message: row.message,
                severity: row.severity,
                category: row.category,
                animalId: row.animal_id,
                animalName: null,
                isRead: row.is_read,
                is_read: row.is_read,
                isDismissed: row.is_dismissed,
                is_dismissed: row.is_dismissed,
                createdAt: row.created_at,
                readAt: row.read_at,
                metadata: row.metadata
            }));

            const unreadQuery = `SELECT COUNT(*) FROM notifications WHERE user_id = $1 AND is_dismissed = false AND is_read = false`;
            const unreadResult = await pool.query(unreadQuery, [userId]);
            const unreadCount = parseInt(unreadResult.rows[0].count);

            return {
                notifications,
                totalCount,
                unreadCount,
                hasMore: (offset + limit) < totalCount
            };

        } catch (error) {
            console.error('Database error in getUserNotifications:', error);
            return { 
                notifications: [], 
                totalCount: 0, 
                unreadCount: 0,
                hasMore: false
            };
        }
    }

  // Mark a single notification as read
  static async markAsRead(req, res, next) {
    try {
        const { notificationId } = req.params;
        const { userId } = req.user;
        const notification = await NotificationService.markAsRead(notificationId, userId);

        if (!notification) {
            return res.status(404).json({
                success: false,
                error: 'Notification not found or access denied'
            });
        }

        res.json({
            success: true,
            message: 'Notification marked as read',
            data: { 
                notification: {
                    id: notification.id,
                    isRead: notification.is_read,
                    readAt: notification.read_at,
                    title: notification.title
                }
            }
        });

    } catch (error) {
        console.error('Controller error:', error);
        next(error);
    }
}

   // Mark a notification as dismissed
   static async markAsDismissed(req, res, next) {
    try {
        const { notificationId } = req.params;
        const { userId } = req.user;

        const notification = await NotificationService.markAsDismissed(
            parseInt(notificationId), 
            userId
        );

        if (!notification) {
            return res.status(404).json({
                success: false,
                error: 'Notification not found'
            });
        }

        res.json({
            success: true,
            message: 'Notification dismissed',
            data: { notification }
        });

    } catch (error) {
        next(error);
    }
}

    // Mark all notifications as read
    static async markAllAsRead(req, res, next) {
        try {
            const { userId } = req.user;
            const { category } = req.query;
    
            const updatedCount = await NotificationService.markAllAsRead(userId, category);
    
            res.json({
                success: true,
                message: `${updatedCount} notifications marked as read`,
                data: { updatedCount }
            });
    
        } catch (error) {
            console.error('Error in markAllAsRead:', error);
            next(error);
        }
    }

    // Bulk mark notifications as read
    static async bulkMarkAsRead(req, res, next) {
        try {
            const { userId } = req.user;
            const { notificationIds } = req.body;

            if (!Array.isArray(notificationIds)) {
                return res.status(400).json({
                    success: false,
                    error: 'notificationIds must be an array'
                });
            }

            if (notificationIds.length === 0) {
                return res.status(400).json({
                    success: false,
                    error: 'notificationIds array cannot be empty'
                });
            }

            if (notificationIds.length > 100) {
                return res.status(400).json({
                    success: false,
                    error: 'Cannot process more than 100 notifications at once'
                });
            }

            const updatedCount = await NotificationService.bulkMarkAsRead(userId, notificationIds);

            res.json({
                success: true,
                message: `${updatedCount} notifications marked as read`,
                data: { 
                    updatedCount,
                    requestedCount: notificationIds.length,
                    skippedCount: notificationIds.length - updatedCount
                }
            });

        } catch (error) {
            console.error('Error in bulkMarkAsRead:', error);
            next(error);
        }
    }

    static async getNotificationStats(req, res, next) {
        try {
            const { userId } = req.user;
            const stats = await NotificationService.getNotificationStats(userId);
            res.json({
                success: true,
                data: stats
            });
        } catch (error) {
            next(error);
        }
    }


   // Bulk dismiss notifications
   static async bulkDismiss(req, res, next) {
    try {
        const { userId } = req.user;
        const { notificationIds } = req.body;

        if (!Array.isArray(notificationIds)) {
            return res.status(400).json({
                success: false,
                error: 'notificationIds must be an array'
            });
        }

        if (notificationIds.length === 0) {
            return res.status(400).json({
                success: false,
                error: 'notificationIds array cannot be empty'
            });
        }

        if (notificationIds.length > 100) {
            return res.status(400).json({
                success: false,
                error: 'Cannot process more than 100 notifications at once'
            });
        }

        const updatedCount = await NotificationService.bulkDismiss(userId, notificationIds);

        res.json({
            success: true,
            message: `${updatedCount} notifications dismissed`,
            data: { 
                updatedCount,
                requestedCount: notificationIds.length,
                skippedCount: notificationIds.length - updatedCount
            }
        });

    } catch (error) {
        console.error('Error in bulkDismiss:', error);
        next(error);
    }
}

    // Get notifications for a specific animal
    static async getNotificationsByAnimal(req, res, next) {
        try {
            const { userId } = req.user;
            const { animalId } = req.params;
            const { limit = 10 } = req.query;

            const { pool } = require('../config/database');
            const ownershipResult = await pool.query(
                'SELECT id FROM animals WHERE id = $1 AND owner_id = $2',
                [animalId, userId]
            );

            if (ownershipResult.rows.length === 0) {
                return res.status(404).json({
                    success: false,
                    error: 'Animal not found or access denied'
                });
            }

            const result = await pool.query(
                `SELECT n.*
                 FROM notifications n
                 WHERE n.user_id = $1 AND n.animal_id = $2
                 ORDER BY n.created_at DESC
                 LIMIT $3`,
                [userId, animalId, parseInt(limit)]
            );

            const notifications = result.rows.map(row => ({
                id: row.id,
                title: row.title,
                message: row.message,
                severity: row.severity,
                category: row.category,
                isRead: row.is_read,
                isDismissed: row.is_dismissed,
                createdAt: row.created_at,
                metadata: row.metadata
            }));

            res.json({
                success: true,
                data: { notifications }
            });

        } catch (error) {
            next(error);
        }
    }

        // Create test notification (development only)
        static async createTestNotification(req, res, next) {
            try {
                const { userId } = req.user;
                const { type, animalId, testData } = req.body;
    
                if (process.env.NODE_ENV === 'production') {
                    return res.status(403).json({
                        success: false,
                        error: 'Test notifications not allowed in production'
                    });
                }
    
                const notification = await NotificationService.createInAppNotification(
                    userId,
                    animalId,
                    {
                        type,
                        severity: 'medium',
                        data: testData || { animalName: 'Test Animal', hungerPercent: 80 }
                    }
                );
    
                res.json({
                    success: true,
                    message: 'Test notification created',
                    data: { notification }
                });
    
            } catch (error) {
                next(error);
            }
        }

    static async getPreviousAnimalStats(animalId) {
        try {
            const result = await pool.query(
                `SELECT * FROM animal_stat_history 
                 WHERE animal_id = $1 
                 ORDER BY recorded_at DESC 
                 LIMIT 1`,
                [animalId]
            );

            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            logger.warn('Could not get previous stats:', error.message);
            return null;
        }
    }

    static async recordAnimalStats(animalId, stats, animalStatus = 'alive') {
        try {
            await pool.query(
                `INSERT INTO animal_stat_history 
                 (animal_id, hunger_percent, happiness_percent, heat_percent, is_operable, is_breedable, animal_status, recorded_at)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())`,
                [animalId, stats.hungerPercent, stats.happinessPercent, 
                 stats.heatPercent, stats.isOperable, stats.isBreedable, animalStatus]
            );
        } catch (error) {
            try {
                await pool.query(
                    `INSERT INTO animal_stat_history 
                     (animal_id, hunger_percent, happiness_percent, heat_percent, is_operable, is_breedable, recorded_at)
                     VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
                    [animalId, stats.hungerPercent, stats.happinessPercent, 
                     stats.heatPercent, stats.isOperable, stats.isBreedable]
                );
            } catch (fallbackError) {
                logger.warn('Could not record animal stats:', fallbackError.message);
            }
        }
    }

  // Get notifications for the authenticated user
  static async getNotifications(req, res, next) {
    try {
        if (!req.user || !req.user.userId) {
            return res.status(401).json({
                success: false,
                error: 'User authentication required'
            });
        }

        const { userId } = req.user;
        const { 
            limit = '10', 
            offset = '0',
            unreadOnly = 'false',
            category = null
        } = req.query;

        const limitNum = parseInt(limit);
        const offsetNum = parseInt(offset);
        const unreadOnlyBool = unreadOnly === 'true';

        if (isNaN(limitNum) || limitNum < 1 || limitNum > 50) {
            return res.status(400).json({
                success: false,
                error: 'Invalid limit parameter (must be 1-50)'
            });
        }

        if (isNaN(offsetNum) || offsetNum < 0) {
            return res.status(400).json({
                success: false,
                error: 'Invalid offset parameter (must be >= 0)'
            });
        }

        const result = await NotificationService.getUserNotifications(userId, {
            limit: limitNum,
            offset: offsetNum,
            unreadOnly: unreadOnlyBool,
            category
        });

        res.json({
            success: true,
            data: {
                notifications: result.notifications || [],
                pagination: {
                    limit: limitNum,
                    offset: offsetNum,
                    totalCount: result.totalCount || 0,
                    hasMore: result.hasMore || false
                },
                unreadCount: result.unreadCount || 0
            }
        });

    } catch (error) {
        console.error('Error in getNotifications:', error);
        next(error);
    }
}


}

module.exports = NotificationService;