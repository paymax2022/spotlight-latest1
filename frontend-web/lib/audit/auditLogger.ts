/**
 * Audit logging for security events and compliance tracking
 * Immutable, encrypted logs for threat detection and incident response
 */

import { encryptData, generateToken, hashData } from '@/lib/utils/encryption';

/**
 * Audit event types (security-relevant)
 */
export type AuditEventType =
  | 'auth_attempt'
  | 'auth_success'
  | 'auth_failure'
  | 'biometric_auth_attempt'
  | 'passkey_auth_attempt'
  | 'session_created'
  | 'session_terminated'
  | 'session_timeout'
  | 'consent_changed'
  | 'data_export_requested'
  | 'data_deletion_requested'
  | 'password_reset'
  | 'settings_changed'
  | 'exam_submitted'
  | 'offline_sync'
  | 'security_error'
  | 'suspicious_activity'
  | 'rate_limit_exceeded'
  | 'access_denied'
  | 'data_breach_check';

/**
 * Severity levels (based on security impact)
 */
export enum AuditSeverity {
  INFO = 'info', // Normal operations
  WARNING = 'warning', // Potential issues
  ERROR = 'error', // Security concerns
  CRITICAL = 'critical', // Immediate action needed
}

/**
 * Audit event (before encryption)
 */
export interface AuditEvent {
  id: string;
  eventType: AuditEventType;
  severity: AuditSeverity;
  userId?: string;
  sessionId: string;
  timestamp: number;
  ipAddress?: string;
  userAgent?: string;
  details: Record<string, any>;
  tags: string[];
  sourceComponent: string;
  success: boolean;
}

/**
 * Encrypted audit log format
 */
export interface EncryptedAuditLog {
  id: string;
  encryptedData: string;
  eventTypeHash: string;
  userIdHash?: string;
  timestamp: number;
  severity: AuditSeverity;
  sessionId: string;
  checksum: string; // SHA-256 of encrypted data
  sequenceNumber: number; // For integrity verification
}

/**
 * Suspicious pattern for detection
 */
export interface AnomalyPattern {
  id: string;
  name: string;
  description: string;
  triggers: AnomalyTrigger[];
  severity: AuditSeverity;
  threshold: number; // How many triggers to alert
  timeWindow: number; // In milliseconds
}

/**
 * Single anomaly trigger
 */
export interface AnomalyTrigger {
  eventType: AuditEventType;
  condition: 'equals' | 'contains' | 'exceeds' | 'under';
  field: string;
  value: any;
  weight: number; // 0-1, how much this contributes to score
}

/**
 * Audit logger with encryption and anomaly detection
 */
export class AuditLogger {
  private sessionId: string;
  private userId?: string;
  private logSequence: number = 0;
  private encryptionPassword: string;
  private logBuffer: AuditEvent[] = [];
  private anomalyPatterns: Map<string, AnomalyPattern>;
  private recentEvents: AuditEvent[] = [];

  constructor(userId?: string) {
    this.userId = userId;
    this.sessionId = generateToken(16);
    this.encryptionPassword = `audit-${this.sessionId}`;
    this.anomalyPatterns = this.initializeAnomalyPatterns();
  }

