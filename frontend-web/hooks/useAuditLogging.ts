'use client';

import { useEffect, useCallback } from 'react';
import { getAuditLogger, AuditSeverity } from '@/lib/audit/auditLogger';

/**
 * Hook for security event logging
 *
 * Usage:
 * const { logAuthAttempt, logDataAccess } = useAuditLogging();
 * logAuthAttempt(true, 'biometric');
 */
export function useAuditLogging() {
  const audit = getAuditLogger();

  const logAuthAttempt = useCallback(
    async (success: boolean, method: 'biometric' | 'passkey' | 'password') => {
      await audit.logEvent(
        success ? 'auth_success' : 'auth_failure',
        success ? AuditSeverity.INFO : AuditSeverity.WARNING,
        { method },
        ['authentication']
      );
    },
    [audit]
  );

  const logBiometricAuth = useCallback(
    async (success: boolean, type: 'face' | 'fingerprint') => {
      await audit.logEvent(
        'biometric_auth_attempt',
        success ? AuditSeverity.INFO : AuditSeverity.WARNING,
        { type, success },
        ['biometric', 'authentication']
      );
    },
    [audit]
  );

  const logSessionCreated = useCallback(
    async (sessionId: string) => {
      await audit.logEvent(
        'session_created',
        AuditSeverity.INFO,
        { sessionId },
        ['session']
      );
    },
    [audit]
  );

  const logSessionTerminated = useCallback(
    async (reason: 'logout' | 'timeout' | 'error') => {
      await audit.logEvent(
        'session_terminated',
        AuditSeverity.INFO,
        { reason },
        ['session']
      );
    },
    [audit]
  );

  const logConsentChange = useCallback(
    async (changes: Record<string, boolean>) => {
      await audit.logEvent(
        'consent_changed',
        AuditSeverity.INFO,
        { changes },
        ['consent', 'privacy']
      );
    },
    [audit]
  );

  const logDataExport = useCallback(
    async (dataTypes: string[]) => {
      await audit.logEvent(
        'data_export_requested',
        AuditSeverity.WARNING,
        { dataTypes, count: dataTypes.length },
        ['data_access', 'privacy']
      );
    },
    [audit]
  );

  const logDataDeletion = useCallback(
    async () => {
      await audit.logEvent(
        'data_deletion_requested',
        AuditSeverity.WARNING,
        { timestamp: Date.now() },
        ['data_deletion', 'privacy']
      );
    },
    [audit]
  );

  const logSecurityError = useCallback(
    async (error: string, details?: Record<string, any>) => {
      await audit.logEvent(
        'security_error',
        AuditSeverity.ERROR,
        { error, ...details },
        ['security', 'error']
      );
    },
    [audit]
  );

  const logRateLimitExceeded = useCallback(
    async (endpoint: string, limit: number) => {
      await audit.logEvent(
        'rate_limit_exceeded',
        AuditSeverity.WARNING,
        { endpoint, limit },
        ['rate_limit', 'security']
      );
    },
    [audit]
  );

  return {
    logAuthAttempt,
    logBiometricAuth,
    logSessionCreated,
    logSessionTerminated,
    logConsentChange,
    logDataExport,
    logDataDeletion,
    logSecurityError,
    logRateLimitExceeded,
  };
}

/**
 * Hook to setup automatic audit logging for the session
 */
export function useSessionAuditLogging() {
  const { logSessionCreated, logSessionTerminated } = useAuditLogging();
  const audit = getAuditLogger();

  // Log session creation
  useEffect(() => {
    logSessionCreated(audit.getSessionId());

    return () => {
      // Log session termination on unmount
      logSessionTerminated('logout');
      // Flush any remaining logs
      audit.flush();
    };
  }, []);
}

/**
 * Hook to monitor and log errors
 */
export function useErrorAuditLogging() {
  const { logSecurityError } = useAuditLogging();

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      logSecurityError('Unhandled error', {
        message: event.message,
        filename: event.filename,
        lineno: event.lineno,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      logSecurityError('Unhandled promise rejection', {
        reason: String(event.reason).substring(0, 200),
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [logSecurityError]);
}

/**
 * Hook to setup automatic audit log flushing
 */
export function useAuditFlush(intervalSeconds = 60) {
  const audit = getAuditLogger();

  useEffect(() => {
    const interval = setInterval(() => {
      audit.flush();
    }, intervalSeconds * 1000);

    // Also flush on page unload
    const handleBeforeUnload = () => {
      audit.flush();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [audit, intervalSeconds]);
}

/**
 * Hook to get audit log dashboard data
 */
export function useAuditDashboard() {
  const audit = getAuditLogger();

  const getSummary = () => {
    return audit.getLogSummary();
  };

  const getSessionId = () => {
    return audit.getSessionId();
  };

  return { getSummary, getSessionId };
}

/**
 * Combined hook for complete audit logging
 */
export function useCompleteAuditLogging() {
  const auditLogging = useAuditLogging();
  useSessionAuditLogging();
  useErrorAuditLogging();
  useAuditFlush();
  const dashboard = useAuditDashboard();

  return {
    ...auditLogging,
    ...dashboard,
  };
}
