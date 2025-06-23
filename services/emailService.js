// services/emailService.js

const FormData = require('form-data');
const Mailgun = require('mailgun.js');
const logger = require('../utils/logger');

class EmailService {
    constructor() {
        this.mailgun = new Mailgun(FormData);
        this.mg = this.mailgun.client({
            username: 'api',
            key: process.env.MAILGUN_API_KEY,
        });
        this.domain = process.env.MAILGUN_DOMAIN || 'sandbox30399df431914ebb858787ceb5415064.mailgun.org';
        this.fromEmail = process.env.FROM_EMAIL || 'postmaster@sandbox30399df431914ebb858787ceb5415064.mailgun.org';
    }

    // Base email template that matches your frontend theme
    getBaseTemplate(title, content, ctaButton = null) {
        return `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>${title}</title>
            <style>
                * {
                    margin: 0;
                    padding: 0;
                    box-sizing: border-box;
                }
                
                body {
                    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
                    line-height: 1.6;
                    color: #374151;
                    background-color: #f9fafb;
                    margin: 0;
                    padding: 0;
                }
                
                .email-container {
                    max-width: 600px;
                    margin: 0 auto;
                    background-color: #ffffff;
                    box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
                }
                
                .email-header {
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                    padding: 32px 24px;
                    text-align: center;
                }
                
                .email-header h1 {
                    color: #ffffff;
                    font-size: 28px;
                    font-weight: 700;
                    margin-bottom: 8px;
                }
                
                .email-header .subtitle {
                    color: #d1fae5;
                    font-size: 16px;
                    font-weight: 500;
                }
                
                .email-body {
                    padding: 32px 24px;
                }
                
                .greeting {
                    font-size: 18px;
                    font-weight: 600;
                    color: #111827;
                    margin-bottom: 16px;
                }
                
                .content {
                    font-size: 16px;
                    color: #374151;
                    line-height: 1.7;
                    margin-bottom: 24px;
                }
                
                .card {
                    background-color: #f9fafb;
                    border: 1px solid #e5e7eb;
                    border-radius: 12px;
                    padding: 20px;
                    margin: 20px 0;
                }
                
                .card-success {
                    background-color: #ecfdf5;
                    border-color: #a7f3d0;
                }
                
                .card-warning {
                    background-color: #fef3c7;
                    border-color: #fde68a;
                }
                
                .card-critical {
                    background-color: #fef2f2;
                    border-color: #fca5a5;
                }
                
                .card-header {
                    display: flex;
                    align-items: center;
                    margin-bottom: 12px;
                }
                
                .card-icon {
                    width: 24px;
                    height: 24px;
                    margin-right: 12px;
                    border-radius: 50%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 14px;
                }
                
                .card-icon-success {
                    background-color: #10b981;
                    color: white;
                }
                
                .card-icon-warning {
                    background-color: #f59e0b;
                    color: white;
                }
                
                .card-icon-critical {
                    background-color: #ef4444;
                    color: white;
                }
                
                .card-title {
                    font-size: 16px;
                    font-weight: 600;
                    color: #111827;
                }
                
                .stats-grid {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(120px, 1fr));
                    gap: 16px;
                    margin: 16px 0;
                }
                
                .stat-item {
                    text-align: center;
                    padding: 12px;
                    background-color: #ffffff;
                    border-radius: 8px;
                    border: 1px solid #e5e7eb;
                }
                
                .stat-label {
                    font-size: 12px;
                    color: #6b7280;
                    text-transform: uppercase;
                    letter-spacing: 0.05em;
                    margin-bottom: 4px;
                }
                
                .stat-value {
                    font-size: 18px;
                    font-weight: 700;
                    color: #111827;
                }
                
                .stat-success {
                    color: #10b981;
                }
                
                .stat-warning {
                    color: #f59e0b;
                }
                
                .stat-critical {
                    color: #ef4444;
                }
                
                .cta-button {
                    display: inline-block;
                    background: linear-gradient(135deg, #10b981 0%, #059669 100%);
                    color: #ffffff;
                    text-decoration: none;
                    padding: 14px 24px;
                    border-radius: 8px;
                    font-weight: 600;
                    font-size: 16px;
                    text-align: center;
                    margin: 20px 0;
                    box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
                    transition: all 0.3s ease;
                }
                
                .cta-button:hover {
                    background: linear-gradient(135deg, #059669 0%, #047857 100%);
                    transform: translateY(-1px);
                    box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
                }
                
                .location-card {
                    background: linear-gradient(135deg, #3b82f6 0%, #2563eb 100%);
                    color: white;
                    border-radius: 12px;
                    padding: 20px;
                    margin: 20px 0;
                    text-align: center;
                }
                
                .location-link {
                    color: #dbeafe;
                    text-decoration: none;
                    font-weight: 600;
                    border-bottom: 1px solid #dbeafe;
                }
                
                .location-link:hover {
                    color: white;
                    border-bottom-color: white;
                }
                
                .email-footer {
                    background-color: #f9fafb;
                    padding: 24px;
                    text-align: center;
                    border-top: 1px solid #e5e7eb;
                }
                
                .footer-text {
                    color: #6b7280;
                    font-size: 14px;
                    margin-bottom: 8px;
                }
                
                .footer-logo {
                    color: #10b981;
                    font-weight: 700;
                    font-size: 16px;
                }
                
                .divider {
                    height: 1px;
                    background-color: #e5e7eb;
                    margin: 24px 0;
                }
                
                @media (max-width: 600px) {
                    .email-container {
                        margin: 0;
                        border-radius: 0;
                    }
                    
                    .email-header, .email-body, .email-footer {
                        padding: 20px 16px;
                    }
                    
                    .stats-grid {
                        grid-template-columns: repeat(2, 1fr);
                    }
                    
                    .greeting {
                        font-size: 16px;
                    }
                    
                    .content {
                        font-size: 14px;
                    }
                }
            </style>
        </head>
        <body>
            <div class="email-container">
                <div class="email-header">
                    <h1>Farmheart Virtual</h1>
                    <div class="subtitle">Your Virtual Breeding Companion</div>
                </div>
                
                <div class="email-body">
                    ${content}
                </div>
                
                <div class="email-footer">
                    <div class="footer-text">Happy breeding from the team at</div>
                    <div class="footer-logo">Farmheart Virtual</div>
                    <div style="margin-top: 16px; font-size: 12px; color: #9ca3af;">
                        <a href="https://farmheartvirtual.com" style="color: #10b981; text-decoration: none;">Visit Website</a> |
                        <a href="#" style="color: #10b981; text-decoration: none;">Manage Preferences</a> |
                        <a href="#" style="color: #10b981; text-decoration: none;">Support</a>
                    </div>
                </div>
            </div>
        </body>
        </html>
        `;
    }

