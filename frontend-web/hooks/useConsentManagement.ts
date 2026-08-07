'use client';

import { useState, useEffect, useCallback } from 'react';
import { getAnalyticsService, type ConsentPreferences } from '@/lib/analytics/encryptedAnalytics';

/**
 * Hook for managing GDPR consent preferences
 *
 * Usage:
 * const { consent, updateConsent, showBanner } = useConsentManagement();
 *
 * if (showBanner) {
 *   return <ConsentBanner onAccept={updateConsent} />;
 * }
 */
export function useConsentManagement() {
  const [consent, setConsent] = useState<ConsentPreferences | null>(null);
  const [showBanner, setShowBanner] = useState(false);
  const [showPreferences, setShowPreferences] = useState(false);

  const analytics = getAnalyticsService();

  // Load consent on mount
  useEffect(() => {
    const stored = analytics.getConsent();
    setConsent(stored);

    // Show banner if no consent recorded
    const hasConsentRecording = stored.timestamp > 0 && stored.version === '1.0';
    if (!hasConsentRecording) {
      setShowBanner(true);
    }
  }, []);

  const updateConsent = useCallback(
    (preferences: Partial<ConsentPreferences>, showThankYou = true) => {
      analytics.setConsent(preferences);
      const updated = analytics.getConsent();
      setConsent(updated);
      setShowBanner(false);

      if (showThankYou) {
        // Show brief thank you message
        window.dispatchEvent(
          new CustomEvent('consent-updated', { detail: updated })
        );
      }
    },
    [analytics]
  );

  const acceptAll = useCallback(() => {
    updateConsent({
      necessary: true,
      analytics: true,
      marketing: true,
      preferences: true,
    });
  }, [updateConsent]);

  const rejectAll = useCallback(() => {
    updateConsent({
      necessary: true,
      analytics: false,
      marketing: false,
      preferences: false,
    });
  }, [updateConsent]);

  const openPreferences = useCallback(() => {
    setShowPreferences(true);
  }, []);

  const closePreferences = useCallback(() => {
    setShowPreferences(false);
  }, []);

  return {
    consent,
    showBanner,
    showPreferences,
    updateConsent,
    acceptAll,
    rejectAll,
    openPreferences,
    closePreferences,
  };
}

/**
 * Hook to track user consent lifecycle
 * Useful for analytics and compliance reporting
 */
export function useConsentTracking() {
  const [consentHistory, setConsentHistory] = useState<
    Array<{
      timestamp: number;
      action: 'accept' | 'reject' | 'update' | 'revoke';
      preferences: Partial<ConsentPreferences>;
    }>
  >([]);

  const trackConsentAction = useCallback(
    (action: 'accept' | 'reject' | 'update' | 'revoke', preferences: Partial<ConsentPreferences>) => {
      setConsentHistory((prev) => [
        ...prev,
        {
          timestamp: Date.now(),
          action,
          preferences,
        },
      ]);

      // Send to server for compliance records
      fetch('/api/compliance/consent-log', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          preferences,
          timestamp: Date.now(),
        }),
      }).catch(console.error);
    },
    []
  );

  return { consentHistory, trackConsentAction };
}

/**
 * Hook to detect and handle consent expiration
 * GDPR recommends re-consent every 12 months
 */
export function useConsentExpiration(expirationDays = 365) {
  const [isExpired, setIsExpired] = useState(false);
  const analytics = getAnalyticsService();

  useEffect(() => {
    const consent = analytics.getConsent();
    const ageInDays = (Date.now() - consent.timestamp) / (1000 * 60 * 60 * 24);

    if (ageInDays > expirationDays) {
      setIsExpired(true);
      // Dispatch event for UI
      window.dispatchEvent(new CustomEvent('consent-expired'));
    }
  }, [expirationDays]);

  const refreshConsent = useCallback(() => {
    const current = analytics.getConsent();
    analytics.setConsent({
      ...current,
      timestamp: Date.now(),
    });
    setIsExpired(false);
  }, [analytics]);

  return { isExpired, refreshConsent };
}

/**
 * Hook to request specific consent types
 * Useful when feature requires consent
 */
