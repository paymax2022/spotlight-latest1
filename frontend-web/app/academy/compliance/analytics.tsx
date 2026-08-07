'use client';

import React from 'react';
import type { KPI, ComplianceInsight, BenchmarkData } from '@/lib/compliance/analyticsEngine';

/**
 * Health Score Card
 */
export function HealthScoreCard({
  score,
  status,
  trend,
}: {
  score: number;
  status: 'healthy' | 'needs_attention' | 'critical';
  trend: 'improving' | 'stable' | 'declining';
}) {
  const getStatusColor = (s: string) => {
    switch (s) {
      case 'healthy':
        return 'bg-green-100 text-green-900';
      case 'needs_attention':
        return 'bg-yellow-100 text-yellow-900';
      case 'critical':
        return 'bg-red-100 text-red-900';
      default:
        return 'bg-gray-100 text-gray-900';
    }
  };

  const getTrendIcon = (t: string) => {
    switch (t) {
      case 'improving':
        return '📈';
      case 'declining':
        return '📉';
      default:
        return '➡️';
    }
  };

  return (
    <div className={`rounded-lg p-6 ${getStatusColor(status)}`}>
      <h2 className="text-sm font-semibold opacity-80 mb-2">Compliance Health Score</h2>
      <div className="flex items-end justify-between">
        <p className="text-4xl font-bold">{score}%</p>
        <p className="text-lg">{getTrendIcon(trend)}</p>
      </div>
      <p className="text-xs opacity-75 mt-3 capitalize">Status: {status.replace('_', ' ')}</p>
    </div>
  );
}

/**
 * KPI Card
 */
export function KPICard({ kpi }: { kpi: KPI }) {
  const getStatusColor = (status: string) => {
    switch (status) {
      case 'on_track':
        return 'border-green-500 bg-green-50';
      case 'at_risk':
        return 'border-yellow-500 bg-yellow-50';
      case 'critical':
        return 'border-red-500 bg-red-50';
      default:
        return 'border-gray-500 bg-gray-50';
    }
  };

  const getTrendColor = (trend: string) => {
    switch (trend) {
      case 'up':
        return 'text-green-600';
      case 'down':
        return 'text-red-600';
      default:
        return 'text-gray-600';
    }
  };

  const getTrendIcon = (trend: string) => {
    switch (trend) {
      case 'up':
        return '📈';
      case 'down':
        return '📉';
      default:
        return '➡️';
    }
  };

  const progressPercent = (kpi.value / kpi.target) * 100;

  return (
    <div className={`rounded-lg border-l-4 p-4 ${getStatusColor(kpi.status)}`}>
      <div className="flex justify-between items-start mb-3">
        <h3 className="font-semibold text-gray-900">{kpi.name}</h3>
        <span className={`text-lg ${getTrendColor(kpi.trend)}`}>{getTrendIcon(kpi.trend)}</span>
      </div>

      <p className="text-2xl font-bold text-gray-900 mb-2">
        {kpi.value} <span className="text-sm text-gray-600">{kpi.unit}</span>
      </p>

      <p className="text-xs text-gray-600 mb-3">{kpi.description}</p>

      <div className="mb-3">
        <div className="flex justify-between text-xs mb-1">
          <span>Progress</span>
          <span>{Math.round(progressPercent)}%</span>
        </div>
        <div className="w-full bg-gray-300 rounded-full h-2">
          <div
            className={`h-2 rounded-full ${
              kpi.status === 'on_track' ? 'bg-green-500' : 'bg-yellow-500'
            }`}
            style={{ width: `${Math.min(progressPercent, 100)}%` }}
          />
        </div>
      </div>

      <p className="text-xs text-gray-600">Target: {kpi.target}{kpi.unit}</p>
    </div>
  );
}

/**
 * Insight Card
 */
