'use client';

import React, { useState, useMemo } from 'react';
import { ComplianceReport, ReportType, GDPRMetrics, SecurityMetrics, PerformanceReportData } from '@/lib/compliance/reportGenerator';

/**
 * GDPR Compliance Dashboard Component
 */
export function GDPRComplianceDashboard({ metrics }: { metrics: GDPRMetrics }) {
  const getScoreColor = (score: number) => {
    if (score >= 90) return 'bg-green-500';
    if (score >= 75) return 'bg-yellow-500';
    return 'bg-red-500';
  };

  const getComplianceStatus = (score: number) => {
    if (score >= 90) return 'COMPLIANT';
    if (score >= 75) return 'NEEDS ATTENTION';
    return 'NON-COMPLIANT';
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">GDPR Compliance</h2>

      {/* Score Card */}
      <div className="flex items-center justify-center">
        <div className="relative w-32 h-32">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="#e5e7eb"
              strokeWidth="8"
            />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="#3b82f6"
              strokeWidth="8"
              strokeDasharray={`${(metrics.complianceScore / 100) * 339.3} 339.3`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-gray-900">{metrics.complianceScore}%</span>
            <span className="text-xs text-gray-600">Score</span>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="text-center">
        <span
          className={`inline-block px-4 py-2 rounded-full text-white text-sm font-semibold ${getScoreColor(
            metrics.complianceScore
          )}`}
        >
          {getComplianceStatus(metrics.complianceScore)}
        </span>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-4">
        <MetricCard label="Data Requests" value={metrics.totalDataRequests} />
        <MetricCard label="Export Requests" value={metrics.exportRequests} />
        <MetricCard label="Deletion Requests" value={metrics.deletionRequests} />
        <MetricCard label="Consent Withdrawals" value={metrics.consentWithdrawals} />
        <MetricCard label="Data Breaches" value={metrics.dataBreaches} highlight={metrics.dataBreaches > 0} />
        <MetricCard label="Response Time (days)" value={metrics.averageResponseTime} />
      </div>

      {/* Recommendations */}
      <div className="bg-blue-50 border-l-4 border-blue-500 p-4">
        <p className="text-sm font-semibold text-blue-900 mb-2">Recommendations:</p>
        <ul className="text-sm text-blue-800 space-y-1">
          {metrics.complianceScore < 90 && (
            <li>• Improve compliance score by addressing user rights requests faster</li>
          )}
          {metrics.dataBreaches > 0 && <li>• Conduct post-incident review of data breach incidents</li>}
          {metrics.averageResponseTime > 30 && (
            <li>• Streamline data request process to meet 30-day GDPR deadline</li>
          )}
          {metrics.complianceScore >= 90 && metrics.dataBreaches === 0 && metrics.averageResponseTime <= 30 && (
            <li>• Continue current compliance practices</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * Security Posture Dashboard Component
 */
export function SecurityPostureDashboard({ metrics }: { metrics: SecurityMetrics }) {
  const failureRate = ((metrics.failedAuthAttempts / metrics.totalAuthAttempts) * 100).toFixed(1);

  const getSecurityStatus = (score: number) => {
    if (score >= 85) return { status: 'SECURE', color: 'bg-green-500' };
    if (score >= 70) return { status: 'CAUTION', color: 'bg-yellow-500' };
    return { status: 'AT RISK', color: 'bg-red-500' };
  };

  const { status, color } = getSecurityStatus(metrics.securityScore);

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Security Posture</h2>

      {/* Score Card */}
      <div className="flex items-center justify-center">
        <div className="relative w-32 h-32">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="#e5e7eb" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="#ef4444"
              strokeWidth="8"
              strokeDasharray={`${(metrics.securityScore / 100) * 339.3} 339.3`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-gray-900">{metrics.securityScore}%</span>
            <span className="text-xs text-gray-600">Score</span>
          </div>
        </div>
      </div>

      {/* Status */}
      <div className="text-center">
        <span className={`inline-block px-4 py-2 rounded-full text-white text-sm font-semibold ${color}`}>
          {status}
        </span>
      </div>

      {/* Metrics Grid */}
      <div className="grid grid-cols-2 gap-4">
        <MetricCard label="Auth Attempts" value={metrics.totalAuthAttempts} />
        <MetricCard label="Failed Attempts" value={metrics.failedAuthAttempts} highlight={parseFloat(failureRate) > 10} />
        <MetricCard label="Anomalies" value={metrics.anomaliesDetected} />
        <MetricCard label="Resolved" value={metrics.anomaliesResolved} />
        <MetricCard label="Critical Issues" value={metrics.criticalIncidents} highlight={metrics.criticalIncidents > 0} />
        <MetricCard label="MTTR (min)" value={metrics.mttr} />
      </div>

      {/* Failure Rate Bar */}
      <div className="space-y-2">
        <div className="flex justify-between text-sm">
          <span className="text-gray-700">Failure Rate</span>
          <span className="font-semibold text-gray-900">{failureRate}%</span>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2">
          <div
            className={`h-2 rounded-full ${parseFloat(failureRate) > 10 ? 'bg-red-500' : 'bg-green-500'}`}
            style={{ width: `${Math.min(parseFloat(failureRate), 100)}%` }}
          />
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-red-50 border-l-4 border-red-500 p-4">
        <p className="text-sm font-semibold text-red-900 mb-2">Recommendations:</p>
        <ul className="text-sm text-red-800 space-y-1">
          {metrics.criticalIncidents > 0 && (
            <li>• Investigate and remediate critical security incidents immediately</li>
          )}
          {metrics.securityScore < 80 && <li>• Increase monitoring and alerting thresholds</li>}
          {metrics.mttr > 60 && <li>• Improve incident response procedures to reduce MTTR</li>}
          {parseFloat(failureRate) > 10 && <li>• Review authentication system for potential issues</li>}
          {metrics.securityScore >= 85 && metrics.criticalIncidents === 0 && (
            <li>• Maintain current security posture and continue monitoring</li>
          )}
        </ul>
      </div>
    </div>
  );
}

/**
 * Performance Metrics Dashboard Component
 */
export function PerformanceDashboard({ data }: { data: PerformanceReportData }) {
  const getMetricStatus = (value: number, target: number, lowerIsBetter = true) => {
    if (lowerIsBetter) {
      return value <= target ? 'text-green-600' : value <= target * 1.5 ? 'text-yellow-600' : 'text-red-600';
    } else {
      return value >= target ? 'text-green-600' : value >= target * 0.9 ? 'text-yellow-600' : 'text-red-600';
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Performance Metrics</h2>

      {/* Web Vitals Score */}
      <div className="flex items-center justify-center">
        <div className="relative w-32 h-32">
          <svg className="w-full h-full transform -rotate-90" viewBox="0 0 120 120">
            <circle cx="60" cy="60" r="54" fill="none" stroke="#e5e7eb" strokeWidth="8" />
            <circle
              cx="60"
              cy="60"
              r="54"
              fill="none"
              stroke="#10b981"
              strokeWidth="8"
              strokeDasharray={`${(data.performanceScore / 100) * 339.3} 339.3`}
              strokeLinecap="round"
            />
          </svg>
          <div className="absolute inset-0 flex flex-col items-center justify-center">
            <span className="text-3xl font-bold text-gray-900">{data.performanceScore}%</span>
            <span className="text-xs text-gray-600">Score</span>
          </div>
        </div>
      </div>

      {/* Web Vitals Metrics */}
      <div className="space-y-4">
        <WebVitalMetric
          label="LCP (Largest Contentful Paint)"
          value={data.averageLCP}
          unit="ms"
          target={2500}
          statusClass={getMetricStatus(data.averageLCP, 2500)}
        />
        <WebVitalMetric
          label="FID (First Input Delay)"
          value={data.averageFID}
          unit="ms"
          target={100}
          statusClass={getMetricStatus(data.averageFID, 100)}
        />
        <WebVitalMetric
          label="CLS (Cumulative Layout Shift)"
          value={data.averageCLS}
          unit=""
          target={0.1}
          statusClass={getMetricStatus(data.averageCLS, 0.1)}
        />
      </div>

      {/* System Metrics */}
      <div className="border-t pt-4 space-y-4">
        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">Uptime</span>
            <span className={`font-semibold ${getMetricStatus(data.uptime, 99.9, false)}`}>{data.uptime.toFixed(2)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="h-2 rounded-full bg-green-500"
              style={{ width: `${Math.min(data.uptime, 100)}%` }}
            />
          </div>
        </div>

        <div className="space-y-2">
          <div className="flex justify-between text-sm">
            <span className="text-gray-700">Error Rate</span>
            <span className={`font-semibold ${getMetricStatus(data.errorRate, 0.1)}`}>{data.errorRate.toFixed(2)}%</span>
          </div>
          <div className="w-full bg-gray-200 rounded-full h-2">
            <div
              className="h-2 rounded-full bg-blue-500"
              style={{ width: `${Math.min(data.errorRate * 10, 100)}%` }}
            />
          </div>
        </div>
      </div>

      {/* Recommendations */}
      <div className="bg-green-50 border-l-4 border-green-500 p-4">
        <p className="text-sm font-semibold text-green-900 mb-2">Recommendations:</p>
        <ul className="text-sm text-green-800 space-y-1">
          {data.averageLCP > 2500 && <li>• Optimize LCP: reduce server response time and critical path resources</li>}
          {data.averageFID > 100 && <li>• Optimize FID: reduce JavaScript execution time</li>}
          {data.averageCLS > 0.1 && <li>• Improve CLS: stabilize layout shifts with explicit dimensions</li>}
          {data.uptime < 99.9 && <li>• Improve infrastructure reliability to achieve 99.9% uptime target</li>}
          {data.errorRate > 0.1 && <li>• Investigate and fix error sources to reduce error rate</li>}
          {data.performanceScore >= 90 && <li>• Maintain current performance standards</li>}
        </ul>
      </div>
    </div>
  );
}

/**
 * Compliance Overview Dashboard
 */
export function ComplianceOverview({
  gdpr,
  security,
  performance,
}: {
  gdpr: GDPRMetrics;
  security: SecurityMetrics;
  performance: PerformanceReportData;
}) {
  const scores = [
    { name: 'GDPR', score: gdpr.complianceScore, color: 'bg-blue-500' },
    { name: 'Security', score: security.securityScore, color: 'bg-red-500' },
    { name: 'Performance', score: performance.performanceScore, color: 'bg-green-500' },
  ];

  const overallScore = Math.round((gdpr.complianceScore + security.securityScore + performance.performanceScore) / 3);

  return (
    <div className="bg-white rounded-lg shadow-lg p-6 space-y-6">
      <h2 className="text-2xl font-bold text-gray-900">Compliance Overview</h2>

      {/* Overall Score */}
      <div className="bg-gradient-to-r from-blue-500 to-purple-600 rounded-lg p-6 text-white">
        <p className="text-sm font-semibold opacity-90">Overall Compliance Score</p>
        <p className="text-4xl font-bold">{overallScore}%</p>
      </div>

      {/* Score Breakdown */}
      <div className="space-y-4">
        {scores.map((item) => (
          <div key={item.name}>
            <div className="flex justify-between items-center mb-2">
              <span className="text-sm font-semibold text-gray-700">{item.name}</span>
              <span className="text-lg font-bold text-gray-900">{item.score}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-3">
              <div className={`h-3 rounded-full ${item.color}`} style={{ width: `${item.score}%` }} />
            </div>
          </div>
        ))}
      </div>

      {/* Key Metrics Summary */}
      <div className="grid grid-cols-3 gap-4 border-t pt-4">
        <SummaryCard label="Breaches" value={gdpr.dataBreaches} critical={gdpr.dataBreaches > 0} />
        <SummaryCard label="Incidents" value={security.criticalIncidents} critical={security.criticalIncidents > 0} />
        <SummaryCard label="Errors" value={`${performance.errorRate.toFixed(2)}%`} />
      </div>

      {/* Status Indicator */}
      <div className="text-center pt-4">
        <div
          className={`inline-block px-6 py-2 rounded-full text-white font-semibold text-sm ${
            overallScore >= 90
              ? 'bg-green-500'
              : overallScore >= 75
                ? 'bg-yellow-500'
                : 'bg-red-500'
          }`}
        >
          {overallScore >= 90 ? '✓ COMPLIANT' : overallScore >= 75 ? '⚠ NEEDS ATTENTION' : '✕ NON-COMPLIANT'}
        </div>
      </div>
    </div>
  );
}

/**
 * Metric Card Component
 */
function MetricCard({ label, value, highlight = false }: { label: string; value: number | string; highlight?: boolean }) {
  return (
    <div className={`p-4 rounded-lg border-2 ${highlight ? 'border-red-300 bg-red-50' : 'border-gray-200 bg-gray-50'}`}>
      <p className="text-xs text-gray-600 mb-1">{label}</p>
      <p className={`text-2xl font-bold ${highlight ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}

/**
 * Web Vital Metric Component
 */
function WebVitalMetric({
  label,
  value,
  unit,
  target,
  statusClass,
}: {
  label: string;
  value: number;
  unit: string;
  target: number;
  statusClass: string;
}) {
  return (
    <div className="space-y-2">
      <div className="flex justify-between items-center text-sm">
        <span className="text-gray-700">{label}</span>
        <span className={`font-semibold ${statusClass}`}>
          {value.toFixed(value < 10 ? 2 : 0)}
          {unit} {unit && <span className="text-xs text-gray-600 ml-1">(target: {target}{unit})</span>}
        </span>
      </div>
      <div className="w-full bg-gray-200 rounded-full h-2">
        <div
          className={`h-2 rounded-full ${statusClass.includes('green') ? 'bg-green-500' : statusClass.includes('yellow') ? 'bg-yellow-500' : 'bg-red-500'}`}
          style={{ width: `${Math.min((value / (target * 2)) * 100, 100)}%` }}
        />
      </div>
    </div>
  );
}

/**
 * Summary Card Component
 */
function SummaryCard({ label, value, critical = false }: { label: string; value: string | number; critical?: boolean }) {
  return (
    <div className={`text-center p-3 rounded-lg ${critical ? 'bg-red-50' : 'bg-gray-50'}`}>
      <p className="text-xs text-gray-600">{label}</p>
      <p className={`text-2xl font-bold ${critical ? 'text-red-600' : 'text-gray-900'}`}>{value}</p>
    </div>
  );
}
