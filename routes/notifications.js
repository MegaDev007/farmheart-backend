// routes/notifications.js

const express = require('express');
const router = express.Router();

const NotificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/auth');

router.use(authenticateToken);

// Notification preferences routes
router.get('/preferences', NotificationController.getNotificationPreferences);
router.put('/preferences', NotificationController.updateNotificationPreferences);

// Test email route
router.post('/test-email', NotificationController.sendTestEmail);

// Get user's notifications
router.get('/', NotificationController.getNotifications);

// Get notification statistics
router.get('/stats', NotificationController.getNotificationStats);

// Mark all notifications as read
router.put('/mark-all-read', NotificationController.markAllAsRead);

// Bulk operations
router.put('/bulk/mark-read', NotificationController.bulkMarkAsRead);
router.put('/bulk/dismiss', NotificationController.bulkDismiss);

// Get notifications for specific animal
router.get('/animal/:animalId', NotificationController.getNotificationsByAnimal);

// Individual notification operations
router.put('/:notificationId/read', NotificationController.markAsRead);
router.put('/:notificationId/dismiss', NotificationController.markAsDismissed);

// Test notification (development only)
if (process.env.NODE_ENV !== 'production') {
    router.post('/test', NotificationController.createTestNotification);
}

module.exports = router;