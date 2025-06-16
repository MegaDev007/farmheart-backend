// controllers/notificationController.js
const NotificationService = require('../services/notificationService');
const logger = require('../utils/logger');

class NotificationController {

    // Get user's notifications with pagination
    static async getNotifications(req, res, next) {
        try {
            // Validate that user exists in request
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

            // Validate parameters
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

            console.log('Getting notifications for user:', userId, 'limit:', limitNum, 'offset:', offsetNum, 'unreadOnly:', unreadOnlyBool, 'category:', category);

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

            console.log('-----------Controller markAsRead called');
            console.log('-----------notificationId from params:', notificationId);
            console.log('-----------userId from user:', userId);

            const notification = await NotificationService.markAsRead(
                notificationId,
                userId
            );

            if (!notification) {
                console.log('-----------No notification returned from service');
                return res.status(404).json({
                    success: false,
                    error: 'Notification not found or access denied'
                });
            }

            console.log('-----------Successfully processed mark as read:', notification.id);

            // Always return success if we got a notification back
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
            console.error('-----------Controller error:', error);
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

    // Bulk mark as read
    static async bulkMarkAsRead(req, res, next) {
        try {
            const { userId } = req.user;
            const { notificationIds } = req.body;

            // Validate input
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

    // Bulk dismiss
    static async bulkDismiss(req, res, next) {
        try {
            const { userId } = req.user;
            const { notificationIds } = req.body;

            // Validate input
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
}

module.exports = NotificationController;