'use client';

import { useEffect, useState, useCallback } from 'react';
import { getMetricsCollector } from '@/lib/monitoring/performanceMetrics';
import type { MetricsSnapshot, WebVitals, ExamMetrics, SystemMetrics } from '@/lib/monitoring/performanceMetrics';

/**
 * Hook for performance dashboard
 *
 * Usage:
 * const { metrics, recordExamMetrics, recordSystemMetrics } = usePerformanceDashboard();
 */
export function usePerformanceDashboard(sessionId: string) {
  const [metrics, setMetrics] = useState({
    webVitals: {} as Partial<WebVitals>,
    examMetrics: {} as Partial<ExamMetrics>,
    systemMetrics: {} as Partial<SystemMetrics>,
  });

  const collector = getMetricsCollector(sessionId);

  const updateMetrics = useCallback(() => {
    setMetrics(collector.getAverageMetrics());
  }, [collector]);

  const recordExamMetrics = useCallback(
    (data: Partial<ExamMetrics>) => {
      collector.recordExamMetrics(data);
      updateMetrics();
    },
    [collector, updateMetrics]
  );

  const recordSystemMetrics = useCallback(() => {
    collector.recordSystemMetrics();
    updateMetrics();
  }, [collector, updateMetrics]);

  // Update metrics every 10 seconds
  useEffect(() => {
    const interval = setInterval(() => {
      updateMetrics();
      recordSystemMetrics();
    }, 10000);

    return () => clearInterval(interval);
  }, [updateMetrics, recordSystemMetrics]);

  // Initial update
  useEffect(() => {
    updateMetrics();
  }, [updateMetrics]);

  return { metrics, recordExamMetrics, recordSystemMetrics };
}

/**
 * Hook for Web Vitals monitoring
 */
export function useWebVitalsMonitoring(sessionId: string) {
  const [vitals, setVitals] = useState<Partial<WebVitals>>({});
  const collector = getMetricsCollector(sessionId);

  useEffect(() => {
    const interval = setInterval(() => {
      const snapshot = collector.getAverageMetrics();
      setVitals(snapshot.webVitals);

      // Check against thresholds
      if (snapshot.webVitals.lcp && snapshot.webVitals.lcp > 2500) {
        console.warn('⚠️ High LCP:', snapshot.webVitals.lcp);
      }
      if (snapshot.webVitals.cls && snapshot.webVitals.cls > 0.1) {
        console.warn('⚠️ High CLS:', snapshot.webVitals.cls);
      }
    }, 5000);

    return () => clearInterval(interval);
  }, [collector]);

  return vitals;
}

/**
 * Hook for exam performance analytics
 */
export function useExamPerformanceAnalytics(sessionId: string, templateId: string) {
  const { metrics, recordExamMetrics } = usePerformanceDashboard(sessionId);
  const [questionMetrics, setQuestionMetrics] = useState<{
    totalAnswered: number;
    averageTimePerQuestion: number;
    questionsPerMinute: number;
    navigationEfficiency: number;
  }>({
    totalAnswered: 0,
    averageTimePerQuestion: 0,
    questionsPerMinute: 0,
    navigationEfficiency: 0,
  });

  const trackQuestionCompletion = useCallback(
    (questionNum: number, timeSpent: number) => {
      setQuestionMetrics((prev) => {
        const newTotal = prev.totalAnswered + 1;
        const newAvgTime = (prev.averageTimePerQuestion * prev.totalAnswered + timeSpent) / newTotal;
        const newQPM = (newTotal / ((Date.now() - Date.now()) / 60000)) || 0;

        recordExamMetrics({
          questionsAnswered: newTotal,
          questionAnswerTime: newAvgTime,
        });

        return {
          ...prev,
          totalAnswered: newTotal,
          averageTimePerQuestion: newAvgTime,
          questionsPerMinute: newQPM,
        };
      });
    },
    [recordExamMetrics]
  );

  return { questionMetrics, trackQuestionCompletion };
}

