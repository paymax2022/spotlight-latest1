/**
 * Multi-channel notification and communication engine
 * Delivers alerts to Slack, email, PagerDuty, and webhooks
 */

/**
 * Notification channel types
 */
export type NotificationChannel = 'email' | 'slack' | 'pagerduty' | 'webhook' | 'sms';

/**
 * Notification priority
 */
export type NotificationPriority = 'low' | 'medium' | 'high' | 'critical';

/**
 * Notification status
 */
export type NotificationStatus = 'pending' | 'sent' | 'delivered' | 'failed' | 'read';

/**
 * Notification template
 */
export interface NotificationTemplate {
  id: string;
  name: string;
  description: string;
  category: 'incident' | 'prediction' | 'escalation' | 'resolution' | 'report';
  channels: NotificationChannel[];
  subject?: string;
  body: string;
  variables: string[];
  priority: NotificationPriority;
  throttleMinutes?: number;
}

/**
 * Notification instance
 */
export interface Notification {
  id: string;
  templateId: string;
  templateName: string;
  category: string;
  priority: NotificationPriority;
  recipient: string;
  channel: NotificationChannel;
  subject?: string;
  body: string;
  status: NotificationStatus;
  createdAt: number;
  sentAt?: number;
  deliveredAt?: number;
  readAt?: number;
  failureReason?: string;
  retryCount: number;
  maxRetries: number;
}

/**
 * Notification preference
 */
export interface NotificationPreference {
  userId: string;
  category: string;
  channels: {
    email: boolean;
    slack: boolean;
    pagerduty: boolean;
    webhook: boolean;
    sms: boolean;
  };
  quiet_hours?: {
    enabled: boolean;
    start: string; // HH:mm
    end: string;   // HH:mm
  };
  digest_frequency: 'immediate' | 'hourly' | 'daily' | 'weekly';
  escalation_enabled: boolean;
}

/**
 * Notification channel configuration
 */
export interface ChannelConfig {
  email?: {
    enabled: boolean;
    provider: 'resend' | 'sendgrid';
    apiKey?: string;
  };
  slack?: {
    enabled: boolean;
    webhookUrl?: string;
    botToken?: string;
    defaultChannel?: string;
  };
  pagerduty?: {
    enabled: boolean;
    apiKey?: string;
    serviceId?: string;
  };
  webhook?: {
    enabled: boolean;
    url?: string;
    headers?: Record<string, string>;
  };
  sms?: {
    enabled: boolean;
    provider: 'twilio' | 'sns';
    apiKey?: string;
  };
}

/**
 * Multi-channel notification engine
 */
export class NotificationEngine {
  private templates: Map<string, NotificationTemplate> = new Map();
  private notifications: Map<string, Notification> = new Map();
  private preferences: Map<string, NotificationPreference> = new Map();
  private channelConfig: ChannelConfig;
  private throttleMap: Map<string, number> = new Map();

  constructor(config: ChannelConfig) {
    this.channelConfig = config;
    this.initializeDefaultTemplates();
  }