    // Pet notification email
    async sendPetNotificationEmail(to, animalName, age, location, displayName) {
        const content = `
            <div class="greeting">Congratulations, ${displayName || 'Breeder'}! 🎉</div>
            
            <div class="content">
                <strong>${animalName}</strong> has completed its breeding journey and is now a beloved pet! 
                After <strong>${age} days</strong> of care and breeding, your animal has earned a well-deserved retirement.
            </div>

            <div class="card card-success">
                <div class="card-header">
                    <div class="card-icon card-icon-success">🎊</div>
                    <div class="card-title">Breeding Cycle Complete</div>
                </div>
                <div class="content" style="margin: 0;">
                    Your animal no longer requires feeding or daily care. You can now enjoy rides and companionship without any maintenance responsibilities!
                </div>
            </div>

            ${location ? `
            <div class="location-card">
                <div style="margin-bottom: 8px; font-size: 18px;">📍 Visit ${animalName} in Second Life</div>
                <a href="http://maps.secondlife.com/secondlife/${encodeURIComponent(location)}" class="location-link">
                    Teleport to ${location}
                </a>
            </div>
            ` : ''}

            <div class="content">
                Thank you for being an amazing breeder! Your dedication has helped ${animalName} live a full and happy virtual life.
            </div>
        `;

        const subject = `🎉 ${animalName} became a pet! - Farmheart Virtual`;
        const html = this.getBaseTemplate(subject, content);

        return await this.sendNotificationEmail(to, subject, html);
    }

