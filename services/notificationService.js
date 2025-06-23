// services/notificationService.js

const { pool } = require('../config/database');
const logger = require('../utils/logger');
const EmailService = require('./emailService'); // We'll create this

class NotificationService {

    // Enhanced method to check animal status and notify via both channels
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
                            location: animal.region_name || 'Unknown Region'
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
                        location: animal.region_name || 'Unknown Region'
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
                            location: animal.region_name || 'Unknown Region'
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
                                emailOnly: false // This is in-app only
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
                                emailOnly: false // This is in-app only
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

    // New method to send notifications via both channels
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

    // Create in-app notification (existing logic)
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

            try {
                const result = await pool.query(
                    `INSERT INTO notifications (user_id, animal_id, title, message, severity, category, metadata, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                     RETURNING *`,
                    [userId, animalId, title, message, severity, category, JSON.stringify(data)]
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
                return { id: Date.now(), title, message, severity };
            }

        } catch (error) {
            logger.error('Error creating in-app notification:', error);
            return null;
        }
    }

    // New method to send email notifications
    static async sendEmailNotification(userId, animalId, notificationData, animal) {
        try {
            const { type, severity, data } = notificationData;
            
            // Get user email
            const userResult = await pool.query(
                'SELECT email, sl_username FROM users WHERE id = $1',
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

            // Create SL URL for the animal location
            const slUrl = data.location ? 
                `http://maps.secondlife.com/secondlife/${encodeURIComponent(data.location)}` : 
                'Location unavailable';

            // Email templates for specific notification types
            const emailTemplates = {
                'animal_became_pet': {
                    subject: `🎉 ${data.animalName} became a pet!`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #4CAF50;">🎉 Congratulations!</h2>
                            <p>Dear ${user.sl_username || 'Breeder'},</p>
                            <p><strong>${data.animalName}</strong> has completed its breeding cycle at <strong>${data.age} days old</strong> and is now a beloved pet!</p>
                            <p>🎊 <em>No more feeding or care required - just enjoy riding and companionship!</em></p>
                            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                                <h3>Animal Location:</h3>
                                <p><a href="${slUrl}" style="color: #2196F3;">Visit ${data.animalName} in Second Life</a></p>
                            </div>
                            <p>Happy trails!</p>
                            <p>The Farmheart Team</p>
                        </div>
                    `
                },
                'animal_inoperable': {
                    subject: `🚨 URGENT: ${data.animalName} needs immediate care!`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #f44336;">🚨 CRITICAL ALERT</h2>
                            <p>Dear ${user.sl_username || 'Breeder'},</p>
                            <p><strong>${data.animalName}</strong> has become inoperable due to neglect and needs immediate attention!</p>
                            <div style="background: #ffebee; padding: 15px; border-radius: 5px; margin: 20px 0; border-left: 4px solid #f44336;">
                                <h3>Current Status:</h3>
                                <ul>
                                    <li>Hunger: <strong>${data.hungerPercent}%</strong></li>
                                    <li>Happiness: <strong>${data.happinessPercent}%</strong></li>
                                    <li>Heat: <strong>${data.heatPercent}%</strong></li>
                                </ul>
                            </div>
                            <p><strong>Action Required:</strong> Feed and care for your animal immediately to restore functionality!</p>
                            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                                <h3>Animal Location:</h3>
                                <p><a href="${slUrl}" style="color: #2196F3;">Visit ${data.animalName} in Second Life</a></p>
                            </div>
                            <p>Please act quickly to restore your animal's health.</p>
                            <p>The Farmheart Team</p>
                        </div>
                    `
                },
                'breeding_ready': {
                    subject: `💕 ${data.animalName} is ready to breed!`,
                    html: `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #9C27B0;">💕 Breeding Ready!</h2>
                            <p>Dear ${user.sl_username || 'Breeder'},</p>
                            <p>Great news! <strong>${data.animalName}</strong> has reached optimal breeding conditions!</p>
                            <div style="background: #f3e5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                                <h3>Breeding Stats:</h3>
                                <ul>
                                    <li>Heat: <strong>${data.heatPercent}%</strong> ✅</li>
                                    <li>Happiness: <strong>${data.happinessPercent}%</strong> ✅</li>
                                    <li>Hunger: <strong>${data.hungerPercent}%</strong> ✅</li>
                                </ul>
                            </div>
                            <p>Your animal is now ready for breeding! Find a suitable mate and create the next generation.</p>
                            <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                                <h3>Animal Location:</h3>
                                <p><a href="${slUrl}" style="color: #2196F3;">Visit ${data.animalName} in Second Life</a></p>
                            </div>
                            <p>Happy breeding!</p>
                            <p>The Farmheart Team</p>
                        </div>
                    `
                }
            };

            const emailTemplate = emailTemplates[type];
            if (!emailTemplate) {
                logger.warn('No email template for notification type:', type);
                return;
            }

            // Send email using EmailService
            await EmailService.sendNotificationEmail(
                user.email,
                emailTemplate.subject,
                emailTemplate.html
            );

            logger.info('Email notification sent successfully', {
                userId,
                animalId,
                type,
                email: user.email
            });

        } catch (error) {
            logger.error('Error sending email notification:', error);
        }
    }

    // Get user notification preferences
    static async getUserNotificationPreferences(userId) {
        try {
            const result = await pool.query(
                'SELECT in_app_enabled, email_enabled FROM user_notification_preferences WHERE user_id = $1',
                [userId]
            );

            if (result.rows.length === 0) {
                // Create default preferences if they don't exist
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
            // Return defaults on error
            return { inAppEnabled: true, emailEnabled: false };
        }
    }

    // Update user notification preferences
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

    // Keep all existing methods unchanged...
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

    static replaceTemplateVariables(template, data) {
        let result = template;
        for (const [key, value] of Object.entries(data)) {
            const regex = new RegExp(`{${key}}`, 'g');
            result = result.replace(regex, value);
        }
        return result;
    }

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

    static async markAsRead(notificationId, userId) {
        try {
            const result = await pool.query(
                `UPDATE notifications 
                 SET is_read = true, read_at = NOW()
                 WHERE id = $1 AND user_id = $2 AND is_read = false
                 RETURNING *`,
                [notificationId, userId]
            );

            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            logger.error('Error marking notification as read:', error);
            throw error;
        }
    }

    static async markAsDismissed(notificationId, userId) {
        try {
            const result = await pool.query(
                `UPDATE notifications 
                 SET is_dismissed = true, dismissed_at = NOW()
                 WHERE id = $1 AND user_id = $2 AND is_dismissed = false
                 RETURNING *`,
                [notificationId, userId]
            );

            return result.rows.length > 0 ? result.rows[0] : null;
        } catch (error) {
            logger.error('Error marking notification as dismissed:', error);
            throw error;
        }
    }

    static async markAllAsRead(userId, category) {
        try {
            let result;

            if (!category || category === "unread" || category === "all") {
                result = await pool.query(
                    `UPDATE notifications 
                     SET is_read = true, read_at = NOW()
                     WHERE user_id = $1 AND is_read = false AND is_dismissed = false
                     RETURNING *`,
                    [userId]
                );
            } else {
                result = await pool.query(
                    `UPDATE notifications 
                     SET is_read = true, read_at = NOW()
                     WHERE user_id = $1 AND category = $2 AND is_read = false AND is_dismissed = false
                     RETURNING *`,
                    [userId, category]
                );
            }
            
            return result.rows.length;
        } catch (error) {
            logger.error('Error marking all notifications as read:', error);
            throw error;
        }
    }

    static async getNotificationStats(userId) {
        try {
            const result = await pool.query(
                `SELECT 
                    COUNT(*) as total_notifications,
                    COUNT(*) FILTER (WHERE is_read = false) as unread_count,
                    COUNT(*) FILTER (WHERE created_at >= NOW() - INTERVAL '24 hours') as today_count,
                    COUNT(*) FILTER (WHERE severity = 'critical') as critical_count
                 FROM notifications 
                 WHERE user_id = $1 AND is_dismissed = false`,
                [userId]
            );

            const stats = result.rows[0];
            return {
                totalNotifications: parseInt(stats.total_notifications) || 0,
                unreadCount: parseInt(stats.unread_count) || 0,
                todayCount: parseInt(stats.today_count) || 0,
                criticalCount: parseInt(stats.critical_count) || 0
            };
        } catch (error) {
            logger.error('Error getting notification stats:', error);
            return {
                totalNotifications: 0,
                unreadCount: 0,
                todayCount: 0,
                criticalCount: 0
            };
        }
    }

    static async bulkMarkAsRead(userId, notificationIds) {
        try {
            if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
                return 0;
            }

            const validIds = notificationIds
                .map(id => parseInt(id))
                .filter(id => !isNaN(id) && id > 0);

            if (validIds.length === 0) {
                return 0;
            }

            const placeholders = validIds.map((_, index) => `${index + 2}`).join(', ');
            const query = `
                UPDATE notifications 
                SET is_read = true, read_at = NOW()
                WHERE user_id = $1 AND id IN (${placeholders}) AND is_read = false AND is_dismissed = false
                RETURNING id
            `;

            const result = await pool.query(query, [userId, ...validIds]);
            const updatedCount = result.rows.length;

            if (updatedCount > 0) {
                try {
                    const stats = await NotificationService.getNotificationStats(userId);
                    const io = global.io;
                    if (io) {
                        io.to(`user_${userId}`).emit('notification_stats', stats);
                    }
                } catch (realtimeError) {
                    console.log('Could not send real-time stats update:', realtimeError.message);
                }
            }

            return updatedCount;
        } catch (error) {
            logger.error('Error bulk marking notifications as read:', error);
            throw error;
        }
    }

    static async bulkDismiss(userId, notificationIds) {
        try {
            if (!Array.isArray(notificationIds) || notificationIds.length === 0) {
                return 0;
            }

            const validIds = notificationIds
                .map(id => parseInt(id))
                .filter(id => !isNaN(id) && id > 0);

            if (validIds.length === 0) {
                return 0;
            }

            const placeholders = validIds.map((_, index) => `${index + 2}`).join(', ');
            const query = `
                UPDATE notifications 
                SET is_dismissed = true, dismissed_at = NOW()
                WHERE user_id = $1 AND id IN (${placeholders}) AND is_dismissed = false
                RETURNING id
            `;

            const result = await pool.query(query, [userId, ...validIds]);
            const updatedCount = result.rows.length;

            if (updatedCount > 0) {
                try {
                    const stats = await NotificationService.getNotificationStats(userId);
                    const io = global.io;
                    if (io) {
                        io.to(`user_${userId}`).emit('notification_stats', stats);
                    }
                } catch (realtimeError) {
                    console.log('Could not send real-time stats update:', realtimeError.message);
                }
            }

            return updatedCount;
        } catch (error) {
            logger.error('Error bulk dismissing notifications:', error);
            throw error;
        }
    }
}

module.exports = NotificationService;