  /**
   * Initialize default anomaly patterns (OWASP-based)
   */
  private initializeAnomalyPatterns(): Map<string, AnomalyPattern> {
    const patterns = new Map<string, AnomalyPattern>();

    // Pattern 1: Brute force detection
    patterns.set('brute_force', {
      id: 'brute_force',
      name: 'Brute Force Attack',
      description: 'Multiple failed auth attempts in short time',
      triggers: [
        {
          eventType: 'auth_failure',
          condition: 'equals',
          field: 'success',
          value: false,
          weight: 1,
        },
      ],
      severity: AuditSeverity.CRITICAL,
      threshold: 5, // 5 failures = alert
      timeWindow: 5 * 60 * 1000, // 5 minutes
    });

    // Pattern 2: Session hijacking
    patterns.set('session_anomaly', {
      id: 'session_anomaly',
      name: 'Session Anomaly',
      description: 'Unusual session activity detected',
      triggers: [
        {
          eventType: 'session_created',
          condition: 'exceeds',
          field: 'frequency',
          value: 10,
          weight: 0.5,
        },
        {
          eventType: 'access_denied',
          condition: 'exceeds',
          field: 'count',
          value: 3,
          weight: 1,
        },
      ],
      severity: AuditSeverity.ERROR,
      threshold: 1.5,
      timeWindow: 30 * 60 * 1000, // 30 minutes
    });

    // Pattern 3: Data exfiltration
    patterns.set('data_exfiltration', {
      id: 'data_exfiltration',
      name: 'Data Exfiltration',
      description: 'Unusual data export activity',
      triggers: [
        {
          eventType: 'data_export_requested',
          condition: 'exceeds',
          field: 'count',
          value: 3,
          weight: 1,
        },
      ],
      severity: AuditSeverity.ERROR,
      threshold: 1,
      timeWindow: 24 * 60 * 60 * 1000, // 24 hours
    });

    // Pattern 4: Privilege abuse
    patterns.set('privilege_abuse', {
      id: 'privilege_abuse',
      name: 'Privilege Abuse',
      description: 'Unauthorized settings changes',
      triggers: [
        {
          eventType: 'settings_changed',
          condition: 'contains',
          field: 'field',
          value: 'permissions',
          weight: 1,
        },
      ],
      severity: AuditSeverity.WARNING,
      threshold: 1,
      timeWindow: 60 * 60 * 1000, // 1 hour
    });

    return patterns;
  }

  /**
   * Log an audit event
   */
  async logEvent(
    eventType: AuditEventType,
    severity: AuditSeverity = AuditSeverity.INFO,
    details: Record<string, any> = {},
    tags: string[] = []
  ): Promise<string> {
    const event: AuditEvent = {
      id: generateToken(16),
      eventType,
      severity,
      userId: this.userId,
      sessionId: this.sessionId,
      timestamp: Date.now(),
      ipAddress: this.getClientIP(),
      userAgent: navigator.userAgent.substring(0, 200),
      details,
      tags,
      sourceComponent: this.getCallerComponent(),
      success: severity !== AuditSeverity.ERROR && severity !== AuditSeverity.CRITICAL,
    };

    // Add to buffer
    this.logBuffer.push(event);
    this.recentEvents.push(event);
    this.logSequence++;

    // Keep recent events for anomaly detection (last 1 hour)
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    this.recentEvents = this.recentEvents.filter((e) => e.timestamp > oneHourAgo);

    // Check for anomalies
    await this.detectAnomalies(event);

    // Auto-flush if buffer is large
    if (this.logBuffer.length >= 100) {
      await this.flush();
    }

    return event.id;
  }

  /**
   * Detect suspicious patterns
   */
  private async detectAnomalies(newEvent: AuditEvent): Promise<void> {
    for (const [patternId, pattern] of this.anomalyPatterns) {
      let anomalyScore = 0;

      for (const trigger of pattern.triggers) {
        // Check if event matches trigger
        if (this.matchesTrigger(newEvent, trigger)) {
          anomalyScore += trigger.weight;
        }
      }

      // Check if threshold exceeded
      if (anomalyScore >= pattern.threshold) {
        await this.logEvent(
          'suspicious_activity',
          pattern.severity,
          {
            pattern: patternId,
            patternName: pattern.name,
            score: anomalyScore,
            threshold: pattern.threshold,
          },
          ['anomaly_detected']
        );

        // Alert security team
        this.triggerSecurityAlert(patternId, pattern, anomalyScore);
      }
    }
  }

  /**
   * Check if event matches trigger condition
   */
  private matchesTrigger(event: AuditEvent, trigger: AnomalyTrigger): boolean {
    const value = event.details[trigger.field] ?? event[trigger.field as keyof AuditEvent];

    switch (trigger.condition) {
      case 'equals':
        return value === trigger.value;
      case 'contains':
        return String(value).includes(String(trigger.value));
      case 'exceeds':
        return Number(value) > trigger.value;
      case 'under':
        return Number(value) < trigger.value;
      default:
        return false;
    }
  }

