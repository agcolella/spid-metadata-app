/**
 * Service per gestire notifiche (email, webhook, ecc.)
 * Implementazione base - estendibile con provider reali
 */
export class NotificationService {
  constructor(config = {}) {
    this.config = config;
    this.webhookUrl = config.webhookUrl;
    this.emailEnabled = config.emailEnabled || false;
  }

  /**
   * Notifica creazione PR
   */
  async notifyPRCreated(prData) {
    const message = this.formatPRCreatedMessage(prData);
    
    const notifications = [];
    
    if (this.webhookUrl) {
      notifications.push(this.sendWebhook(message));
    }

    if (this.emailEnabled) {
      notifications.push(this.sendEmail(message));
    }

    if (notifications.length > 0) {
      await Promise.allSettled(notifications);
    }
  }

  /**
   * Notifica merge PR
   */
  async notifyPRMerged(prData) {
    const message = this.formatPRMergedMessage(prData);
    
    if (this.webhookUrl) {
      await this.sendWebhook(message);
    }
  }

  /**
   * Formatta messaggio per PR creata
   */
  formatPRCreatedMessage(prData) {
    return {
      title: '✅ Nuova Pull Request SPID creata',
      text: `PR #${prData.number} creata con successo!\n\n` +
            `📁 File: ${prData.filesUploaded}\n` +
            `🏢 Organizzazioni: ${prData.organizationsCount}\n` +
            `🔗 URL: ${prData.url}\n\n` +
            `Organizzazioni coinvolte:\n${prData.organizations.map(o => `• ${o}`).join('\n')}`,
      url: prData.url,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Formatta messaggio per PR merged
   */
  formatPRMergedMessage(prData) {
    return {
      title: '🎉 Pull Request SPID mergiata',
      text: `PR #${prData.prNumber} è stata mergiata da ${prData.mergedBy}!\n\n` +
            `🔗 URL: ${prData.url}`,
      url: prData.url,
      timestamp: new Date().toISOString()
    };
  }

  /**
   * Invia notifica via webhook (es. Slack, Discord, MS Teams)
   */
  async sendWebhook(message) {
    if (!this.webhookUrl) return;

    try {
      // Formato generico - adattare al provider specifico
      const payload = {
        text: message.title,
        blocks: [
          {
            type: 'section',
            text: {
              type: 'mrkdwn',
              text: message.text
            }
          },
          {
            type: 'actions',
            elements: [
              {
                type: 'button',
                text: {
                  type: 'plain_text',
                  text: 'Apri PR'
                },
                url: message.url
              }
            ]
          }
        ]
      };

      const response = await fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        console.error('Errore invio webhook:', response.statusText);
      }
    } catch (error) {
      console.error('Errore invio webhook:', error);
    }
  }

  /**
   * Invia notifica via email
   * Placeholder - implementare con servizio SMTP o provider (SendGrid, etc.)
   */
  async sendEmail(message) {
    if (!this.emailEnabled) return;

    console.log('📧 Email notification (non implementato):', message.title);
    // TODO: Implementare con nodemailer o servizio email
  }

  /**
   * Log notifica in console (per debug)
   */
  log(message) {
    console.log('📢 Notification:', JSON.stringify(message, null, 2));
  }
}
