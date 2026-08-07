'use client';

import { useEffect, useCallback, useRef } from 'react';
import { getAnalyticsService } from '@/lib/analytics/encryptedAnalytics';

/**
 * Hook for tracking exam events with privacy considerations
 *
 * Usage:
 * const { trackEvent } = useExamAnalytics(templateId, attemptId);
 * trackEvent('question_answered', { questionNum: 5, answered: true });
 */
export function useExamAnalytics(templateId: string, attemptId: string) {
  const analytics = getAnalyticsService();

  const trackEvent = useCallback(
    async (eventType: any, data: Record<string, any> = {}) => {
      await analytics.trackEvent(eventType, data, {
        templateId,
        attemptId,
      });
    },
    [templateId, attemptId, analytics]
  );

  return { trackEvent };
}

/**
 * Hook to track exam session lifecycle
 */
export function useExamSessionTracking(templateId: string, attemptId: string) {
  const analytics = getAnalyticsService();
  const sessionStartedRef = useRef(false);
  const questionsAnsweredRef = useRef<Set<number>>(new Set());
  const questionsViewedRef = useRef<Set<number>>(new Set());

  // Track exam start
  useEffect(() => {
    if (!sessionStartedRef.current) {
      analytics.trackEvent('exam_started', {
        templateId,
        attemptId,
      });
      sessionStartedRef.current = true;
    }

    return () => {
      // Track exam exit/pause
      if (sessionStartedRef.current) {
        analytics.trackEvent('exam_paused', {
          questionsAnswered: questionsAnsweredRef.current.size,
          questionsViewed: questionsViewedRef.current.size,
        });
      }
    };
  }, [templateId, attemptId]);

  const trackQuestionViewed = useCallback(
    (questionNum: number) => {
      questionsViewedRef.current.add(questionNum);
    },
    []
  );

  const trackQuestionAnswered = useCallback(
    (questionNum: number, answered: boolean) => {
      if (answered) {
        questionsAnsweredRef.current.add(questionNum);
      } else {
        questionsAnsweredRef.current.delete(questionNum);
      }

      analytics.trackEvent('question_answered', {
        questionNum,
        answered,
        totalAnswered: questionsAnsweredRef.current.size,
      });
    },
    [analytics]
  );

  const trackQuestionFlagged = useCallback(
    (questionNum: number, flagged: boolean) => {
      analytics.trackEvent('question_flagged', {
        questionNum,
        flagged,
      });
    },
    [analytics]
  );

  return {
    trackQuestionViewed,
    trackQuestionAnswered,
    trackQuestionFlagged,
  };
}

/**
 * Hook to track offline/online transitions
 */
export function useNetworkStatusTracking() {
  const analytics = getAnalyticsService();

  useEffect(() => {
    const handleOnline = () => {
      analytics.trackEvent('network_changed', {
        status: 'online',
      });
    };

    const handleOffline = () => {
      analytics.trackEvent('offline_mode_enabled', {
        status: 'offline',
      });
    };

    window.addEventListener('online', handleOnline);
    window.addEventListener('offline', handleOffline);

    return () => {
      window.removeEventListener('online', handleOnline);
      window.removeEventListener('offline', handleOffline);
    };
  }, [analytics]);
}

/**
 * Hook to track biometric auth attempts
 */
export function useBiometricAnalytics() {
  const analytics = getAnalyticsService();

  const trackAuthAttempt = useCallback(
    (success: boolean, method: 'biometric' | 'passkey' | 'password') => {
      analytics.trackEvent('biometric_auth_attempt', {
        success,
        method,
        // Don't include user details - anonymized
      });
    },
    [analytics]
  );

  const trackSessionTimeout = useCallback(() => {
    analytics.trackEvent('session_timeout', {
      reason: 'inactivity',
    });
  }, [analytics]);

  return { trackAuthAttempt, trackSessionTimeout };
}

/**
 * Hook to track gesture usage
 */
