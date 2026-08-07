'use client';

import React from 'react';
import type { ComplianceForecast, TrendAnalysis, Forecast } from '@/lib/compliance/trendAnalysis';

/**
 * Forecast Card Component
 */
export function ForecastCard({ forecast }: { forecast: ComplianceForecast }) {
  const getMetricIcon = (metric: string) => {
    switch (metric) {
      case 'gdpr':
        return '📋';
      case 'security':
        return '🔒';
      case 'performance':
        return '⚡';
      default:
        return '📊';
    }
  };

  const getScoreColor = (score: number) => {
    if (score >= 85) return 'text-green-600';
    if (score >= 70) return 'text-yellow-600';
    if (score >= 50) return 'text-orange-600';
    return 'text-red-600';
  };

  const getBgColor = (score: number) => {
    if (score >= 85) return 'bg-green-50';
    if (score >= 70) return 'bg-yellow-50';
    if (score >= 50) return 'bg-orange-50';
    return 'bg-red-50';
  };

  const lastForecast = forecast.forecasts[forecast.forecasts.length - 1];

  return (
    <div className={`rounded-lg p-6 border-2 border-gray-200 ${getBgColor(forecast.currentScore)}`}>
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-2">
          <span className="text-2xl">{getMetricIcon(forecast.metric)}</span>
          <h3 className="text-xl font-bold text-gray-900 capitalize">{forecast.metric}</h3>
        </div>
        {forecast.escalationWarning && (
          <span className="px-3 py-1 bg-red-500 text-white rounded-full text-xs font-semibold">
            ⚠️ High Risk
          </span>
        )}
      </div>

      {/* Current Score */}
      <div className="mb-4">
        <p className="text-sm text-gray-600 mb-1">Current Score</p>
        <p className={`text-3xl font-bold ${getScoreColor(forecast.currentScore)}`}>
          {forecast.currentScore}%
        </p>
      </div>

      {/* Trend Indicator */}
      <div className="mb-4 flex items-center gap-2">
        <span className="text-sm text-gray-600">Trend:</span>
        <span
          className={`text-lg font-semibold ${
            forecast.trend.direction === 'up'
              ? 'text-green-600'
              : forecast.trend.direction === 'down'
                ? 'text-red-600'
                : 'text-gray-600'
          }`}
        >
          {forecast.trend.direction === 'up' && '📈 Improving'}
          {forecast.trend.direction === 'down' && '📉 Declining'}
          {forecast.trend.direction === 'stable' && '➡️ Stable'}
        </span>
        <span className="text-xs text-gray-600">
          ({forecast.trend.changePercent > 0 ? '+' : ''}
          {forecast.trend.changePercent.toFixed(1)}%)
        </span>
      </div>

      {/* 30-Day Forecast */}
      {lastForecast && (
        <div className="bg-white rounded p-3 mb-4">
          <p className="text-xs text-gray-600 mb-2">30-Day Forecast</p>
          <div className="flex justify-between items-center">
            <div>
              <p className="text-sm font-semibold text-gray-900">
                Predicted: {lastForecast.predictedScore}%
              </p>
              <p className="text-xs text-gray-600 mt-1">
                Confidence: {(lastForecast.confidenceLevel * 100).toFixed(0)}%
              </p>
            </div>
            <span
              className={`px-3 py-1 rounded-full text-xs font-semibold ${
                lastForecast.riskLevel === 'critical'
                  ? 'bg-red-500 text-white'
                  : lastForecast.riskLevel === 'high'
                    ? 'bg-orange-500 text-white'
                    : lastForecast.riskLevel === 'medium'
                      ? 'bg-yellow-500 text-white'
                      : 'bg-green-500 text-white'
              }`}
            >
              {lastForecast.riskLevel.toUpperCase()}
            </span>
          </div>
        </div>
      )}

      {/* Risk Factors */}
      {forecast.riskFactors.length > 0 && (
        <div className="mb-4">
          <p className="text-xs font-semibold text-gray-700 mb-2">Risk Factors:</p>
          <ul className="space-y-1">
            {forecast.riskFactors.slice(0, 3).map((factor, idx) => (
              <li key={idx} className="text-xs text-gray-700 flex items-start gap-2">
                <span className="mt-1">⚠️</span>
                <span>{factor}</span>
              </li>
            ))}
            {forecast.riskFactors.length > 3 && (
              <li className="text-xs text-gray-600">+{forecast.riskFactors.length - 3} more</li>
            )}
          </ul>
        </div>
      )}

      {/* Action Items */}
      {forecast.actionItems.length > 0 && (
        <div className="border-t pt-3">
          <p className="text-xs font-semibold text-gray-700 mb-2">Actions Required:</p>
          <ul className="space-y-1">
            {forecast.actionItems.map((item, idx) => (
              <li key={idx} className="text-xs text-gray-700 flex items-start gap-2">
                <span className="mt-0.5">→</span>
                <span>{item}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Trend Chart Component
 */
export function TrendChart({ forecasts }: { forecasts: Forecast[] }) {
  if (forecasts.length === 0) {
    return <p className="text-gray-600 text-center py-8">No forecast data available</p>;
  }

  const maxScore = 100;
  const minScore = 0;
  const range = maxScore - minScore;
  const chartHeight = 200;

  // Calculate Y positions
  const points = forecasts.map((f) => {
    const yPercent = ((f.predictedScore - minScore) / range) * 100;
    const y = chartHeight - (yPercent / 100) * chartHeight;
    return { ...f, y };
  });

  // Create path
  const pathData = points
    .map((p, idx) => `${(idx / (points.length - 1)) * 100}% ${p.y}`)
    .join(' ');

  return (
    <div className="bg-white rounded-lg p-4">
      <p className="text-sm font-semibold text-gray-900 mb-4">30-Day Forecast Trend</p>

      <svg className="w-full h-48 border border-gray-200 rounded" viewBox="0 0 100 200">
        {/* Grid lines */}
        <line x1="0" y1="50" x2="100" y2="50" stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="2" />
        <line x1="0" y1="100" x2="100" y2="100" stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="2" />
        <line x1="0" y1="150" x2="100" y2="150" stroke="#e5e7eb" strokeWidth="0.5" strokeDasharray="2" />

        {/* Axis labels */}
        <text x="2" y="55" fontSize="8" fill="#999">
          75%
        </text>
        <text x="2" y="105" fontSize="8" fill="#999">
          50%
        </text>
        <text x="2" y="155" fontSize="8" fill="#999">
          25%
        </text>

        {/* Line chart */}
        <polyline
          points={points.map((p, idx) => `${(idx / (points.length - 1)) * 100},${p.y}`).join(' ')}
          fill="none"
          stroke="#3b82f6"
          strokeWidth="2"
        />

        {/* Data points */}
        {points.map((p, idx) => (
          <circle
            key={idx}
            cx={(idx / (points.length - 1)) * 100}
            cy={p.y}
            r="1.5"
            fill={
              p.riskLevel === 'critical'
                ? '#ef4444'
                : p.riskLevel === 'high'
                  ? '#f97316'
                  : p.riskLevel === 'medium'
                    ? '#eab308'
                    : '#10b981'
            }
          />
        ))}
      </svg>

      {/* Legend */}
      <div className="flex justify-center gap-4 mt-3 text-xs">
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-green-500 rounded-full"></div>
          <span>Low Risk</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-yellow-500 rounded-full"></div>
          <span>Medium</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-orange-500 rounded-full"></div>
          <span>High</span>
        </div>
        <div className="flex items-center gap-1">
          <div className="w-3 h-3 bg-red-500 rounded-full"></div>
          <span>Critical</span>
        </div>
      </div>
    </div>
  );
}

/**
 * Composite Risk Indicator
 */
export function CompositeRiskIndicator({
  overallRisk,
  escalationNeeded,
  highestRiskCategory,
  riskFactors,
}: {
  overallRisk: number;
  escalationNeeded: boolean;
  highestRiskCategory: string;
  riskFactors: string[];
}) {
  const getRiskColor = (risk: number) => {
    if (risk < 25) return 'bg-green-500';
    if (risk < 40) return 'bg-yellow-500';
    if (risk < 60) return 'bg-orange-500';
    return 'bg-red-500';
  };

  const getRiskBgColor = (risk: number) => {
    if (risk < 25) return 'bg-green-50';
    if (risk < 40) return 'bg-yellow-50';
    if (risk < 60) return 'bg-orange-50';
    return 'bg-red-50';
  };

  const getRiskLabel = (risk: number) => {
    if (risk < 25) return 'LOW RISK';
    if (risk < 40) return 'MODERATE RISK';
    if (risk < 60) return 'HIGH RISK';
    return 'CRITICAL RISK';
  };

  return (
    <div className={`rounded-lg p-6 ${getRiskBgColor(overallRisk)} border-2 border-gray-200`}>
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Composite Compliance Risk</h2>

      {/* Risk Meter */}
      <div className="mb-6">
        <div className="flex justify-between items-end mb-2">
          <span className="text-3xl font-bold text-gray-900">{overallRisk.toFixed(0)}%</span>
          <span className={`text-lg font-bold ${getRiskColor(overallRisk)} px-3 py-1 rounded text-white`}>
            {getRiskLabel(overallRisk)}
          </span>
        </div>

        {/* Progress Bar */}
        <div className="w-full bg-gray-300 rounded-full h-4">
          <div
            className={`h-4 rounded-full ${getRiskColor(overallRisk)}`}
            style={{ width: `${Math.min(overallRisk, 100)}%` }}
          />
        </div>
      </div>

      {/* Critical Alert */}
      {escalationNeeded && (
        <div className="bg-red-100 border-l-4 border-red-500 p-4 mb-6 rounded">
          <p className="font-semibold text-red-900 mb-1">🚨 Escalation Required</p>
          <p className="text-sm text-red-800">
            Highest risk category: <strong>{highestRiskCategory}</strong>
          </p>
        </div>
      )}

      {/* Risk Factors */}
      {riskFactors.length > 0 && (
        <div>
          <p className="font-semibold text-gray-900 mb-3">Key Risk Factors:</p>
          <ul className="space-y-2">
            {riskFactors.map((factor, idx) => (
              <li key={idx} className="flex items-start gap-2 text-sm text-gray-700">
                <span className="mt-1">⚠️</span>
                <span>{factor}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

/**
 * Action Plan Component
 */
export function ActionPlan({
  priority,
  timeframe,
  actions,
}: {
  priority: 'low' | 'medium' | 'high' | 'critical';
  timeframe: string;
  actions: Array<{ action: string; priority: string; daysToComplete: number }>;
}) {
  const getPriorityColor = (p: string) => {
    switch (p) {
      case 'critical':
        return 'bg-red-100 text-red-900 border-l-4 border-red-500';
      case 'high':
        return 'bg-orange-100 text-orange-900 border-l-4 border-orange-500';
      case 'medium':
        return 'bg-yellow-100 text-yellow-900 border-l-4 border-yellow-500';
      default:
        return 'bg-green-100 text-green-900 border-l-4 border-green-500';
    }
  };

  const getPriorityIcon = (p: string) => {
    switch (p) {
      case 'critical':
        return '🚨';
      case 'high':
        return '⚠️';
      case 'medium':
        return '⏱️';
      default:
        return '✓';
    }
  };

  return (
    <div className="bg-white rounded-lg p-6 border-2 border-gray-200">
      <h2 className="text-2xl font-bold text-gray-900 mb-4">Action Plan</h2>

      {/* Priority & Timeframe */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-gray-50 p-3 rounded">
          <p className="text-xs text-gray-600 mb-1">Priority Level</p>
          <p className="text-lg font-bold text-gray-900 capitalize">{priority}</p>
        </div>
        <div className="bg-gray-50 p-3 rounded">
          <p className="text-xs text-gray-600 mb-1">Recommended Timeframe</p>
          <p className="text-lg font-bold text-gray-900">{timeframe}</p>
        </div>
      </div>

      {/* Actions */}
      <div>
        <p className="font-semibold text-gray-900 mb-3">Recommended Actions:</p>
        <div className="space-y-3">
          {actions.map((item, idx) => (
            <div key={idx} className={`p-4 rounded ${getPriorityColor(item.priority)}`}>
              <div className="flex justify-between items-start mb-2">
                <div className="flex items-start gap-2 flex-1">
                  <span className="text-lg">{getPriorityIcon(item.priority)}</span>
                  <p className="font-semibold">{item.action}</p>
                </div>
                <span className="text-xs font-semibold px-2 py-1 bg-white bg-opacity-50 rounded">
                  {item.daysToComplete} days
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Anomaly Alert Component
 */
export function AnomalyAlert({ anomalies }: { anomalies: string[] }) {
  if (anomalies.length === 0) {
    return (
      <div className="bg-green-50 border-l-4 border-green-500 p-4 rounded">
        <p className="text-green-900 font-semibold">✓ No anomalies detected</p>
        <p className="text-sm text-green-800">Metrics are operating normally</p>
      </div>
    );
  }

  return (
    <div className="bg-red-50 border-l-4 border-red-500 p-4 rounded">
      <p className="text-red-900 font-semibold mb-3">Anomalies Detected</p>
      <ul className="space-y-2">
        {anomalies.map((anomaly, idx) => (
          <li key={idx} className="text-sm text-red-800 flex items-start gap-2">
            <span className="mt-1">⚠️</span>
            <span>{anomaly}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
