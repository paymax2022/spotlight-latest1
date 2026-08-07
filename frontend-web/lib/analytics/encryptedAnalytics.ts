/**
 * Privacy-preserving analytics with encrypted event logging
 * GDPR-compliant data collection and storage
 */

import { encryptData, hashData, generateToken } from '@/lib/utils/encryption';

/**
 * Analytics event types
 */
export type EventType =
  | 'exam_started'
  | 'exam_progress'
  | 'exam_submitted'
  | 'exam_paused'
  | 'question_answered'
  | 'question_flagged'
  | 'offline_mode_enabled'
  | 'biometric_auth_attempt'
  | 'gesture_used'
  | 'image_zoomed'
  | 'network_changed'
  | 'session_timeout'
  | 'error_occurred';

/**
 * Anonymization strategies
 */
export enum AnonymizationLevel {
  FULLY_IDENTIFIED = 'fully_identified', // All data + user ID (requires explicit consent)
  PSEUDONYMIZED = 'pseudonymized', // Hashed ID + event data (GDPR-safe)
  ANONYMIZED = 'anonymized', // No ID, aggregated only (can't identify user)
  NOT_COLLECTED = 'not_collected', // Event type excluded
}

/**
 * Analytics event (before encryption/hashing)
 */
export interface AnalyticsEvent {
  eventType: EventType;
  userId?: string;
  attemptId?: string;
  templateId?: string;
  timestamp: number;
  sessionId: string;
  deviceInfo?: {
    userAgent: string;
    screenSize: string;
    networkType: string;
  };
  eventData: Record<string, any>;
  consentLevel: 'analytics' | 'marketing' | 'necessary' | 'none';
}

/**
 * Encrypted event storage format
 */
export interface EncryptedAnalyticsEvent {
  id: string;
  encryptedData: string;
  eventTypeHash: string;
  userIdHash?: string;
  timestamp: number;
  consentLevel: string;
  sessionId: string;
}

/**
 * Consent preferences (GDPR)
 */
export interface ConsentPreferences {
  necessary: boolean; // Always true (required for functionality)
  analytics: boolean; // Usage analytics, performance monitoring
  marketing: boolean; // Personalization, recommendations
  preferences: boolean; // Remember settings
  allConsents: Record<string, boolean>;
  timestamp: number;
  version: string; // Consent policy version
  expiresAt?: number; // Re-consent required after
}

/**
 * Default GDPR-compliant event configuration
 */
const EVENT_ANONYMIZATION_MAP: Record<EventType, AnonymizationLevel> = {
  exam_started: AnonymizationLevel.PSEUDONYMIZED, // Need to track user progress
  exam_progress: AnonymizationLevel.PSEUDONYMIZED,
  exam_submitted: AnonymizationLevel.PSEUDONYMIZED,
  exam_paused: AnonymizationLevel.PSEUDONYMIZED,
  question_answered: AnonymizationLevel.ANONYMIZED, // Aggregate only, no user tracking
  question_flagged: AnonymizationLevel.ANONYMIZED,
  offline_mode_enabled: AnonymizationLevel.PSEUDONYMIZED, // Helpful for product
  biometric_auth_attempt: AnonymizationLevel.PSEUDONYMIZED,
  gesture_used: AnonymizationLevel.ANONYMIZED, // No user link needed
  image_zoomed: AnonymizationLevel.ANONYMIZED,
  network_changed: AnonymizationLevel.ANONYMIZED,
  session_timeout: AnonymizationLevel.PSEUDONYMIZED,
  error_occurred: AnonymizationLevel.PSEUDONYMIZED, // Need user context for debugging
};

/**
 * Events that require explicit marketing consent
 */
const MARKETING_EVENTS = new Set<EventType>([
  // None - exam events are not marketing related
]);

/**
 * Sensitive fields that should never be collected
 */
