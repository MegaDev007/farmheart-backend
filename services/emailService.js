// services/emailService.js

const formData = require('form-data');
const Mailgun = require('mailgun.js');
const logger = require('../utils/logger');

class EmailService {
    constructor() {
        this.mailgun = new Mailgun(formData);
        this.mg = this.mailgun.client({
            username: 'api',
            key: process.env.MAILGUN_API_KEY
        });
        this.domain = process.env.MAILGUN_DOMAIN || process.env.MAILGUN_DOMAIN_TEST;
        // this.domain = process.env.MAILGUN_DOMAIN_TEST;
        this.fromEmail = process.env.FROM_EMAIL || 'noreply@farmheartvirtual.com';
    }

    async sendNotificationEmail(to, subject, html) {
        try {
            if (!to || !subject || !html) {
                throw new Error('Missing required email parameters');
            }

            const messageData = {
                from: `Farmheart Virtual <${this.fromEmail}>`,
                to: to,
                subject: subject,
                html: html,
                text: this.stripHtml(html) // Fallback text version
            };

            logger.info('Sending email notification:', {
                to: to,
                subject: subject,
                domain: this.domain
            });

            const result = await this.mg.messages.create(this.domain, messageData);

            logger.info('Email sent successfully:', {
                to: to,
                subject: subject,
                messageId: result.id
            });

            return result;

        } catch (error) {
            logger.error('Error sending email:', {
                error: error.message,
                to: to,
                subject: subject,
                domain: this.domain
            });
            throw error;
        }
    }

    // Send test email
    async sendTestEmail(to, testData = {}) {
        try {
            const subject = 'Farmheart Virtual - Test Email';
            const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4CAF50;">🧪 Test Email from Farmheart Virtual</h2>
                    <p>This is a test email to verify that email notifications are working correctly.</p>
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3>Test Data:</h3>
                        <pre>${JSON.stringify(testData, null, 2)}</pre>
                    </div>
                    <p>If you received this email, your notification system is working! 🎉</p>
                    <p>The Farmheart Team</p>
                </div>
            `;

            return await this.sendNotificationEmail(to, subject, html);

        } catch (error) {
            logger.error('Error sending test email:', error);
            throw error;
        }
    }

    // Helper method to strip HTML for text version
    stripHtml(html) {
        return html
            .replace(/<[^>]*>/g, '')
            .replace(/&nbsp;/g, ' ')
            .replace(/&amp;/g, '&')
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&#39;/g, "'")
            .replace(/\s+/g, ' ')
            .trim();
    }

    // Send welcome email
    async sendWelcomeEmail(to, displayName) {
        try {
            const subject = 'Welcome to Farmheart Virtual! 🐎';
            const html = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <h2 style="color: #4CAF50;">🐎 Welcome to Farmheart Virtual!</h2>
                    <p>Dear ${displayName || 'Breeder'},</p>
                    <p>Welcome to the Farmheart Virtual community! We're excited to have you join our family of virtual animal breeders.</p>
                    
                    <div style="background: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
                        <h3>🔔 Email Notifications</h3>
                        <p>You can enable email notifications for important events like:</p>
                        <ul>
                            <li>🎉 When your animals become pets</li>
                            <li>🚨 When animals become inoperable</li>
                            <li>💕 When animals are ready to breed</li>
                        </ul>
                        <p>Manage your notification preferences in your account settings.</p>
                    </div>

                    <p>Visit our website to manage your animals and stay updated on all the latest news!</p>
                    <p><a href="https://farmheartvirtual.com" style="color: #2196F3;">Visit Farmheart Virtual</a></p>
                    
                    <p>Happy breeding!</p>
                    <p>The Farmheart Team</p>
                </div>
            `;

            return await this.sendNotificationEmail(to, subject, html);

        } catch (error) {
            logger.error('Error sending welcome email:', error);
            throw error;
        }
    }
}

module.exports = new EmailService();