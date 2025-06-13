// middleware/notificationMiddleware.js
const NotificationService = require('../services/notificationService');
const logger = require('../utils/logger');

const addNotificationCount = async (req, res, next) => {
  try {
      if (req.user && req.user.userId) {
          const stats = await NotificationService.getNotificationStats(req.user.userId);
          req.user.notificationStats = stats;
      }
      next();
  } catch (error) {
      // Don't fail the request if notification count fails
      logger.warn('Failed to get notification stats:', error.message);
      req.user.notificationStats = { 
          unreadCount: 0, 
          totalNotifications: 0, 
          todayCount: 0, 
          criticalCount: 0 
      };
      next();
  }
};

// Middleware to ensure user has notification preferences set up
const ensureNotificationPreferences = async (req, res, next) => {
    try {
        if (req.user && req.user.userId) {
            // Check if user has preferences set up
            const preferences = await NotificationService.getUserNotificationPreferences(req.user.userId);
            
            if (Object.keys(preferences).length === 0) {
                // Set up default preferences for new user
                await NotificationService.initializeDefaultPreferences(req.user.userId);
            }
        }
        next();
    } catch (error) {
        logger.error('Error ensuring notification preferences:', error);
        next(); // Continue without failing the request
    }
};

module.exports = {
    addNotificationCount,
    ensureNotificationPreferences
};