  /**
   * Initialize default templates
   */
  private initializeDefaultTemplates(): void {
    // Incident templates
    this.templates.set('incident-critical', {
      id: 'incident-critical',
      name: 'Critical Incident Alert',
      description: 'Alert for critical compliance incidents',
      category: 'incident',
      channels: ['email', 'slack', 'pagerduty'],
      subject: '🚨 CRITICAL: {{incident_title}}',
      body: `Critical compliance incident detected:

Title: {{incident_title}}
Category: {{incident_category}}
Severity: CRITICAL
Description: {{incident_description}}

Immediate action required.
Action: {{action_url}}`,
      variables: ['incident_title', 'incident_category', 'incident_description', 'action_url'],
      priority: 'critical',
      throttleMinutes: 0, // No throttling for critical
    });

    // Prediction templates
    this.templates.set('prediction-alert', {
      id: 'prediction-alert',
      name: 'Compliance Risk Alert',
      description: 'Alert for predicted compliance issues',
      category: 'prediction',
      channels: ['email', 'slack'],
      subject: '⚠️ Predicted Risk: {{metric}} at {{risk_level}}',
      body: `Compliance risk prediction:

Metric: {{metric}}
Current Score: {{current_score}}%
Predicted Score: {{predicted_score}}% (in 30 days)
Risk Level: {{risk_level}}
Confidence: {{confidence}}%

Recommended Actions:
{{recommendations}}

Review: {{dashboard_url}}`,
      variables: ['metric', 'risk_level', 'current_score', 'predicted_score', 'confidence', 'recommendations', 'dashboard_url'],
      priority: 'high',
      throttleMinutes: 60,
    });

    // Escalation templates
    this.templates.set('escalation-notice', {
      id: 'escalation-notice',
      name: 'Incident Escalation Notice',
      description: 'Alert for escalated incidents',
      category: 'escalation',
      channels: ['email', 'slack', 'pagerduty'],
      subject: '📈 ESCALATION: {{incident_title}}',
      body: `Incident escalation:

Incident: {{incident_title}}
Status: {{incident_status}}
Escalation Level: {{escalation_level}}
Escalation Reason: {{reason}}

Assigned To: {{assigned_to}}
Time Limit: {{time_limit}} minutes

Action: {{action_url}}`,
      variables: ['incident_title', 'incident_status', 'escalation_level', 'reason', 'assigned_to', 'time_limit', 'action_url'],
      priority: 'critical',
      throttleMinutes: 0,
    });

    // Resolution templates
    this.templates.set('resolution-confirmed', {
      id: 'resolution-confirmed',
      name: 'Resolution Confirmed',
      description: 'Notification when issue is resolved',
      category: 'resolution',
      channels: ['email', 'slack'],
      subject: '✅ Resolved: {{incident_title}}',
      body: `Compliance issue resolved:

Incident: {{incident_title}}
Category: {{incident_category}}
Resolution Method: {{resolution_method}}
Resolved At: {{resolved_at}}
Resolution Time: {{resolution_time}}

Summary: {{resolution_summary}}`,
      variables: ['incident_title', 'incident_category', 'resolution_method', 'resolved_at', 'resolution_time', 'resolution_summary'],
      priority: 'low',
      throttleMinutes: 0,
    });

    // Report templates
    this.templates.set('report-ready', {
      id: 'report-ready',
      name: 'Report Generated',
      description: 'Notification when compliance report is ready',
      category: 'report',
      channels: ['email'],
      subject: '📊 {{report_type}} Report Ready',
      body: `Your compliance report is ready:

Report Type: {{report_type}}
Generated: {{generated_at}}
Period: {{period}}
Compliance Score: {{compliance_score}}%

Download: {{download_url}}`,
      variables: ['report_type', 'generated_at', 'period', 'compliance_score', 'download_url'],
      priority: 'low',
      throttleMinutes: 0,
    });
  }

  /**
   * Get template
   */
  getTemplate(templateId: string): NotificationTemplate | null {
    return this.templates.get(templateId) || null;
  }

