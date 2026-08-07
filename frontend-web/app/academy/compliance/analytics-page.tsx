'use client';

import React, { useState } from 'react';
import {
  HealthScoreCard,
  KPICard,
  InsightCard,
  BenchmarkCard,
  TrendVisualization,
} from './analytics';
import {
  useComplianceAnalytics,
  useKPIs,
  useComplianceInsights,
  useBenchmarks,
  useHistoricalData,
} from '@/hooks/useComplianceAnalytics';

export default function AnalyticsDashboardPage() {
  const [dateRange, setDateRange] = useState(30);
  const analytics = useComplianceAnalytics();
  const kpis = useKPIs();
  const insights = useComplianceInsights();
  const benchmarks = useBenchmarks();
  const historical = useHistoricalData(dateRange);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <h1 className="text-3xl font-bold text-gray-900">Compliance Analytics</h1>
          <p className="text-gray-600 mt-1">Strategic insights and business intelligence</p>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Health Score */}
        {analytics.healthScore && (
          <div className="mb-8">
            <HealthScoreCard
              score={analytics.healthScore.score}
              status={analytics.healthScore.status}
              trend={analytics.healthScore.trend}
            />
          </div>
        )}

        {/* KPIs Grid */}
        {kpis.kpis.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Key Performance Indicators</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {kpis.kpis.map((kpi) => (
                <KPICard key={kpi.id} kpi={kpi} />
              ))}
            </div>
          </div>
        )}

        {/* Insights */}
        {insights.insights.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Insights & Recommendations</h2>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              {insights.insights.slice(0, 6).map((insight) => (
                <InsightCard key={insight.id} insight={insight} />
              ))}
            </div>
          </div>
        )}

        {/* Benchmarks */}
        {benchmarks.benchmarks.length > 0 && (
          <div className="mb-8">
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Industry Benchmarks</h2>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {benchmarks.benchmarks.map((benchmark, idx) => (
                <BenchmarkCard key={idx} benchmark={benchmark} />
              ))}
            </div>
          </div>
        )}

        {/* Trends */}
        {analytics.trends && historical.data && (
          <div>
            <h2 className="text-2xl font-bold text-gray-900 mb-4">Compliance Trends</h2>
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              <TrendVisualization
                dates={historical.data.dates || []}
                data={historical.data.gdpr || []}
                title="GDPR Compliance Trend"
              />
              <TrendVisualization
                dates={historical.data.dates || []}
                data={historical.data.security || []}
                title="Security Score Trend"
              />
              <TrendVisualization
                dates={historical.data.dates || []}
                data={historical.data.performance || []}
                title="Performance Trend"
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