const SENSITIVE_FIELD_PATTERNS = [
  /password/i,
  /token/i,
  /secret/i,
  /api.?key/i,
  /auth/i,
  /ssn/i,
  /credit.?card/i,
  /cvv/i,
  /pin/i,
  /personal/i,
  /health/i,
  /medical/i,
];

/**
 * Sanitize event data - remove sensitive information
 */
function sanitizeEventData(data: Record<string, any>): Record<string, any> {
  const sanitized: Record<string, any> = {};

  for (const [key, value] of Object.entries(data)) {
    // Check if key matches sensitive patterns
    const isSensitive = SENSITIVE_FIELD_PATTERNS.some((pattern) =>
      pattern.test(key)
    );

    if (isSensitive) {
      sanitized[key] = '[REDACTED]';
    } else if (typeof value === 'object' && value !== null) {
      // Recursively sanitize nested objects
      sanitized[key] = sanitizeEventData(value);
    } else if (typeof value === 'string' && value.length > 1000) {
      // Truncate very long strings (could contain PII)
      sanitized[key] = value.substring(0, 100) + '...';
    } else {
      sanitized[key] = value;
    }
  }

  return sanitized;
}

/**
 * Main analytics service with encryption and GDPR compliance
 */
export class EncryptedAnalyticsService {
  private sessionId: string;
  private userId?: string;
  private consentPreferences: ConsentPreferences;
  private eventQueue: AnalyticsEvent[] = [];
  private encryptionPassword: string;

  constructor(userId?: string) {
    this.userId = userId;
    this.sessionId = generateToken(16);
    this.encryptionPassword = `analytics-${this.sessionId}`;
    this.consentPreferences = this.loadConsent();
  }

  /**
   * Load consent from localStorage
   */
  private loadConsent(): ConsentPreferences {
    if (typeof localStorage === 'undefined') {
      return {
        necessary: true,
        analytics: false,
        marketing: false,
        preferences: false,
        allConsents: {},
        timestamp: Date.now(),
        version: '1.0',
      };
    }

    const stored = localStorage.getItem('gdpr-consent');
    if (stored) {
      return JSON.parse(stored);
    }

    return {
      necessary: true,
      analytics: false,
      marketing: false,
      preferences: false,
      allConsents: {},
      timestamp: Date.now(),
      version: '1.0',
    };
  }

