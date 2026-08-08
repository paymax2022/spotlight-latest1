'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  TrendAnalyzer,
  RiskCalculator,
  PredictiveCompliance,
  TrendAnalysis,
  ComplianceForecast,
  MetricDataPoint,
} from '@/lib/compliance/trendAnalysis';

/**
 * Predictive compliance state
 */
export interface PredictiveComplianceState {
  gdprForecast: ComplianceForecast | null;
  securityForecast: ComplianceForecast | null;
  performanceForecast: ComplianceForecast | null;
  compositeRisk: {
    overallRisk: number;
    escalationNeeded: boolean;
    highestRiskCategory: string;
    riskFactors: string[];
  } | null;
  escalationAlert: {
    shouldEscalate: boolean;
    severity: 'warning' | 'alert' | 'critical';
    message: string;
  } | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook for predictive compliance monitoring
 */
export function usePredictiveCompliance() {
  const [state, setState] = useState<PredictiveComplianceState>({
    gdprForecast: null,
    securityForecast: null,
    performanceForecast: null,
    compositeRisk: null,
    escalationAlert: null,
    isLoading: false,
    error: null,
  });

  /**
   * Fetch trend data and generate forecasts
   */
  const generateForecasts = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const response = await fetch('/api/compliance/trends?days=90');
      if (!response.ok) throw new Error('Failed to fetch trends');

      const data = await response.json();

      // Parse data
      const gdprData: MetricDataPoint[] = data.gdprTrend || [];
      const securityData: MetricDataPoint[] = data.securityTrend || [];
      const performanceData: MetricDataPoint[] = data.performanceTrend || [];

      // Generate forecasts
      const gdprForecast = PredictiveCompliance.generateForecast('gdpr', gdprData, 30);
      const securityForecast = PredictiveCompliance.generateForecast('security', securityData, 30);
      const performanceForecast = PredictiveCompliance.generateForecast('performance', performanceData, 30);

      // Calculate composite risk
      const compositeRisk = RiskCalculator.calculateCompositeRisk(
        gdprForecast.trend,
        securityForecast.trend,
        performanceForecast.trend
      );

      // Generate escalation alert
      const escalationAlert = RiskCalculator.generateEscalationAlert(
        compositeRisk.overallRisk,
        compositeRisk.highestRiskCategory
      );

      setState((prev) => ({
        ...prev,
        gdprForecast,
        securityForecast,
        performanceForecast,
        compositeRisk,
        escalationAlert,
        isLoading: false,
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to generate forecasts';
      setState((prev) => ({ ...prev, error: errorMsg, isLoading: false }));
    }
  }, []);

  /**
   * Auto-refresh on mount
   */
  useEffect(() => {
    generateForecasts();
    const interval = setInterval(generateForecasts, 300000); // Refresh every 5 minutes
    return () => clearInterval(interval);
  }, [generateForecasts]);

  return {
    ...state,
    generateForecasts,
  };
}

/**
 * Hook for compliance trend analysis
 */
export function useComplianceTrendAnalysis(metric: 'gdpr' | 'security' | 'performance') {
  const [trend, setTrend] = useState<TrendAnalysis | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  const analyzeTrend = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/compliance/trends?days=90`);
      if (!response.ok) throw new Error('Failed to fetch trends');

      const data = await response.json();
      const metricData = data[`${metric}Trend`] || [];

      const analysis = TrendAnalyzer.calculateTrend(metricData);
      setTrend(analysis);
    } catch (err) {
      console.error('Failed to analyze trend:', err);
    } finally {
      setIsLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    analyzeTrend();
  }, [analyzeTrend]);

  return {
    trend,
    isLoading,
    analyzeTrend,
  };
}

/**
 * Hook for compliance forecast visualization
 */
export function useComplianceForecast(metric: 'gdpr' | 'security' | 'performance') {
  const [forecast, setForecast] = useState<ComplianceForecast | null>(null);
  const [actionPlan, setActionPlan] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const generateForecast = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/compliance/trends?days=90`);
      if (!response.ok) throw new Error('Failed to fetch trends');

      const data = await response.json();
      const metricData = data[`${metric}Trend`] || [];

      const forecast = PredictiveCompliance.generateForecast(metric, metricData, 30);
      const actionPlan = PredictiveCompliance.generateActionPlan(forecast);

