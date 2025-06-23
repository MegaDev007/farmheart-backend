// services/notificationPreferenceService.js

const { pool } = require('../config/database');
const logger = require('../utils/logger');

class NotificationPreferenceService {

  // Create default notification preferences for a user
  static async createDefaultPreferences(userId) {
      try {
          const result = await pool.query(
              `INSERT INTO user_notification_preferences (user_id, in_app_enabled, email_enabled, created_at, updated_at)
               VALUES ($1, $2, $3, NOW(), NOW())
               ON CONFLICT (user_id) DO NOTHING
               RETURNING *`,
              [userId, true, false] // Default: in-app enabled, email disabled
          );

          if (result.rows.length > 0) {
              logger.info('Default notification preferences created', { userId });
              return result.rows[0];
          }

          // If no rows returned, preferences already exist
          return await this.getPreferences(userId);

      } catch (error) {
          logger.error('Error creating default notification preferences:', error);
          throw error;
      }
  }

  // Get user's notification preferences
  static async getPreferences(userId) {
      try {
          const result = await pool.query(
              'SELECT in_app_enabled, email_enabled, created_at, updated_at FROM user_notification_preferences WHERE user_id = $1',
              [userId]
          );

          if (result.rows.length === 0) {
              // Create default preferences if they don't exist
              logger.info('Creating missing notification preferences for user', { userId });
              return await this.createDefaultPreferences(userId);
          }

          const prefs = result.rows[0];
          return {
              inAppEnabled: prefs.in_app_enabled,
              emailEnabled: prefs.email_enabled,
              createdAt: prefs.created_at,
              updatedAt: prefs.updated_at
          };

      } catch (error) {
          logger.error('Error getting notification preferences:', error);
          throw error;
      }
  }

  // Update user's notification preferences
  static async updatePreferences(userId, preferences) {
      try {
          const { inAppEnabled, emailEnabled } = preferences;

          // Validate input
          if (typeof inAppEnabled !== 'boolean' || typeof emailEnabled !== 'boolean') {
              throw new Error('inAppEnabled and emailEnabled must be boolean values');
          }

          // Get current preferences for comparison
          const currentPrefs = await this.getPreferences(userId);

          // Update preferences
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

          const updatedPrefs = result.rows[0];

          logger.info('Notification preferences updated', {
              userId,
              inAppEnabled,
              emailEnabled,
              previousInApp: currentPrefs.inAppEnabled,
              previousEmail: currentPrefs.emailEnabled
          });

          return {
              inAppEnabled: updatedPrefs.in_app_enabled,
              emailEnabled: updatedPrefs.email_enabled,
              updatedAt: updatedPrefs.updated_at,
              changes: {
                  inAppChanged: currentPrefs.inAppEnabled !== inAppEnabled,
                  emailChanged: currentPrefs.emailEnabled !== emailEnabled,
                  emailJustEnabled: !currentPrefs.emailEnabled && emailEnabled,
                  emailJustDisabled: currentPrefs.emailEnabled && !emailEnabled
              }
          };

      } catch (error) {
          logger.error('Error updating notification preferences:', error);
          throw error;
      }
  }

}

module.exports = NotificationPreferenceService;