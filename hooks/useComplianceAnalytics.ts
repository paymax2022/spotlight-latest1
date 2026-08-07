'use client';

import { useCallback, useEffect, useState } from 'react';
import { getAnalyticsEngine } from '@/lib/compliance/analyticsEngine';
import type { TrendAnalysis, KPI, ComplianceInsight, BenchmarkData } from '@/lib/compliance/analyticsEngine';

/**
 * Hook for compliance analytics
 */
export function useComplianceAnalytics() {
  const [healthScore, setHealthScore] = useState<any>(null);
  const [trends, setTrends] = useState<Record<string, TrendAnalysis>>({});
  const [statistics, setStatistics] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const engine = getAnalyticsEngine();

  const fetchAnalytics = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/compliance/analytics');
      if (!response.ok) throw new Error('Failed to fetch analytics');

      const data = await response.json();

      setHealthScore(data.healthScore || engine.getComplianceHealthScore());
      setStatistics(data.statistics || engine.getStatistics());

      const trendData = {
        gdpr: engine.calculateTrend('gdpr'),
        security: engine.calculateTrend('security'),
        performance: engine.calculateTrend('performance'),
      };
      setTrends(trendData);
    } catch (err) {
      console.error('Failed to fetch analytics:', err);
    } finally {
      setIsLoading(false);
    }
  }, [engine]);

  useEffect(() => {
    fetchAnalytics();
  }, [fetchAnalytics]);

  return {
    healthScore,
    trends,
    statistics,
    isLoading,
    refresh: fetchAnalytics,
  };
}

/**
 * Hook for KPIs
 */
export function useKPIs() {
  const [kpis, setKpis] = useState<KPI[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchKPIs = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/compliance/kpis');
      if (!response.ok) throw new Error('Failed to fetch KPIs');

      const data = await response.json();
      setKpis(data.kpis || []);
    } catch (err) {
      console.error('Failed to fetch KPIs:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchKPIs();
  }, [fetchKPIs]);

  return {
    kpis,
    isLoading,
    onTrack: kpis.filter((k) => k.status === 'on_track'),
    atRisk: kpis.filter((k) => k.status === 'at_risk'),
    critical: kpis.filter((k) => k.status === 'critical'),
  };
}

/**
 * Hook for insights
 */
export function useComplianceInsights() {
  const [insights, setInsights] = useState<ComplianceInsight[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchInsights = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/compliance/insights');
      if (!response.ok) throw new Error('Failed to fetch insights');

      const data = await response.json();
      setInsights(data.insights || []);
    } catch (err) {
      console.error('Failed to fetch insights:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInsights();
  }, [fetchInsights]);

  return {
    insights,
    isLoading,
    risks: insights.filter((i) => i.category === 'risk'),
    opportunities: insights.filter((i) => i.category === 'opportunity'),
    trends: insights.filter((i) => i.category === 'trend'),
    anomalies: insights.filter((i) => i.category === 'anomaly'),
  };
}

/**
 * Hook for benchmarks
 */
export function useBenchmarks() {
  const [benchmarks, setBenchmarks] = useState<BenchmarkData[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const fetchBenchmarks = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/compliance/benchmarks');
      if (!response.ok) throw new Error('Failed to fetch benchmarks');

      const data = await response.json();
      setBenchmarks(data.benchmarks || []);
    } catch (err) {
      console.error('Failed to fetch benchmarks:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchBenchmarks();
  }, [fetchBenchmarks]);

  return {
    benchmarks,
    isLoading,
    aboveAverage: benchmarks.filter((b) => b.yourScore > b.industryAverage),
    belowAverage: benchmarks.filter((b) => b.yourScore < b.industryAverage),
  };
}

/**
 * Hook for historical data
 */
export function useHistoricalData(days: number = 30) {
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/compliance/historical?days=${days}`);
      if (!response.ok) throw new Error('Failed to fetch historical data');

      const responseData = await response.json();
      setData(responseData.data);
    } catch (err) {
      console.error('Failed to fetch historical data:', err);
    } finally {
      setIsLoading(false);
    }
  }, [days]);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  return {
    data,
    isLoading,
  };
}
