const cron = require('node-cron');
const AnimalService = require('../services/animalService');
const NotificationService = require('../services/notificationService');
const logger = require('./logger');

class NotificationScheduler {
    
    static startScheduledTasks() {
        // Check for notifications every 5 minutes
        cron.schedule('*/5 * * * *', async () => {
            try {
                logger.info('Starting scheduled notification check');
                await AnimalService.performSystemWideNotificationCheck();
            } catch (error) {
                logger.error('Error in scheduled notification check:', error);
            }
        });

        // Clean up old notifications daily at 2 AM
        cron.schedule('0 2 * * *', async () => {
            try {
                logger.info('Starting notification cleanup');
                await NotificationService.cleanupOldNotifications(30);
            } catch (error) {
                logger.error('Error in notification cleanup:', error);
            }
        });

        // Clean up old animal stats weekly
        cron.schedule('0 3 * * 0', async () => {
            try {
                logger.info('Starting animal stats cleanup');
                const { pool } = require('../config/database');
                const result = await pool.query(
                    `DELETE FROM animal_stat_history 
                     WHERE recorded_at < NOW() - INTERVAL '7 days'`
                );
                logger.info('Animal stats cleaned up:', { deletedCount: result.rowCount });
            } catch (error) {
                logger.error('Error in animal stats cleanup:', error);
            }
        });

        logger.info('Notification scheduler started');
    }

    static stopScheduledTasks() {
        cron.destroy();
        logger.info('Notification scheduler stopped');
    }
}

module.exports = NotificationScheduler;