      setForecast(forecast);
      setActionPlan(actionPlan);
    } catch (err) {
      console.error('Failed to generate forecast:', err);
    } finally {
      setIsLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    generateForecast();
  }, [generateForecast]);

  return {
    forecast,
    actionPlan,
    isLoading,
    regenerate: generateForecast,
  };
}

/**
 * Hook for risk escalation alerts
 */
export function useRiskEscalation() {
  const [escalations, setEscalations] = useState<
    Array<{
      id: string;
      metric: string;
      severity: 'warning' | 'alert' | 'critical';
      message: string;
      timestamp: number;
      acknowledged: boolean;
    }>
  >([]);

  const [isWatching, setIsWatching] = useState(false);

  /**
   * Poll for escalation alerts
   */
  useEffect(() => {
    if (!isWatching) return;

    const pollAlerts = async () => {
      try {
        const response = await fetch('/api/compliance/risk/escalations');
        if (!response.ok) return;

        const data = await response.json();
        setEscalations(data.escalations || []);
      } catch (err) {
        console.error('Failed to fetch escalations:', err);
      }
    };

    const interval = setInterval(pollAlerts, 60000); // Poll every 60 seconds
    pollAlerts(); // Initial fetch

    return () => clearInterval(interval);
  }, [isWatching]);

  /**
   * Acknowledge escalation
   */
  const acknowledge = useCallback(async (id: string) => {
    try {
      await fetch(`/api/compliance/risk/escalations/${id}/acknowledge`, { method: 'POST' });
      setEscalations((prev) => prev.map((e) => (e.id === id ? { ...e, acknowledged: true } : e)));
    } catch (err) {
      console.error('Failed to acknowledge escalation:', err);
    }
  }, []);

  /**
   * Dismiss escalation
   */
  const dismiss = useCallback((id: string) => {
    setEscalations((prev) => prev.filter((e) => e.id !== id));
  }, []);

  return {
    escalations,
    acknowledge,
    dismiss,
    startWatching: () => setIsWatching(true),
    stopWatching: () => setIsWatching(false),
    isWatching,
  };
}

/**
 * Hook for predictive recommendations
 */
export function usePredictiveRecommendations() {
  const [recommendations, setRecommendations] = useState<
    Array<{
      id: string;
      metric: string;
      priority: 'low' | 'medium' | 'high' | 'critical';
      action: string;
      daysToComplete: number;
      estimatedImpact: string;
      status: 'pending' | 'in_progress' | 'completed';
    }>
  >([]);

  const [isLoading, setIsLoading] = useState(false);

  /**
   * Fetch recommendations
   */
  const fetchRecommendations = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/compliance/recommendations');
      if (!response.ok) throw new Error('Failed to fetch recommendations');

      const data = await response.json();
      setRecommendations(data.recommendations || []);
    } catch (err) {
      console.error('Failed to fetch recommendations:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Update recommendation status
   */
  const updateStatus = useCallback(
    async (id: string, status: 'pending' | 'in_progress' | 'completed') => {
      try {
        await fetch(`/api/compliance/recommendations/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ status }),
        });

        setRecommendations((prev) =>
          prev.map((rec) => (rec.id === id ? { ...rec, status } : rec))
        );
      } catch (err) {
        console.error('Failed to update recommendation:', err);
      }
    },
    []
  );

  useEffect(() => {
    fetchRecommendations();
  }, [fetchRecommendations]);

  return {
    recommendations,
    isLoading,
    updateStatus,
    refresh: fetchRecommendations,
    critical: recommendations.filter((r) => r.priority === 'critical'),
    high: recommendations.filter((r) => r.priority === 'high'),
  };
}

/**
 * Hook for anomaly detection
 */
export function useAnomalyDetection(metric: 'gdpr' | 'security' | 'performance') {
  const [anomalies, setAnomalies] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const detectAnomalies = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/compliance/trends?days=90`);
      if (!response.ok) throw new Error('Failed to fetch trends');

      const data = await response.json();
      const metricData = data[`${metric}Trend`] || [];

      const detected = TrendAnalyzer.detectAnomalies(metricData);
      setAnomalies(detected);
    } catch (err) {
      console.error('Failed to detect anomalies:', err);
    } finally {
      setIsLoading(false);
    }
  }, [metric]);

  useEffect(() => {
    detectAnomalies();
  }, [detectAnomalies]);

  return {
    anomalies,
    isLoading,
    hasAnomalies: anomalies.length > 0,
    redetect: detectAnomalies,
  };
}