export function useFeatureConsent(requiredConsent: keyof ConsentPreferences) {
  const [hasConsent, setHasConsent] = useState(false);
  const [requestingConsent, setRequestingConsent] = useState(false);
  const analytics = getAnalyticsService();

  useEffect(() => {
    const consent = analytics.getConsent();
    setHasConsent(consent[requiredConsent] === true);
  }, [requiredConsent]);

  const requestConsent = useCallback(async () => {
    setRequestingConsent(true);

    // Dispatch event to show consent dialog
    const event = new CustomEvent('consent-required', {
      detail: { required: requiredConsent },
    });
    window.dispatchEvent(event);

    // Wait for consent response
    return new Promise<boolean>((resolve) => {
      const handler = (e: Event) => {
        const customEvent = e as CustomEvent;
        if (customEvent.detail?.granted) {
          setHasConsent(true);
          resolve(true);
        } else {
          resolve(false);
        }
        setRequestingConsent(false);
        window.removeEventListener('consent-granted', handler);
      };

      window.addEventListener('consent-granted', handler);

      // Timeout after 30 seconds
      setTimeout(() => {
        window.removeEventListener('consent-granted', handler);
        setRequestingConsent(false);
        resolve(false);
      }, 30000);
    });
  }, [requiredConsent]);

  return { hasConsent, requestingConsent, requestConsent };
}

/**
 * Hook for privacy dashboard
 * Shows and manages all data collection preferences
 */
export function usePrivacyDashboard() {
  const [consentPreferences, setConsentPreferences] = useState<ConsentPreferences | null>(null);
  const [dataCategories] = useState([
    {
      id: 'necessary',
      name: 'Essential',
      description: 'Required for basic functionality',
      canDisable: false,
    },
    {
      id: 'analytics',
      name: 'Analytics',
      description: 'Help us improve by understanding usage patterns',
      canDisable: true,
    },
    {
      id: 'marketing',
      name: 'Marketing',
      description: 'Personalized recommendations and offers',
      canDisable: true,
    },
    {
      id: 'preferences',
      name: 'Preferences',
      description: 'Remember your settings',
      canDisable: true,
    },
  ]);

  const analytics = getAnalyticsService();

  useEffect(() => {
    setConsentPreferences(analytics.getConsent());
  }, []);

  const toggleCategory = useCallback(
    (categoryId: string) => {
      if (!consentPreferences) return;

      const updated = {
        ...consentPreferences,
        [categoryId]: !consentPreferences[categoryId as keyof ConsentPreferences],
      };

      analytics.setConsent(updated);
      setConsentPreferences(updated);
    },
    [consentPreferences, analytics]
  );

  const requestDataExport = useCallback(async () => {
    try {
      const response = await fetch('/api/privacy/export', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Export failed');
      }

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `personal-data-${Date.now()}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Data export failed:', error);
    }
  }, []);

  const requestDataDeletion = useCallback(async () => {
    if (!confirm('Are you sure? This will permanently delete all your personal data.')) {
      return;
    }

    try {
      const response = await fetch('/api/privacy/delete', {
        method: 'POST',
      });

      if (!response.ok) {
        throw new Error('Deletion failed');
      }

      window.dispatchEvent(new CustomEvent('data-deleted'));
    } catch (error) {
      console.error('Data deletion failed:', error);
    }
  }, []);

  return {
    consentPreferences,
    dataCategories,
    toggleCategory,
    requestDataExport,
    requestDataDeletion,
  };
}

/**
 * Hook to check GDPR compliance status
 * Useful for audit and monitoring
 */
export function useGDPRCompliance() {
  const [complianceStatus, setComplianceStatus] = useState({
    hasValidConsent: false,
    consentRecorded: false,
    dataEncrypted: false,
    sensitiveFieldsRedacted: true, // Always true
    retentionPolicySet: false,
  });

  const analytics = getAnalyticsService();

  useEffect(() => {
    const consent = analytics.getConsent();

    setComplianceStatus({
      hasValidConsent: consent.necessary === true,
      consentRecorded: consent.timestamp > 0,
      dataEncrypted: true, // Always encrypted in this implementation
      sensitiveFieldsRedacted: true,
      retentionPolicySet: consent.timestamp + 30 * 24 * 60 * 60 * 1000 > Date.now(), // 30 day policy
    });
  }, []);

  const isCompliant = Object.values(complianceStatus).every((v) => v === true);

  return { complianceStatus, isCompliant };
}