export function InsightCard({ insight }: { insight: ComplianceInsight }) {
  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'risk':
        return '⚠️';
      case 'opportunity':
        return '💡';
      case 'trend':
        return '📈';
      case 'anomaly':
        return '🔍';
      default:
        return '📌';
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'border-red-500 bg-red-50';
      case 'high':
        return 'border-orange-500 bg-orange-50';
      case 'medium':
        return 'border-yellow-500 bg-yellow-50';
      default:
        return 'border-blue-500 bg-blue-50';
    }
  };

  return (
    <div className={`rounded-lg border-l-4 p-4 ${getPriorityColor(insight.priority)}`}>
      <div className="flex items-start gap-3 mb-2">
        <span className="text-2xl">{getCategoryIcon(insight.category)}</span>
        <div className="flex-1">
          <h3 className="font-semibold text-gray-900">{insight.title}</h3>
          <p className="text-xs text-gray-600 capitalize mt-1">{insight.category}</p>
        </div>
      </div>

      <p className="text-sm text-gray-700 mb-2">{insight.description}</p>

      <div className="bg-white bg-opacity-50 p-3 rounded mb-3">
        <p className="text-xs font-semibold text-gray-700 mb-1">Recommendation:</p>
        <p className="text-xs text-gray-700">{insight.recommendation}</p>
      </div>

      <p className="text-xs text-gray-600">Impact: {insight.impact}</p>
    </div>
  );
}

/**
 * Benchmark Comparison
 */
export function BenchmarkCard({ benchmark }: { benchmark: BenchmarkData }) {
  const isAboveAverage = benchmark.yourScore > benchmark.industryAverage;

  return (
    <div className="rounded-lg bg-white border-2 border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">{benchmark.metric}</h3>

      <div className="space-y-3">
        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Your Score</span>
            <span className="font-bold text-gray-900">{benchmark.yourScore}</span>
          </div>
          <div className="w-full bg-blue-200 rounded-full h-2">
            <div className="h-2 rounded-full bg-blue-600" style={{ width: '100%' }} />
          </div>
        </div>

        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Industry Avg</span>
            <span className="font-bold text-gray-900">{benchmark.industryAverage}</span>
          </div>
          <div
            className="w-full bg-gray-200 rounded-full h-2"
            style={{
              width: `${(benchmark.industryAverage / benchmark.yourScore) * 100}%`,
            }}
          />
        </div>

        <div>
          <div className="flex justify-between text-sm mb-1">
            <span className="text-gray-600">Industry Leader</span>
            <span className="font-bold text-gray-900">{benchmark.industryLeader}</span>
          </div>
          <div
            className="w-full bg-green-200 rounded-full h-2"
            style={{
              width: `${(benchmark.industryLeader / benchmark.yourScore) * 100}%`,
            }}
          />
        </div>
      </div>

      <div className="mt-4 pt-4 border-t">
        <p className="text-xs text-gray-600 mb-2">Percentile Rank</p>
        <p className="text-2xl font-bold text-gray-900">{benchmark.percentile}th</p>
        <p className={`text-xs mt-1 ${isAboveAverage ? 'text-green-600' : 'text-orange-600'}`}>
          {isAboveAverage ? '✓ Above Industry Average' : '⚠️ Below Industry Average'}
        </p>
      </div>
    </div>
  );
}

/**
 * Trend Visualization
 */
export function TrendVisualization({
  dates,
  data,
  title,
}: {
  dates: string[];
  data: number[];
  title: string;
}) {
  const maxValue = Math.max(...data);
  const minValue = Math.min(...data);
  const range = maxValue - minValue || 1;

  return (
    <div className="bg-white rounded-lg border-2 border-gray-200 p-4">
      <h3 className="font-semibold text-gray-900 mb-4">{title}</h3>

      <svg className="w-full h-40" viewBox={`0 0 ${dates.length * 20} 150`}>
        {/* Grid */}
        <line x1="0" y1="150" x2={dates.length * 20} y2="150" stroke="#e5e7eb" strokeWidth="1" />

        {/* Line chart */}
        <polyline
          points={data
            .map((d, i) => {
              const y = 150 - ((d - minValue) / range) * 150;
              return `${i * 20 + 10},${y}`;
            })
            .join(' ')}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
        />

        {/* Points */}
        {data.map((d, i) => {
          const y = 150 - ((d - minValue) / range) * 150;
          return (
            <circle
              key={i}
              cx={i * 20 + 10}
              cy={y}
              r="3"
              fill="#3b82f6"
            />
          );
        })}
      </svg>

      <p className="text-xs text-gray-600 text-center mt-3">
        {dates[0]} → {dates[dates.length - 1]}
      </p>
    </div>
  );
}
