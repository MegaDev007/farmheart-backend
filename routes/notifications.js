// routes/notifications.js
const express = require('express');
const router = express.Router();

const NotificationController = require('../controllers/notificationController');
const { authenticateToken } = require('../middleware/auth');
const { generalLimiter } = require('../middleware/rateLimiting');

// All notification routes require authentication
router.use(authenticateToken);

// Get user's notifications (remove duplicate route)
router.get('/', 
    generalLimiter, 
    NotificationController.getNotifications
);

// Get notification statistics
router.get('/stats', 
    generalLimiter, 
    NotificationController.getNotificationStats
);

// Mark all notifications as read
router.put('/mark-all-read', 
    generalLimiter, 
    NotificationController.markAllAsRead
);

// Bulk operations
router.put('/bulk/mark-read', 
    generalLimiter, 
    NotificationController.bulkMarkAsRead
);

router.put('/bulk/dismiss', 
    generalLimiter, 
    NotificationController.bulkDismiss
);

// Get notifications for specific animal
router.get('/animal/:animalId', 
    generalLimiter, 
    NotificationController.getNotificationsByAnimal
);

// Individual notification operations
router.put('/:notificationId/read', 
    generalLimiter, 
    NotificationController.markAsRead
);

router.put('/:notificationId/dismiss', 
    generalLimiter, 
    NotificationController.markAsDismissed
);

// Test notification (development only)
if (process.env.NODE_ENV !== 'production') {
    router.post('/test', 
        generalLimiter, 
        NotificationController.createTestNotification
    );
}

module.exports = router;