    // Inoperable animal email
    async sendInoperableNotificationEmail(to, animalName, stats, location, displayName) {
        const content = `
            <div class="greeting">Urgent Alert, ${displayName || 'Breeder'}! 🚨</div>
            
            <div class="content">
                <strong>${animalName}</strong> has become inoperable due to neglect and requires immediate attention to restore functionality.
            </div>

            <div class="card card-critical">
                <div class="card-header">
                    <div class="card-icon card-icon-critical">⚠️</div>
                    <div class="card-title">Critical Status Alert</div>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-label">Hunger</div>
                        <div class="stat-value stat-critical">${stats.hungerPercent}%</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Happiness</div>
                        <div class="stat-value stat-critical">${stats.happinessPercent}%</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Heat</div>
                        <div class="stat-value">${stats.heatPercent}%</div>
                    </div>
                </div>
                
                <div class="content" style="margin: 12px 0 0 0;">
                    <strong>Action Required:</strong> Feed and care for your animal immediately to restore functionality. 
                    Remember, recovery may take up to one week of consistent care.
                </div>
            </div>

            ${location ? `
            <div class="location-card">
                <div style="margin-bottom: 8px; font-size: 18px;">📍 Care for ${animalName} Now</div>
                <a href="http://maps.secondlife.com/secondlife/${encodeURIComponent(location)}" class="location-link">
                    Teleport to ${location}
                </a>
            </div>
            ` : ''}

            <div class="content">
                Don't worry - your animal won't die, but it will need dedicated care to return to its normal activities including breeding and animations.
            </div>
        `;

        const subject = `🚨 URGENT: ${animalName} needs immediate care! - Farmheart Virtual`;
        const html = this.getBaseTemplate(subject, content);

        return await this.sendNotificationEmail(to, subject, html);
    }

    // Breeding ready email
    async sendBreedingReadyEmail(to, animalName, stats, location, displayName) {
        const content = `
            <div class="greeting">Great news, ${displayName || 'Breeder'}! 💕</div>
            
            <div class="content">
                <strong>${animalName}</strong> has reached optimal breeding conditions and is ready to create the next generation!
            </div>

            <div class="card card-success">
                <div class="card-header">
                    <div class="card-icon card-icon-success">💖</div>
                    <div class="card-title">Breeding Status: Ready</div>
                </div>
                
                <div class="stats-grid">
                    <div class="stat-item">
                        <div class="stat-label">Heat</div>
                        <div class="stat-value stat-success">${stats.heatPercent}% ✅</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Happiness</div>
                        <div class="stat-value stat-success">${stats.happinessPercent}% ✅</div>
                    </div>
                    <div class="stat-item">
                        <div class="stat-label">Satiation</div>
                        <div class="stat-value stat-success">${100 - stats.hungerPercent}% ✅</div>
                    </div>
                </div>
                
                <div class="content" style="margin: 12px 0 0 0;">
                    All breeding requirements have been met! Find a compatible mate in the Breeding Center 
                    to start creating offspring with unique genetic combinations.
                </div>
            </div>

            ${location ? `
            <div class="location-card">
                <div style="margin-bottom: 8px; font-size: 18px;">📍 Visit ${animalName} for Breeding</div>
                <a href="http://maps.secondlife.com/secondlife/${encodeURIComponent(location)}" class="location-link">
                    Teleport to ${location}
                </a>
            </div>
            ` : ''}

            <div class="content">
                Visit the Breeding Center to find compatible partners and start the breeding process. 
                Remember, higher compatibility increases chances of rare offspring!
            </div>
        `;

        const subject = `💕 ${animalName} is ready to breed! - Farmheart Virtual`;
        const html = this.getBaseTemplate(subject, content);

        return await this.sendNotificationEmail(to, subject, html);
    }