export function useGestureAnalytics() {
  const analytics = getAnalyticsService();

  const trackGesture = useCallback(
    (gestureType: 'swipe' | 'pinch' | 'long_press' | 'two_finger_tap' | 'rotation') => {
      // Aggregate gesture tracking (no user tracking)
      analytics.trackEvent('gesture_used', {
        type: gestureType,
        // Don't include specific location or user
      });
    },
    [analytics]
  );

  const trackImageZoom = useCallback(
    (scale: number) => {
      analytics.trackEvent('image_zoomed', {
        zoomLevel: Math.round(scale * 100), // 0-300%
      });
    },
    [analytics]
  );

  return { trackGesture, trackImageZoom };
}

/**
 * Hook to track performance metrics
 */
export function usePerformanceAnalytics() {
  const analytics = getAnalyticsService();

  useEffect(() => {
    // Track Web Vitals
    if (typeof window !== 'undefined' && 'PerformanceObserver' in window) {
      try {
        // Largest Contentful Paint
        const lcpObserver = new PerformanceObserver((list) => {
          const lastEntry = list.getEntries().pop();
          if (lastEntry) {
            analytics.trackEvent('exam_progress', {
              metric: 'lcp',
              value: Math.round(lastEntry.startTime),
            });
          }
        });

        lcpObserver.observe({ entryTypes: ['largest-contentful-paint'] });

        // First Input Delay
        const fidObserver = new PerformanceObserver((list) => {
          list.getEntries().forEach((entry: any) => {
            analytics.trackEvent('exam_progress', {
              metric: 'fid',
              value: Math.round(entry.processingDuration),
            });
          });
        });

        fidObserver.observe({ entryTypes: ['first-input'] });

        return () => {
          lcpObserver.disconnect();
          fidObserver.disconnect();
        };
      } catch (error) {
        console.error('Performance observer setup failed:', error);
      }
    }
  }, [analytics]);
}

/**
 * Hook to track errors and issues
 */
export function useErrorAnalytics() {
  const analytics = getAnalyticsService();

  useEffect(() => {
    const handleError = (event: ErrorEvent) => {
      analytics.trackEvent('error_occurred', {
        message: event.message.substring(0, 100), // Truncate
        // Don't include full stack trace (could contain sensitive info)
        lineNumber: event.lineno,
      });
    };

    const handleUnhandledRejection = (event: PromiseRejectionEvent) => {
      analytics.trackEvent('error_occurred', {
        message: 'Unhandled promise rejection',
        // Don't include error details
      });
    };

    window.addEventListener('error', handleError);
    window.addEventListener('unhandledrejection', handleUnhandledRejection);

    return () => {
      window.removeEventListener('error', handleError);
      window.removeEventListener('unhandledrejection', handleUnhandledRejection);
    };
  }, [analytics]);
}

/**
 * Hook for periodic analytics flush
 */
export function useAnalyticsFlush(intervalSeconds = 60) {
  const analytics = getAnalyticsService();

  useEffect(() => {
    const interval = setInterval(() => {
      analytics.flush();
    }, intervalSeconds * 1000);

    // Also flush on page unload
    const handleBeforeUnload = () => {
      analytics.flush();
    };

    window.addEventListener('beforeunload', handleBeforeUnload);

    return () => {
      clearInterval(interval);
      window.removeEventListener('beforeunload', handleBeforeUnload);
    };
  }, [intervalSeconds, analytics]);
}

/**
 * Combined hook for complete exam analytics
 */
export function useCompleteExamAnalytics(templateId: string, attemptId: string) {
  const examAnalytics = useExamAnalytics(templateId, attemptId);
  const sessionTracking = useExamSessionTracking(templateId, attemptId);
  useNetworkStatusTracking();
  const biometricAnalytics = useBiometricAnalytics();
  const gestureAnalytics = useGestureAnalytics();
  usePerformanceAnalytics();
  useErrorAnalytics();
  useAnalyticsFlush();

  return {
    ...examAnalytics,
    ...sessionTracking,
    ...biometricAnalytics,
    ...gestureAnalytics,
  };
}
