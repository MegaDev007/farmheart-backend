// controllers/notificationController.js
const NotificationService = require('../services/notificationService');
const logger = require('../utils/logger');

class NotificationController {

    // Get user's notifications
    static async getNotifications(req, res, next) {
        try {
            const { userId } = req.user;
            const {
                unreadOnly = false,
                category,
                severity,
                page = 1,
                limit = 20
            } = req.query;

            const options = {
                unreadOnly: unreadOnly === 'true',
                category,
                severity,
                limit: parseInt(limit),
                offset: (parseInt(page) - 1) * parseInt(limit)
            };

            const result = await NotificationService.getUserNotifications(userId, options);

            res.json({
                success: true,
                data: {
                    notifications: result.notifications,
                    pagination: {
                        page: parseInt(page),
                        limit: parseInt(limit),
                        totalCount: result.totalCount,
                        totalPages: Math.ceil(result.totalCount / parseInt(limit))
                    },
                    unreadCount: result.unreadCount
                }
            });

        } catch (error) {
            next(error);
        }
    }

    // Get notification statistics
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

    // Mark notification as read
    static async markAsRead(req, res, next) {
        try {
            const { notificationId } = req.params;
            const { userId } = req.user;

            const notification = await NotificationService.markAsRead(
                parseInt(notificationId), 
                userId
            );

            if (!notification) {
                return res.status(404).json({
                    success: false,
                    error: 'Notification not found or already read'
                });
            }

            res.json({
                success: true,
                message: 'Notification marked as read',
                data: { notification }
            });

        } catch (error) {
            next(error);
        }
    }

    // Mark notification as dismissed
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
            next(error);
        }
    }

    // Get user notification preferences
    static async getNotificationPreferences(req, res, next) {
        try {
            const { userId } = req.user;

            const preferences = await NotificationService.getUserNotificationPreferences(userId);

            res.json({
                success: true,
                data: { preferences }
            });

        } catch (error) {
            next(error);
        }
    }

    // Update user notification preferences
    static async updateNotificationPreferences(req, res, next) {
        try {
            const { userId } = req.user;
            const { preferences } = req.body;

            if (!Array.isArray(preferences)) {
                return res.status(400).json({
                    success: false,
                    error: 'Preferences must be an array'
                });
            }

            // Validate preference structure
            for (const pref of preferences) {
                if (!pref.name || typeof pref.inAppEnabled !== 'boolean' || typeof pref.emailEnabled !== 'boolean') {
                    return res.status(400).json({
                        success: false,
                        error: 'Invalid preference structure'
                    });
                }
            }

            await NotificationService.updateUserNotificationPreferences(userId, preferences);

            res.json({
                success: true,
                message: 'Notification preferences updated successfully'
            });

        } catch (error) {
            next(error);
        }
    }

    // Create a test notification (for development/testing)
    static async createTestNotification(req, res, next) {
        try {
            const { userId } = req.user;
            const { type, animalId, testData } = req.body;

            // Only allow in development environment
            if (process.env.NODE_ENV === 'production') {
                return res.status(403).json({
                    success: false,
                    error: 'Test notifications not allowed in production'
                });
            }

            const notification = await NotificationService.createNotification(
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

    // Get notifications by animal
    static async getNotificationsByAnimal(req, res, next) {
        try {
            const { userId } = req.user;
            const { animalId } = req.params;
            const { limit = 10 } = req.query;

            // Verify animal ownership
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
                `SELECT n.*, nt.name as type_name, nt.display_name as type_display, nt.category
                 FROM notifications n
                 JOIN notification_types nt ON n.notification_type_id = nt.id
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
                typeName: row.type_name,
                typeDisplay: row.type_display,
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

    // Delete old notifications (admin only or automated cleanup)
    static async cleanupNotifications(req, res, next) {
        try {
            const { daysOld = 30 } = req.query;

            const deletedCount = await NotificationService.cleanupOldNotifications(parseInt(daysOld));

            res.json({
                success: true,
                message: `${deletedCount} old notifications cleaned up`,
                data: { deletedCount }
            });

        } catch (error) {
            next(error);
        }
    }

    // Bulk operations
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

            const { pool } = require('../config/database');
            const result = await pool.query(
                `UPDATE notifications 
                 SET is_read = true, read_at = NOW()
                 WHERE id = ANY($1) AND user_id = $2 AND is_read = false
                 RETURNING id`,
                [notificationIds, userId]
            );

            res.json({
                success: true,
                message: `${result.rowCount} notifications marked as read`,
                data: { updatedCount: result.rowCount }
            });

        } catch (error) {
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

            const { pool } = require('../config/database');
            const result = await pool.query(
                `UPDATE notifications 
                 SET is_dismissed = true, dismissed_at = NOW()
                 WHERE id = ANY($1) AND user_id = $2
                 RETURNING id`,
                [notificationIds, userId]
            );

            res.json({
                success: true,
                message: `${result.rowCount} notifications dismissed`,
                data: { updatedCount: result.rowCount }
            });

        } catch (error) {
            next(error);
        }
    }
}

module.exports = NotificationController;