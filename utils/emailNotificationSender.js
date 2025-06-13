const nodemailer = require('nodemailer');
const { pool } = require('../config/database');
const logger = require('./logger');

class EmailNotificationSender {

    static async initializeTransporter() {
        // Configure your email transporter
        this.transporter = nodemailer.createTransporter({
            host: process.env.SMTP_HOST,
            port: process.env.SMTP_PORT,
            secure: process.env.SMTP_SECURE === 'true',
            auth: {
                user: process.env.SMTP_USER,
                pass: process.env.SMTP_PASS
            }
        });
    }

    static async sendPendingEmails() {
        try {
            // Get pending email notifications
            const result = await pool.query(
                `SELECT nd.*, n.title, n.message, n.severity, u.email, u.sl_username
                 FROM notification_deliveries nd
                 JOIN notifications n ON nd.notification_id = n.id
                 JOIN users u ON n.user_id = u.id
                 WHERE nd.delivery_method = 'email' 
                   AND nd.status = 'pending'
                   AND u.email IS NOT NULL
                 ORDER BY nd.attempted_at ASC
                 LIMIT 100`
            );

            for (const delivery of result.rows) {
                try {
                    await this.sendEmail(delivery);
                    
                    // Mark as sent
                    await pool.query(
                        `UPDATE notification_deliveries 
                         SET status = 'sent', delivered_at = NOW()
                         WHERE id = $1`,
                        [delivery.id]
                    );

                } catch (error) {
                    logger.error('Failed to send email notification:', {
                        deliveryId: delivery.id,
                        email: delivery.email,
                        error: error.message
                    });

                    // Mark as failed
                    await pool.query(
                        `UPDATE notification_deliveries 
                         SET status = 'failed', error_message = $1
                         WHERE id = $2`,
                        [error.message, delivery.id]
                    );
                }
            }

            if (result.rows.length > 0) {
                logger.info('Email notifications processed:', { count: result.rows.length });
            }

        } catch (error) {
            logger.error('Error processing email notifications:', error);
        }
    }

    static async sendEmail(delivery) {
        if (!this.transporter) {
            await this.initializeTransporter();
        }

        const emailOptions = {
            from: process.env.FROM_EMAIL || 'noreply@farmheart.com',
            to: delivery.email,
            subject: `Farmheart - ${delivery.title}`,
            html: this.generateEmailTemplate(delivery)
        };

        await this.transporter.sendMail(emailOptions);
    }

    static generateEmailTemplate(delivery) {
        return `
        <!DOCTYPE html>
        <html>
        <head>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Farmheart Notification</title>
            <style>
                body { font-family: Arial, sans-serif; margin: 0; padding: 20px; background-color: #f5f5f5; }
                .container { max-width: 600px; margin: 0 auto; background-color: white; padding: 20px; border-radius: 8px; }
                .header { background-color: #2E7D32; color: white; padding: 20px; border-radius: 8px 8px 0 0; margin: -20px -20px 20px -20px; }
                .severity-high { border-left: 4px solid #f44336; }
                .severity-critical { border-left: 4px solid #d32f2f; background-color: #ffebee; }
                .severity-medium { border-left: 4px solid #ff9800; }
                .severity-low { border-left: 4px solid #4caf50; }
                .content { padding: 20px 0; }
                .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #eee; font-size: 12px; color: #666; }
            </style>
        </head>
        <body>
            <div class="container">
                <div class="header">
                    <h1>🌾 Farmheart</h1>
                    <p>Animal Care Notification</p>
                </div>
                <div class="content severity-${delivery.severity}">
                    <h2>${delivery.title}</h2>
                    <p>${delivery.message}</p>
                    <p><strong>Animal Owner:</strong> ${delivery.sl_username}</p>
                    <p><strong>Severity:</strong> ${delivery.severity.toUpperCase()}</p>
                </div>
                <div class="footer">
                    <p>This notification was sent because you have email notifications enabled for animal care alerts.</p>
                    <p>To manage your notification preferences, please visit your Farmheart dashboard.</p>
                    <p>&copy; Farmheart Virtual Breedables</p>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    static startEmailProcessor() {
        // Process email queue every minute
        setInterval(async () => {
            await this.sendPendingEmails();
        }, 60000);

        logger.info('Email notification processor started');
    }
}