'use client';

import { useCallback, useEffect, useState } from 'react';
import type { ComplianceReport, GDPRMetrics, SecurityMetrics, PerformanceReportData } from '@/lib/compliance/reportGenerator';

/**
 * Compliance Dashboard Filter Options
 */
export interface DashboardFilters {
  dateRange: 'today' | 'week' | 'month' | 'quarter' | 'year' | 'custom';
  customStartDate?: number;
  customEndDate?: number;
  reportTypes: string[];
}

/**
 * Compliance Dashboard State
 */
export interface DashboardState {
  gdprMetrics: GDPRMetrics | null;
  securityMetrics: SecurityMetrics | null;
  performanceData: PerformanceReportData | null;
  reports: ComplianceReport[];
  isLoading: boolean;
  error: string | null;
}

/**
 * Hook for managing compliance dashboard state
 */
export function useComplianceDashboard() {
  const [state, setState] = useState<DashboardState>({
    gdprMetrics: null,
    securityMetrics: null,
    performanceData: null,
    reports: [],
    isLoading: false,
    error: null,
  });

  const [filters, setFilters] = useState<DashboardFilters>({
    dateRange: 'month',
    reportTypes: [],
  });

  /**
   * Fetch compliance metrics from server
   */
  const fetchMetrics = useCallback(async () => {
    setState((prev) => ({ ...prev, isLoading: true, error: null }));

    try {
      const params = new URLSearchParams({
        dateRange: filters.dateRange,
        ...(filters.customStartDate && { startDate: filters.customStartDate.toString() }),
        ...(filters.customEndDate && { endDate: filters.customEndDate.toString() }),
      });

      const response = await fetch(`/api/compliance/metrics?${params}`);
      if (!response.ok) throw new Error('Failed to fetch metrics');

      const data = await response.json();
      setState((prev) => ({
        ...prev,
        gdprMetrics: data.gdprMetrics,
        securityMetrics: data.securityMetrics,
        performanceData: data.performanceData,
        isLoading: false,
      }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch metrics';
      setState((prev) => ({ ...prev, error: errorMsg, isLoading: false }));
    }
  }, [filters]);

  /**
   * Fetch compliance reports
   */
  const fetchReports = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        dateRange: filters.dateRange,
        ...(filters.reportTypes.length > 0 && { types: filters.reportTypes.join(',') }),
      });

      const response = await fetch(`/api/compliance/reports?${params}`);
      if (!response.ok) throw new Error('Failed to fetch reports');

      const data = await response.json();
      setState((prev) => ({ ...prev, reports: data.reports }));
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch reports';
      setState((prev) => ({ ...prev, error: errorMsg }));
    }
  }, [filters]);

  /**
   * Update filters
   */
  const updateFilters = useCallback((newFilters: Partial<DashboardFilters>) => {
    setFilters((prev) => ({ ...prev, ...newFilters }));
  }, []);

  /**
   * Refresh all data
   */
  const refreshData = useCallback(async () => {
    await Promise.all([fetchMetrics(), fetchReports()]);
  }, [fetchMetrics, fetchReports]);

  /**
   * Auto-fetch on filter change
   */
  useEffect(() => {
    refreshData();
  }, [refreshData]);

  return {
    ...state,
    filters,
    updateFilters,
    refreshData,
    setDateRange: (range: DashboardFilters['dateRange']) => updateFilters({ dateRange: range }),
    setReportTypeFilter: (types: string[]) => updateFilters({ reportTypes: types }),
    setCustomDateRange: (startDate: number, endDate: number) =>
      updateFilters({ dateRange: 'custom', customStartDate: startDate, customEndDate: endDate }),
  };
}

/**
 * Hook for real-time compliance alerts
 */
export function useComplianceAlerts() {
  const [alerts, setAlerts] = useState<Array<{
    id: string;
    type: 'critical' | 'warning' | 'info';
    message: string;
    timestamp: number;
  }>>([]);

  const [isWatching, setIsWatching] = useState(false);

  useEffect(() => {
    if (!isWatching) return;

    const pollAlerts = async () => {
      try {
        const response = await fetch('/api/compliance/alerts?limit=10');
        if (!response.ok) return;

        const data = await response.json();
        setAlerts(data.alerts);
      } catch (err) {
        console.error('Failed to fetch alerts:', err);
      }
    };

    const interval = setInterval(pollAlerts, 30000); // Poll every 30 seconds
    pollAlerts(); // Initial fetch

    return () => clearInterval(interval);
  }, [isWatching]);

  const dismissAlert = useCallback((id: string) => {
    setAlerts((prev) => prev.filter((alert) => alert.id !== id));
  }, []);

  const startWatching = useCallback(() => {
    setIsWatching(true);
  }, []);

  const stopWatching = useCallback(() => {
    setIsWatching(false);
  }, []);

  return {
    alerts,
    dismissAlert,
    startWatching,
    stopWatching,
    isWatching,
  };
}