    // Welcome email
    async sendWelcomeEmail(to, displayName) {
        const content = `
            <div class="greeting">Welcome to Farmheart Virtual, ${displayName || 'Breeder'}! 🌟</div>
            
            <div class="content">
                We're thrilled to have you join our community of virtual animal breeders! 
                Get ready to experience the most advanced breeding system in Second Life.
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon" style="background-color: #3b82f6; color: white;">🔔</div>
                    <div class="card-title">Email Notifications</div>
                </div>
                <div class="content" style="margin: 0;">
                    Stay informed about your animals with smart email notifications:
                    <ul style="margin: 12px 0 0 20px; padding: 0;">
                        <li style="margin-bottom: 8px;">🎉 <strong>Pet Celebrations:</strong> When animals complete their breeding cycle</li>
                        <li style="margin-bottom: 8px;">🚨 <strong>Critical Alerts:</strong> When animals become inoperable</li>
                        <li style="margin-bottom: 8px;">💕 <strong>Breeding Ready:</strong> When animals reach optimal breeding conditions</li>
                    </ul>
                    
                    <div style="margin-top: 16px; padding: 12px; background-color: #f0f9ff; border-radius: 8px; border: 1px solid #bae6fd;">
                        <small style="color: #0369a1;">
                            💡 <strong>Tip:</strong> Manage your notification preferences in your account settings anytime!
                        </small>
                    </div>
                </div>
            </div>

            <div style="text-align: center; margin: 24px 0;">
                <a href="https://farmheartvirtual.com" class="cta-button">
                    🏠 Visit Dashboard
                </a>
            </div>

            <div class="content">
                Ready to start your breeding journey? Check out our comprehensive guides and join thousands of breeders 
                creating amazing virtual animals in Second Life!
            </div>
        `;

        const subject = '🐎 Welcome to Farmheart Virtual - Your Breeding Adventure Begins!';
        const html = this.getBaseTemplate(subject, content);

        return await this.sendNotificationEmail(to, subject, html);
    }

    // Test email with modern design
    async sendTestEmail(to, testData = {}) {
        const content = `
            <div class="greeting">Test Email Successfully Delivered! 🧪</div>
            
            <div class="content">
                Congratulations! This test email confirms that your Farmheart Virtual notification system is working perfectly.
            </div>

            <div class="card">
                <div class="card-header">
                    <div class="card-icon" style="background-color: #8b5cf6; color: white;">⚙️</div>
                    <div class="card-title">System Information</div>
                </div>
                <div class="content" style="margin: 0;">
                    <div class="stats-grid">
                        <div class="stat-item">
                            <div class="stat-label">Timestamp</div>
                            <div class="stat-value" style="font-size: 14px;">${new Date().toLocaleString()}</div>
                        </div>
                        <div class="stat-item">
                            <div class="stat-label">Status</div>
                            <div class="stat-value stat-success">Active</div>
                        </div>
                    </div>
                    
                    ${Object.keys(testData).length > 0 ? `
                    <div style="margin-top: 16px;">
                        <strong>Test Data:</strong>
                        <pre style="background: #f3f4f6; padding: 12px; border-radius: 6px; font-size: 12px; overflow-x: auto; margin-top: 8px;">${JSON.stringify(testData, null, 2)}</pre>
                    </div>
                    ` : ''}
                </div>
            </div>

            <div class="content">
                Your email notification system is now ready to keep you informed about all your virtual animals' activities and milestones!
            </div>
        `;

        const subject = '🧪 Farmheart Virtual - Email Test Successful!';
        const html = this.getBaseTemplate(subject, content);

        return await this.sendNotificationEmail(to, subject, html);
    }

    // Core send method (unchanged)
    async sendNotificationEmail(to, subject, html) {
        try {
            if (!to || !subject || !html) {
                throw new Error('Missing required email parameters');
            }

            const messageData = {
                from: `Farmheart Virtual <${this.fromEmail}>`,
                to: [to],
                subject: subject,
                html: html,
                text: this.stripHtml(html)
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
                messageId: result.id || result.message
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

    // Simple test that matches your working example exactly
    async sendSimpleMessage(to = "farmheartrep@gmail.com") {
        try {
            const data = await this.mg.messages.create("sandbox30399df431914ebb858787ceb5415064.mailgun.org", {
                from: "Farmheart Virtual <postmaster@sandbox30399df431914ebb858787ceb5415064.mailgun.org>",
                to: [`Sally Higgins <${to}>`],
                subject: "Hello from Farmheart Virtual",
                text: "Congratulations Sally Higgins, you just sent an email with Mailgun from Farmheart Virtual! You are truly awesome!",
            });

            console.log('Simple message sent:', data);
            return data;
        } catch (error) {
            console.error('Error sending simple message:', error);
            throw error;
        }
    }

    // Debug method to test configuration
    async testConfiguration() {
        try {
            console.log('Testing Mailgun configuration...');
            console.log('API Key:', process.env.MAILGUN_API_KEY ? 'Set' : 'Missing');
            console.log('Domain:', this.domain);
            console.log('From Email:', this.fromEmail);

            const result = await this.sendSimpleMessage();
            console.log('Configuration test successful!');
            return result;
        } catch (error) {
            console.error('Configuration test failed:', error);
            throw error;
        }
    }
}

module.exports = new EmailService();