const NotificationService = require('../services/notificationService');
const EmailService = require('../services/emailService');
const logger = require('../utils/logger');

class NotificationController {

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

    // All existing methods remain the same...
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
}

module.exports = NotificationController;