/**
 * Hook for compliance trends
 */
export function useComplianceTrends() {
  const [trends, setTrends] = useState<{
    gdprTrend: Array<{ date: string; score: number }>;
    securityTrend: Array<{ date: string; score: number }>;
    performanceTrend: Array<{ date: string; score: number }>;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);

  const fetchTrends = useCallback(async (days: number = 30) => {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/compliance/trends?days=${days}`);
      if (!response.ok) throw new Error('Failed to fetch trends');

      const data = await response.json();
      setTrends(data);
    } catch (err) {
      console.error('Failed to fetch trends:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTrends();
  }, [fetchTrends]);

  return {
    trends,
    isLoading,
    fetchTrends,
  };
}

/**
 * Hook for compliance report scheduling
 */
export function useComplianceScheduling() {
  const [schedules, setSchedules] = useState<Array<{
    id: string;
    reportType: string;
    frequency: 'daily' | 'weekly' | 'monthly';
    recipients: string[];
    nextRun: number;
    isActive: boolean;
  }>>([]);

  const [isLoading, setIsLoading] = useState(false);

  /**
   * Fetch scheduled reports
   */
  const fetchSchedules = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/compliance/schedules');
      if (!response.ok) throw new Error('Failed to fetch schedules');

      const data = await response.json();
      setSchedules(data.schedules);
    } catch (err) {
      console.error('Failed to fetch schedules:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create schedule
   */
  const createSchedule = useCallback(
    async (reportType: string, frequency: 'daily' | 'weekly' | 'monthly', recipients: string[]) => {
      try {
        const response = await fetch('/api/compliance/schedules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reportType, frequency, recipients }),
        });

        if (!response.ok) throw new Error('Failed to create schedule');

        await fetchSchedules();
        return true;
      } catch (err) {
        console.error('Failed to create schedule:', err);
        return false;
      }
    },
    [fetchSchedules]
  );

  /**
   * Update schedule
   */
  const updateSchedule = useCallback(
    async (id: string, updates: { frequency?: string; recipients?: string[]; isActive?: boolean }) => {
      try {
        const response = await fetch(`/api/compliance/schedules/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(updates),
        });

        if (!response.ok) throw new Error('Failed to update schedule');

        await fetchSchedules();
        return true;
      } catch (err) {
        console.error('Failed to update schedule:', err);
        return false;
      }
    },
    [fetchSchedules]
  );

  /**
   * Delete schedule
   */
  const deleteSchedule = useCallback(
    async (id: string) => {
      try {
        const response = await fetch(`/api/compliance/schedules/${id}`, { method: 'DELETE' });

        if (!response.ok) throw new Error('Failed to delete schedule');

        await fetchSchedules();
        return true;
      } catch (err) {
        console.error('Failed to delete schedule:', err);
        return false;
      }
    },
    [fetchSchedules]
  );

  /**
   * Trigger manual run
   */
  const runNow = useCallback(async (id: string) => {
    try {
      const response = await fetch(`/api/compliance/schedules/${id}/run`, { method: 'POST' });

      if (!response.ok) throw new Error('Failed to run schedule');

      return true;
    } catch (err) {
      console.error('Failed to run schedule:', err);
      return false;
    }
  }, []);

  useEffect(() => {
    fetchSchedules();
  }, [fetchSchedules]);

  return {
    schedules,
    isLoading,
    createSchedule,
    updateSchedule,
    deleteSchedule,
    runNow,
  };
}

/**
 * Hook for compliance export
 */
export function useComplianceExport() {
  const [isExporting, setIsExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const exportMetrics = useCallback(async (format: 'json' | 'csv' | 'excel') => {
    setIsExporting(true);
    setError(null);

    try {
      const response = await fetch(`/api/compliance/export?format=${format}`);

      if (!response.ok) throw new Error('Failed to export metrics');

      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `compliance-report-${new Date().toISOString().split('T')[0]}.${format === 'csv' ? 'csv' : format === 'excel' ? 'xlsx' : 'json'}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to export metrics';
      setError(errorMsg);
    } finally {
      setIsExporting(false);
    }
  }, []);

  return {
    isExporting,
    error,
    exportMetrics,
  };
}