/**
 * Hook for system health monitoring
 */
export function useSystemHealthMonitoring(sessionId: string) {
  const [health, setHealth] = useState({
    memoryUsage: 0,
    batteryLevel: 100,
    networkType: 'unknown',
    fps: 60,
    isLowBattery: false,
    isSlowNetwork: false,
  });

  const collector = getMetricsCollector(sessionId);

  useEffect(() => {
    const checkHealth = () => {
      const metrics = collector.getAverageMetrics();
      const sys = metrics.systemMetrics;

      setHealth({
        memoryUsage: sys.memoryUsage || 0,
        batteryLevel: sys.batteryLevel || 100,
        networkType: sys.networkType || 'unknown',
        fps: sys.fps || 60,
        isLowBattery: (sys.batteryLevel || 100) < 20,
        isSlowNetwork: ['2g', '3g', 'slow-4g'].includes(sys.networkType || ''),
      });
    };

    checkHealth();
    const interval = setInterval(checkHealth, 30000);

    return () => clearInterval(interval);
  }, [collector]);

  return health;
}

/**
 * Hook for performance alerts
 */
export function usePerformanceAlerts(sessionId: string) {
  const [alerts, setAlerts] = useState<Array<{
    id: string;
    type: 'warning' | 'error';
    message: string;
    timestamp: number;
  }>>([]);

  const collector = getMetricsCollector(sessionId);

  useEffect(() => {
    const checkPerformance = () => {
      const metrics = collector.getAverageMetrics();
      const newAlerts: Array<{
        id: string;
        type: 'warning' | 'error';
        message: string;
        timestamp: number;
      }> = [];

      // LCP check
      if (metrics.webVitals.lcp && metrics.webVitals.lcp > 4000) {
        newAlerts.push({
          id: 'lcp-critical',
          type: 'error',
          message: `Critical LCP: ${Math.round(metrics.webVitals.lcp)}ms (target: <2.5s)`,
          timestamp: Date.now(),
        });
      } else if (metrics.webVitals.lcp && metrics.webVitals.lcp > 2500) {
        newAlerts.push({
          id: 'lcp-warning',
          type: 'warning',
          message: `High LCP: ${Math.round(metrics.webVitals.lcp)}ms`,
          timestamp: Date.now(),
        });
      }

      // FID check
      if (metrics.webVitals.fid && metrics.webVitals.fid > 300) {
        newAlerts.push({
          id: 'fid-warning',
          type: 'warning',
          message: `Slow response: ${Math.round(metrics.webVitals.fid)}ms`,
          timestamp: Date.now(),
        });
      }

      // CLS check
      if (metrics.webVitals.cls && metrics.webVitals.cls > 0.25) {
        newAlerts.push({
          id: 'cls-warning',
          type: 'warning',
          message: `Layout shift detected: ${metrics.webVitals.cls.toFixed(2)}`,
          timestamp: Date.now(),
        });
      }

      // Memory check
      if (metrics.systemMetrics.memoryUsage && metrics.systemMetrics.memoryUsage > 200) {
        newAlerts.push({
          id: 'memory-warning',
          type: 'warning',
          message: `High memory: ${Math.round(metrics.systemMetrics.memoryUsage)}MB`,
          timestamp: Date.now(),
        });
      }

      // Network check
      if (metrics.systemMetrics.networkType === '2g' || metrics.systemMetrics.networkType === 'slow-2g') {
        newAlerts.push({
          id: 'network-warning',
          type: 'warning',
          message: `Slow network: ${metrics.systemMetrics.networkType}`,
          timestamp: Date.now(),
        });
      }

      setAlerts(newAlerts);
    };

    checkPerformance();
    const interval = setInterval(checkPerformance, 20000);

    return () => clearInterval(interval);
  }, [collector]);

  return { alerts, dismissAlert: (id: string) => {
    setAlerts(prev => prev.filter(a => a.id !== id));
  }};
}