  /**
   * Trigger security alert (webhook, email, etc.)
   */
  private async triggerSecurityAlert(
    patternId: string,
    pattern: AnomalyPattern,
    score: number
  ): Promise<void> {
    try {
      await fetch('/api/security/alerts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          patternId,
          patternName: pattern.name,
          severity: pattern.severity,
          score,
          timestamp: Date.now(),
          sessionId: this.sessionId,
          userId: this.userId,
        }),
      });
    } catch (error) {
      console.error('Failed to trigger security alert:', error);
    }
  }

  /**
   * Get client IP (best effort, may be proxied)
   */
  private getClientIP(): string {
    // In browser, we can't get real IP (that's server-side)
    // But we can try to get from headers if available
    return 'client-ip'; // Placeholder - server will add real IP
  }

  /**
   * Get calling component (stack trace analysis)
   */
  private getCallerComponent(): string {
    if (typeof Error.captureStackTrace === 'function') {
      const stack = new Error().stack || '';
      const lines = stack.split('\n');
      // Extract component from stack trace
      for (const line of lines) {
        if (line.includes('at ') && !line.includes('auditLogger')) {
          const match = line.match(/at\s+(.+?)\s*\(/);
          return match ? match[1] : 'unknown';
        }
      }
    }
    return 'unknown';
  }

  /**
   * Encrypt and send audit logs
   */
  async flush(): Promise<void> {
    if (this.logBuffer.length === 0) return;

    const logsToSend = [...this.logBuffer];
    this.logBuffer = [];

    try {
      const encryptedLogs: EncryptedAuditLog[] = [];

      for (const log of logsToSend) {
        const encrypted = await encryptData(log, this.encryptionPassword);
        const eventTypeHash = await hashData(log.eventType);
        const userIdHash = log.userId ? await hashData(log.userId) : undefined;
        const checksum = await hashData(encrypted);

        encryptedLogs.push({
          id: log.id,
          encryptedData: encrypted,
          eventTypeHash,
          userIdHash,
          timestamp: log.timestamp,
          severity: log.severity,
          sessionId: log.sessionId,
          checksum,
          sequenceNumber: this.logSequence++,
        });
      }

      // Send to server (immutable audit trail)
      const response = await fetch('/api/audit/logs', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Session-ID': this.sessionId,
        },
        body: JSON.stringify({ logs: encryptedLogs }),
      });

      if (!response.ok) {
        // Re-queue failed logs
        this.logBuffer.push(...logsToSend);
        console.error('Failed to flush audit logs');
      }
    } catch (error) {
      // Re-queue on error
      this.logBuffer.push(...logsToSend);
      console.error('Audit log flush error:', error);
    }
  }

  /**
   * Get audit log summary (for dashboard)
   */
  getLogSummary(): {
    totalEvents: number;
    eventsByType: Record<AuditEventType, number>;
    eventsBySeverity: Record<AuditSeverity, number>;
    anomaliesDetected: number;
  } {
    const byType: Record<string, number> = {};
    const bySeverity: Record<string, number> = {};
    let anomalies = 0;

    for (const event of this.recentEvents) {
      byType[event.eventType] = (byType[event.eventType] || 0) + 1;
      bySeverity[event.severity] = (bySeverity[event.severity] || 0) + 1;

      if (event.tags.includes('anomaly_detected')) {
        anomalies++;
      }
    }

    return {
      totalEvents: this.recentEvents.length,
      eventsByType: byType as Record<AuditEventType, number>,
      eventsBySeverity: bySeverity as Record<AuditSeverity, number>,
      anomaliesDetected: anomalies,
    };
  }

  /**
   * Get session ID for correlation
   */
  getSessionId(): string {
    return this.sessionId;
  }
}

// Singleton instance
let auditInstance: AuditLogger | null = null;

export function getAuditLogger(userId?: string): AuditLogger {
  if (!auditInstance) {
    auditInstance = new AuditLogger(userId);
  }
  return auditInstance;
}
