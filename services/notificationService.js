// services/notificationService.js
const { pool } = require('../config/database');
const logger = require('../utils/logger');

class NotificationService {

    // Check and create notifications based on animal stats
    static async checkAnimalStatusAndNotify(animalId, newStats, previousStats = null) {
        try {
 //           console.log("🔍 Checking animal ID:", animalId);
///            console.log("📊 New stats:", newStats);

            const animal = await NotificationService.getAnimalById(animalId);
            
            if (!animal) {
                logger.warn('Animal not found for notification check:', animalId);
                return 0;
            }

 //           console.log("🐴 Animal found:", animal.name || 'Unnamed Animal');
//            console.log("🏠 Animal status:", animal.status);

            // Get previous stats if not provided
            if (!previousStats) {
                previousStats = await NotificationService.getPreviousAnimalStats(animalId);
            }

 //           console.log("📈 Previous stats:", previousStats);

            // 🚨 IMPORTANT: Don't send notifications for pet animals
            if (animal.status === 'pet') {
                // Send a one-time notification when animal becomes a pet
                const wasPreviouslyPet = previousStats?.animal_status === 'pet';
                
                if (!wasPreviouslyPet) {
                    const petNotification = await NotificationService.createNotification(
                        animal.owner_id, 
                        animalId, 
                        {
                            type: 'animal_became_pet',
                            severity: 'medium',
                            data: {
                                animalName: animal.name || 'Unnamed Animal',
                                age: animal.age_days || 0
                            }
                        }
                    );

                    if (petNotification) {
                        console.log(`🎉 PET NOTIFICATION: ${animal.name} became a pet!`);
                        await NotificationService.recordAnimalStats(animalId, newStats);
                        return 1;
                    }
                }
                
                console.log("🐾 Skipping notifications - animal is a pet");
                await NotificationService.recordAnimalStats(animalId, newStats);
                return 0;
            }

            // 🚨 IMPORTANT: Don't send notifications for eden animals
            if (animal.status === 'eden') {
                console.log("💫 Skipping notifications - animal is in eden");
                await NotificationService.recordAnimalStats(animalId, newStats);
                return 0;
            }

            const notificationsToCreate = [];

            // 1. INOPERABLE NOTIFICATIONS (Check this FIRST!)
            // Trigger: animal becomes inoperable (state change)
            const previousOperable = previousStats?.is_operable !== false; // Default to true if no previous data
            
            if (!newStats.isOperable && previousOperable) {
                notificationsToCreate.push({
                    type: 'animal_inoperable',
                    severity: 'critical',
                    data: {
                        animalName: animal.name || 'Unnamed Animal',
                        hungerPercent: newStats.hungerPercent,
                        happinessPercent: newStats.happinessPercent,
                        heatPercent: newStats.heatPercent
                    }
                });
                console.log(`💀 INOPERABLE ALERT: ${animal.name} has become inoperable!`);
            }

            // 2. HUNGER NOTIFICATIONS (Only if animal is OPERABLE!)
            // Trigger: hunger >= 75% (critical at 95%) AND increasing AND animal is operable
            if (newStats.isOperable) {
                const hungerThreshold = 75;
                const hungerCriticalThreshold = 95;
                const previousHunger = previousStats?.hunger_percent || 0;
                
                if (newStats.hungerPercent >= hungerThreshold) {
                    // Only notify if hunger is increasing OR if no previous data
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
                                threshold: newStats.hungerPercent >= hungerCriticalThreshold ? hungerCriticalThreshold : hungerThreshold
                            }
                        });
                        console.log(`🚨 HUNGER ALERT: ${animal.name} hunger ${newStats.hungerPercent}% (was ${previousHunger}%)`);
                    }
                }
            } else {
                console.log(`⚠️  Skipping hunger notifications - ${animal.name} is inoperable`);
            }

            // 3. HAPPINESS NOTIFICATIONS (Only if animal is OPERABLE!)
            // Trigger: happiness <= 25% (critical at 5%) AND decreasing AND animal is operable
            if (newStats.isOperable) {
                const happinessThreshold = 25;
                const happinessCriticalThreshold = 5;
                const previousHappiness = previousStats?.happiness_percent || 100;
                
                if (newStats.happinessPercent <= happinessThreshold) {
                    // Only notify if happiness is decreasing OR if no previous data
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
                                threshold: newStats.happinessPercent <= happinessCriticalThreshold ? happinessCriticalThreshold : happinessThreshold
                            }
                        });
                        console.log(`😢 HAPPINESS ALERT: ${animal.name} happiness ${newStats.happinessPercent}% (was ${previousHappiness}%)`);
                    }
                }
            } else {
                console.log(`⚠️  Skipping happiness notifications - ${animal.name} is inoperable`);
            }

            // 4. BREEDING READY NOTIFICATIONS (Only if animal is OPERABLE!)
            // Trigger: animal becomes breedable (state change) AND animal is operable
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
                            hungerPercent: newStats.hungerPercent
                        }
                    });
                    console.log(`💕 BREEDING READY: ${animal.name} is now ready to breed!`);
                }
            } else {
                console.log(`⚠️  Skipping breeding notifications - ${animal.name} is inoperable`);
            }

            console.log("📋 Notifications to create:", notificationsToCreate.length);

            // Create all notifications with spam prevention
            let createdCount = 0;
            for (const notification of notificationsToCreate) {
                try {
                    // Check for spam (same notification type within last hour)
                    const isDuplicate = await NotificationService.checkForDuplicateNotification(
                        animal.owner_id, 
                        animalId, 
                        notification.type
                    );

                    if (!isDuplicate) {
                        const created = await NotificationService.createNotification(
                            animal.owner_id, 
                            animalId, 
                            notification
                        );
                        if (created) {
                            createdCount++;
                            console.log(`✅ Created notification: ${notification.type}`);
                        }
                    } else {
                        console.log(`⏭️  Skipped duplicate notification: ${notification.type}`);
                    }
                } catch (error) {
                    logger.error('Error creating individual notification:', error);
                }
            }

            // Store current stats for future comparison (include animal status)
            await NotificationService.recordAnimalStats(animalId, newStats, animal.status);

            // logger.info('Notification check completed:', {
            //     animalId,
            //     animalName: animal.name,
            //     animalStatus: animal.status,
            //     isOperable: newStats.isOperable,
            //     notificationsCreated: createdCount,
            //     notificationsSkipped: notificationsToCreate.length - createdCount
            // });

            return createdCount;

        } catch (error) {
            logger.error('Error checking animal status for notifications:', error);
            return 0; // Don't throw to avoid breaking animal updates
        }
    }

    // Check for duplicate notifications to prevent spam
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
            return false; // If we can't check, allow the notification
        }
    }

    // Create a notification with improved templates
    static async createNotification(userId, animalId, notificationData) {
        try {
            const { type, severity, data } = notificationData;

            console.log("📝 Creating notification:", { type, severity, userId, animalId });

            // Validate required data
            if (!userId || !type || !data) {
                logger.error('Invalid notification data:', { userId, type, data });
                return null;
            }

            // Enhanced template system with categories
            const templates = {
                'animal_hunger': {
                    title: '🍽️ {animalName} is getting hungry',
                    body: '{animalName} hunger level has reached {hungerPercent}% (up from {previousHunger}%). Please provide food soon to prevent health issues.',
                    category: 'animal_care'
                },
                'animal_critical_hunger': {
                    title: '🚨 {animalName} is critically hungry!',
                    body: 'URGENT: {animalName} hunger level is at {hungerPercent}% - immediate feeding required! Your animal will become inoperable if not fed soon.',
                    category: 'animal_care'
                },
                'animal_happiness_low': {
                    title: '😔 {animalName} is feeling sad',
                    body: '{animalName} happiness has dropped to {happinessPercent}% (down from {previousHappiness}%). Consider brushing or providing minerals to improve mood.',
                    category: 'animal_care'
                },
                'animal_happiness_critical': {
                    title: '💔 {animalName} is very unhappy!',
                    body: 'URGENT: {animalName} happiness is critically low at {happinessPercent}%. Immediate care needed - brush your animal or provide minerals!',
                    category: 'animal_care'
                },
                'breeding_ready': {
                    title: '💕 {animalName} is ready to breed',
                    body: 'Great news! {animalName} has reached optimal breeding conditions with {heatPercent}% heat, {happinessPercent}% happiness, and {hungerPercent}% satiation.',
                    category: 'breeding'
                },
                'animal_inoperable': {
                    title: '💀 {animalName} has become inoperable',
                    body: 'CRITICAL: {animalName} is no longer functional due to neglect (Hunger: {hungerPercent}%, Happiness: {happinessPercent}%). Feed and care for your animal immediately to restore functionality!',
                    category: 'animal_care'
                },
                'animal_became_pet': {
                    title: '🎉 {animalName} became a pet!',
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

            // Try to create the notification in database
            try {
                const result = await pool.query(
                    `INSERT INTO notifications (user_id, animal_id, title, message, severity, category, metadata, created_at)
                     VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
                     RETURNING *`,
                    [userId, animalId, title, message, severity, category, JSON.stringify(data)]
                );

                const notification = result.rows[0];

                logger.info('✅ Notification created successfully:', {
                    notificationId: notification.id,
                    userId,
                    animalId,
                    type,
                    severity,
                    title: title.substring(0, 50) + '...'
                });

                // Send real-time notification if possible
                try {
                    await NotificationService.sendRealTimeNotification(userId, notification);
                } catch (realtimeError) {
                    // Real-time is optional, don't fail if it doesn't work
                    logger.warn('Failed to send real-time notification:', realtimeError.message);
                }

                return notification;

            } catch (dbError) {
                // If database table doesn't exist, just log the notification
                logger.info('📝 Notification would be created (DB table missing):', {
                    userId,
                    animalId,
                    type,
                    title: title.substring(0, 50) + '...',
                    message: message.substring(0, 100) + '...',
                    severity
                });
                return { id: Date.now(), title, message, severity }; // Mock notification
            }

        } catch (error) {
            logger.error('Error creating notification:', error);
            return null;
        }
    }

    // Send real-time notification
    static async sendRealTimeNotification(userId, notification) {
        try {
            // Get the global Socket.IO instance
            const io = global.io;
            
            if (io) {
                // Send to specific user's room
                io.to(`user_${userId}`).emit('new_notification', {
                    id: notification.id,
                    title: notification.title,
                    message: notification.message,
                    severity: notification.severity,
                    animalId: notification.animal_id,
                    createdAt: notification.created_at,
                    metadata: notification.metadata
                });
                
                // Also send updated stats
                const stats = await NotificationService.getNotificationStats(userId);
                io.to(`user_${userId}`).emit('notification_stats', stats);
                
                console.log(`🔔 Real-time notification sent to user ${userId}:`, notification.title);
                logger.info('Real-time notification sent', {
                    userId,
                    notificationId: notification.id,
                    title: notification.title,
                    severity: notification.severity
                });
            } else {
                console.log('⚠️  Socket.IO not available for real-time notification');
            }
        } catch (error) {
            logger.error('Error sending real-time notification:', error);
        }
    }

    // Get previous animal stats for comparison
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

    // Record current animal stats for future comparison
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
            // Try without animal_status column if it doesn't exist yet
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

    // Get animal by ID with proper error handling
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

    // Helper method to replace template variables
    static replaceTemplateVariables(template, data) {
        let result = template;
        for (const [key, value] of Object.entries(data)) {
            const regex = new RegExp(`{${key}}`, 'g');
            result = result.replace(regex, value);
        }
        return result;
    }

// Get user notifications with filtering
// Ultra simple version - replace the getUserNotifications method temporarily
static async getUserNotifications(userId, limit = 50) {
    try {
        console.log('getUserNotifications called with userId:', userId, 'limit:', limit);

        // Use string interpolation to avoid parameter binding issues (for debugging only)
        const query = `
            SELECT id, user_id, animal_id, title, message, severity, category, 
                   is_read, is_dismissed, created_at, read_at, metadata
            FROM notifications 
            WHERE user_id = ${parseInt(userId)} AND is_dismissed = false
            ORDER BY created_at DESC
            LIMIT ${parseInt(limit)}
        `;

        console.log('Executing ultra simple query:', query);

        const result = await pool.query(query);

        const notifications = result.rows.map(row => ({
            id: row.id,
            title: row.title,
            message: row.message,
            severity: row.severity,
            category: row.category,
            animalId: row.animal_id,
            animalName: null,
            isRead: row.is_read,
            isDismissed: row.is_dismissed,
            createdAt: row.created_at,
            readAt: row.read_at,
            metadata: row.metadata
        }));

        console.log(`Found ${notifications.length} notifications for user ${userId}`);

        return {
            notifications,
            totalCount: notifications.length,
            unreadCount: notifications.filter(n => !n.is_read).length
        };

    } catch (error) {
        console.error('Database error in getUserNotifications:', error);
        return { 
            notifications: [], 
            totalCount: 0, 
            unreadCount: 0 
        };
    }
}

    // Mark notification as read
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


       // Mark notification as dismiss
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
            logger.error('Error marking notification as read:', error);
            throw error;
        }
    }

    // // Mark notification as all read
    // static async markAllAsRead(notificationId, userId) {
    //     try {


    //         const result = await pool.query(
    //             `UPDATE notifications 
    //              SET is_read = true, read_at = NOW()
    //              WHERE id = $1 AND user_id = $2 AND is_read = false
    //              RETURNING *`,
    //             [notificationId, userId]
    //         );

    //         return result.rows.length > 0 ? result.rows[0] : null;
    //     } catch (error) {
    //         logger.error('Error marking notification as read:', error);
    //         throw error;
    //     }
    // }    

    // Get notification statistics
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
}

module.exports = NotificationService;