  /**
   * Create and send notification
   */
  async sendNotification(
    templateId: string,
    recipient: string,
    variables: Record<string, string>,
    channels?: NotificationChannel[]
  ): Promise<Notification[]> {
    const template = this.templates.get(templateId);
    if (!template) {
      throw new Error(`Template not found: ${templateId}`);
    }

    // Check throttle
    const throttleKey = `${recipient}:${templateId}`;
    if (this.isThrottled(throttleKey, template.throttleMinutes || 0)) {
      console.log(`Notification throttled: ${throttleKey}`);
      return [];
    }

    // Use specified channels or template defaults
    const targetChannels = channels || template.channels;

    // Interpolate variables
    const body = this.interpolateTemplate(template.body, variables);
    const subject = template.subject ? this.interpolateTemplate(template.subject, variables) : undefined;

    // Create notifications for each channel
    const notifications: Notification[] = [];

    for (const channel of targetChannels) {
      const notification: Notification = {
        id: `notif-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
        templateId,
        templateName: template.name,
        category: template.category,
        priority: template.priority,
        recipient,
        channel,
        subject,
        body,
        status: 'pending',
        createdAt: Date.now(),
        retryCount: 0,
        maxRetries: 3,
      };

      this.notifications.set(notification.id, notification);
      notifications.push(notification);

      // Send asynchronously
      this.deliverNotification(notification);
    }

    // Update throttle
    if (template.throttleMinutes && template.throttleMinutes > 0) {
      this.throttleMap.set(throttleKey, Date.now());
    }

    return notifications;
  }

  /**
   * Deliver notification to channel
   */
  private async deliverNotification(notification: Notification): Promise<void> {
    try {
      switch (notification.channel) {
        case 'email':
          await this.sendEmail(notification);
          break;
        case 'slack':
          await this.sendSlack(notification);
          break;
        case 'pagerduty':
          await this.sendPagerDuty(notification);
          break;
        case 'webhook':
          await this.sendWebhook(notification);
          break;
        case 'sms':
          await this.sendSMS(notification);
          break;
      }

      notification.status = 'sent';
      notification.sentAt = Date.now();
    } catch (err) {
      notification.status = 'failed';
      notification.failureReason = err instanceof Error ? err.message : 'Unknown error';
      notification.retryCount++;

      if (notification.retryCount < notification.maxRetries) {
        // Retry after exponential backoff
        const delay = Math.pow(2, notification.retryCount) * 1000;
        setTimeout(() => this.deliverNotification(notification), delay);
      }
    }
  }

  /**
   * Send email notification
   */
  private async sendEmail(notification: Notification): Promise<void> {
    if (!this.channelConfig.email?.enabled) {
      throw new Error('Email channel not enabled');
    }

    // In production, this would call Resend or SendGrid API
    console.log(`Sending email to ${notification.recipient}:`, notification.subject);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 100));

    notification.status = 'delivered';
    notification.deliveredAt = Date.now();
  }

  /**
   * Send Slack notification
   */
  private async sendSlack(notification: Notification): Promise<void> {
    if (!this.channelConfig.slack?.enabled) {
      throw new Error('Slack channel not enabled');
    }

    // In production, this would call Slack Webhook or Bolt API
    console.log(`Sending Slack to ${notification.recipient}:`, notification.body);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 100));

    notification.status = 'delivered';
    notification.deliveredAt = Date.now();
  }

  /**
   * Send PagerDuty notification
   */
  private async sendPagerDuty(notification: Notification): Promise<void> {
    if (!this.channelConfig.pagerduty?.enabled) {
      throw new Error('PagerDuty channel not enabled');
    }

    // In production, this would call PagerDuty Events API
    console.log(`Sending PagerDuty to ${notification.recipient}:`, notification.subject);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 100));

    notification.status = 'delivered';
    notification.deliveredAt = Date.now();
  }

  /**
   * Send webhook notification
   */
  private async sendWebhook(notification: Notification): Promise<void> {
    if (!this.channelConfig.webhook?.enabled || !this.channelConfig.webhook.url) {
      throw new Error('Webhook not configured');
    }

    // In production, this would make HTTP POST to webhook URL
    console.log(`Sending webhook to ${this.channelConfig.webhook.url}:`, notification);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 100));

    notification.status = 'delivered';
    notification.deliveredAt = Date.now();
  }

  /**
   * Send SMS notification
   */
  private async sendSMS(notification: Notification): Promise<void> {
    if (!this.channelConfig.sms?.enabled) {
      throw new Error('SMS channel not enabled');
    }

    // In production, this would call Twilio or AWS SNS
    console.log(`Sending SMS to ${notification.recipient}:`, notification.body);

    // Simulate API call
    await new Promise((resolve) => setTimeout(resolve, 100));

    notification.status = 'delivered';
    notification.deliveredAt = Date.now();
  }

  /**
   * Interpolate template variables
   */
  private interpolateTemplate(template: string, variables: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(variables)) {
      result = result.replace(new RegExp(`{{${key}}}`, 'g'), value);
    }
    return result;
  }

  /**
   * Check if notification is throttled
   */
  private isThrottled(key: string, throttleMinutes: number): boolean {
    if (throttleMinutes === 0) return false;

    const lastSent = this.throttleMap.get(key);
    if (!lastSent) return false;

    const elapsed = (Date.now() - lastSent) / 1000 / 60;
    return elapsed < throttleMinutes;
  }

  /**
   * Get notification
   */
  getNotification(notificationId: string): Notification | null {
    return this.notifications.get(notificationId) || null;
  }

  /**
   * List notifications
   */
  listNotifications(filter?: { recipient?: string; status?: string; category?: string }): Notification[] {
    let notifications = Array.from(this.notifications.values());

    if (filter?.recipient) {
      notifications = notifications.filter((n) => n.recipient === filter.recipient);
    }
    if (filter?.status) {
      notifications = notifications.filter((n) => n.status === filter.status);
    }
    if (filter?.category) {
      notifications = notifications.filter((n) => n.category === filter.category);
    }

    return notifications.sort((a, b) => b.createdAt - a.createdAt);
  }

  /**
   * Mark notification as read
   */
  markAsRead(notificationId: string): void {
    const notification = this.notifications.get(notificationId);
    if (notification) {
      notification.status = 'read';
      notification.readAt = Date.now();
    }
  }

  /**
   * Get user preferences
   */
  getPreferences(userId: string): NotificationPreference | null {
    return this.preferences.get(userId) || null;
  }

  /**
   * Update user preferences
   */
  updatePreferences(userId: string, preferences: Partial<NotificationPreference>): void {
    const current = this.preferences.get(userId) || {
      userId,
      category: 'all',
      channels: {
        email: true,
        slack: true,
        pagerduty: true,
        webhook: false,
        sms: false,
      },
      digest_frequency: 'immediate',
      escalation_enabled: true,
    };

    this.preferences.set(userId, { ...current, ...preferences });
  }

  /**
   * Get statistics
   */
  getStatistics(): {
    total: number;
    sent: number;
    delivered: number;
    failed: number;
    read: number;
    byChannel: Record<NotificationChannel, number>;
    byPriority: Record<NotificationPriority, number>;
  } {
    const notifications = Array.from(this.notifications.values());

    return {
      total: notifications.length,
      sent: notifications.filter((n) => n.status === 'sent' || n.status === 'delivered' || n.status === 'read').length,
      delivered: notifications.filter((n) => n.status === 'delivered' || n.status === 'read').length,
      failed: notifications.filter((n) => n.status === 'failed').length,
      read: notifications.filter((n) => n.status === 'read').length,
      byChannel: {
        email: notifications.filter((n) => n.channel === 'email').length,
        slack: notifications.filter((n) => n.channel === 'slack').length,
        pagerduty: notifications.filter((n) => n.channel === 'pagerduty').length,
        webhook: notifications.filter((n) => n.channel === 'webhook').length,
        sms: notifications.filter((n) => n.channel === 'sms').length,
      },
      byPriority: {
        low: notifications.filter((n) => n.priority === 'low').length,
        medium: notifications.filter((n) => n.priority === 'medium').length,
        high: notifications.filter((n) => n.priority === 'high').length,
        critical: notifications.filter((n) => n.priority === 'critical').length,
      },
    };
  }
}

/**
 * Create singleton instance
 */
let engineInstance: NotificationEngine | null = null;

export function getNotificationEngine(config?: Partial<ChannelConfig>): NotificationEngine {
  if (!engineInstance) {
    engineInstance = new NotificationEngine(config || {});
  }
  return engineInstance;
}