  /**
   * Save consent preferences
   */
  setConsent(preferences: Partial<ConsentPreferences>): void {
    this.consentPreferences = {
      ...this.consentPreferences,
      ...preferences,
      timestamp: Date.now(),
    };

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('gdpr-consent', JSON.stringify(this.consentPreferences));
    }
  }

  /**
   * Check if event should be collected
   */
  private shouldCollectEvent(event: AnalyticsEvent): boolean {
    // Never collect if no consent
    if (!this.consentPreferences.necessary) {
      return false;
    }

    // Check marketing consent for marketing events
    if (
      MARKETING_EVENTS.has(event.eventType) &&
      !this.consentPreferences.marketing
    ) {
      return false;
    }

    // Check analytics consent
    if (
      !this.consentPreferences.analytics &&
      event.consentLevel !== 'necessary'
    ) {
      return false;
    }

    return true;
  }

  /**
   * Apply anonymization based on consent and event type
   */
  private anonymizeEvent(event: AnalyticsEvent): Partial<AnalyticsEvent> {
    const level = EVENT_ANONYMIZATION_MAP[event.eventType];

    switch (level) {
      case AnonymizationLevel.FULLY_IDENTIFIED:
        // Only if user explicitly consents
        if (!this.consentPreferences.analytics) {
          return this.anonymizeEvent({ ...event, userId: undefined });
        }
        return event;

      case AnonymizationLevel.PSEUDONYMIZED:
        // Hash user ID, keep event data
        return {
          ...event,
          userId: this.userId
            ? generateToken(8) // Pseudo-random per session
            : undefined,
        };

      case AnonymizationLevel.ANONYMIZED:
        // Remove user ID entirely, aggregate only
        return {
          ...event,
          userId: undefined,
          attemptId: undefined,
        };

      case AnonymizationLevel.NOT_COLLECTED:
        return {};

      default:
        return event;
    }
  }

  /**
   * Track an event
   */
  async trackEvent(
    eventType: EventType,
    eventData: Record<string, any> = {},
    options?: {
      userId?: string;
      attemptId?: string;
      templateId?: string;
    }
  ): Promise<void> {
    // Sanitize event data first
    const sanitized = sanitizeEventData(eventData);

    const event: AnalyticsEvent = {
      eventType,
      userId: options?.userId || this.userId,
      attemptId: options?.attemptId,
      templateId: options?.templateId,
      timestamp: Date.now(),
      sessionId: this.sessionId,
      eventData: sanitized,
      consentLevel: 'analytics',
      deviceInfo: {
        userAgent: navigator.userAgent.substring(0, 100),
        screenSize: `${window.innerWidth}x${window.innerHeight}`,
        networkType: (navigator as any).connection?.effectiveType || 'unknown',
      },
    };

    // Check consent before collecting
    if (!this.shouldCollectEvent(event)) {
      console.debug(`Event ${eventType} skipped (no consent)`);
      return;
    }

    // Anonymize based on preferences
    const anonymized = this.anonymizeEvent(event);

    // Queue for batch send
    this.eventQueue.push(anonymized as AnalyticsEvent);

    // Auto-flush if queue is large
    if (this.eventQueue.length >= 50) {
      await this.flush();
    }
  }

  /**
   * Encrypt and send queued events
   */
  async flush(): Promise<void> {
    if (this.eventQueue.length === 0) return;

    const eventsToSend = [...this.eventQueue];
    this.eventQueue = []; // Clear queue immediately

    try {
      const encryptedEvents: EncryptedAnalyticsEvent[] = [];

      for (const event of eventsToSend) {
        const encrypted = await encryptData(event, this.encryptionPassword);
        const eventTypeHash = await hashData(event.eventType);
        const userIdHash = event.userId
          ? await hashData(event.userId)
          : undefined;

        encryptedEvents.push({
          id: generateToken(16),
          encryptedData: encrypted,
          eventTypeHash,
          userIdHash,
          timestamp: event.timestamp,
          consentLevel: event.consentLevel,
          sessionId: event.sessionId,
        });
      }

      // Send to server
      const response = await fetch('/api/analytics/events', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': this.sessionId,
        },
        body: JSON.stringify({
          events: encryptedEvents,
          consentPreferences: this.consentPreferences,
        }),
      });

      if (!response.ok) {
        // Re-queue failed events
        this.eventQueue.push(...eventsToSend);
        console.error('Failed to flush analytics events');
      }
    } catch (error) {
      // Re-queue on error
      this.eventQueue.push(...eventsToSend);
      console.error('Analytics flush error:', error);
    }
  }

  /**
   * Get current consent status
   */
  getConsent(): ConsentPreferences {
    return { ...this.consentPreferences };
  }

  /**
   * Request explicit consent (GDPR)
   */
  requestConsent(): void {
    // Dispatch event for consent UI
    window.dispatchEvent(new CustomEvent('gdpr-consent-required'));
  }

  /**
   * Revoke all non-essential consents
   */
  revokeAllConsent(): void {
    this.setConsent({
      analytics: false,
      marketing: false,
      preferences: false,
    });
    this.eventQueue = []; // Clear pending events
  }

  /**
   * Get analytics event count (for debugging)
   */
  getQueueLength(): number {
    return this.eventQueue.length;
  }

  /**
   * Get session ID (for server-side matching)
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

// Singleton instance
let analyticsInstance: EncryptedAnalyticsService | null = null;

export function getAnalyticsService(userId?: string): EncryptedAnalyticsService {
  if (!analyticsInstance) {
    analyticsInstance = new EncryptedAnalyticsService(userId);
  }
  return analyticsInstance;
}
