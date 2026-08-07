'use client';

import React, { useState } from 'react';
import {
  ForecastCard,
  TrendChart,
  CompositeRiskIndicator,
  ActionPlan,
  AnomalyAlert,
} from './predictions';
import {
  usePredictiveCompliance,
  useRiskEscalation,
  usePredictiveRecommendations,
  useAnomalyDetection,
} from '@/hooks/usePredictiveCompliance';

/**
 * Predictive Compliance Monitoring Page
 */
export default function PredictiveCompliancePage() {
  const [activeMetric, setActiveMetric] = useState<'gdpr' | 'security' | 'performance'>('gdpr');

  const predictive = usePredictiveCompliance();
  const escalations = useRiskEscalation();
  const recommendations = usePredictiveRecommendations();
  const anomalies = useAnomalyDetection(activeMetric);

  // Start watching escalations on mount
  React.useEffect(() => {
    escalations.startWatching();
    return () => escalations.stopWatching();
  }, [escalations]);

  const getActiveMetricData = () => {
    switch (activeMetric) {
      case 'security':
        return predictive.securityForecast;
      case 'performance':
        return predictive.performanceForecast;
      default:
        return predictive.gdprForecast;
    }
  };

  const metricData = getActiveMetricData();

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Predictive Compliance Monitoring</h1>
              <p className="text-gray-600 mt-1">AI-powered forecasting and risk assessment</p>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => predictive.generateForecasts()}
                disabled={predictive.isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {predictive.isLoading ? 'Generating...' : 'Regenerate Forecasts'}
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {predictive.error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mx-4 mt-4">
          <p className="text-red-800">{predictive.error}</p>
        </div>
      )}

      {/* Composite Risk & Escalations */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-8">
          {/* Composite Risk */}
          {predictive.compositeRisk && (
            <div className="lg:col-span-2">
              <CompositeRiskIndicator {...predictive.compositeRisk} />
            </div>
          )}

          {/* Escalations */}
          <div className="bg-white rounded-lg shadow-lg p-6">
            <h2 className="text-lg font-bold text-gray-900 mb-4">Risk Escalations</h2>

            {escalations.escalations.length > 0 ? (
              <div className="space-y-3">
                {escalations.escalations.slice(0, 5).map((esc) => (
                  <div
                    key={esc.id}
                    className={`p-3 rounded border-l-4 ${
                      esc.severity === 'critical'
                        ? 'bg-red-50 border-red-500'
                        : esc.severity === 'alert'
                          ? 'bg-orange-50 border-orange-500'
                          : 'bg-yellow-50 border-yellow-500'
                    }`}
                  >
                    <p className="text-sm font-semibold text-gray-900 mb-1">{esc.metric}</p>
                    <p className="text-xs text-gray-700 mb-2">{esc.message}</p>
                    {!esc.acknowledged && (
                      <button
                        onClick={() => escalations.acknowledge(esc.id)}
                        className="text-xs px-2 py-1 bg-white rounded hover:bg-gray-100"
                      >
                        Acknowledge
                      </button>
                    )}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-center py-8">✓ No escalations</p>
            )}
          </div>
        </div>

        {/* Metric Selector */}
        <div className="mb-6">
          <div className="flex gap-3">
            {[
              { id: 'gdpr', label: 'GDPR', icon: '📋' },
              { id: 'security', label: 'Security', icon: '🔒' },
              { id: 'performance', label: 'Performance', icon: '⚡' },
            ].map((metric) => (
              <button
                key={metric.id}
                onClick={() => setActiveMetric(metric.id as any)}
                className={`px-6 py-3 rounded-lg font-semibold transition-colors ${
                  activeMetric === metric.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-white text-gray-900 border border-gray-300 hover:border-gray-400'
                }`}
              >
                {metric.icon} {metric.label}
              </button>
            ))}
          </div>
        </div>

        {/* Metric Details */}
        {predictive.isLoading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        ) : metricData ? (
          <div className="space-y-6">
            {/* Forecast Card */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
              <ForecastCard forecast={metricData} />
              <TrendChart forecasts={metricData.forecasts} />
            </div>

            {/* Anomalies */}
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Data Anomalies</h2>
              <AnomalyAlert anomalies={anomalies.anomalies} />
            </div>

            {/* Get Action Plan */}
            {metricData.forecasts.length > 0 && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">Recommended Actions</h2>
                <ActionPlanSection metric={activeMetric} />
              </div>
            )}
          </div>
        ) : null}

        {/* Recommendations Section */}
        <div className="mt-12">
          <h2 className="text-2xl font-bold text-gray-900 mb-6">Compliance Recommendations</h2>

          {recommendations.isLoading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Critical */}
              {recommendations.critical.length > 0 && (
                <div className="bg-red-50 rounded-lg p-6 border-l-4 border-red-500">
                  <h3 className="text-lg font-bold text-red-900 mb-4">
                    🚨 Critical Actions ({recommendations.critical.length})
                  </h3>
                  <div className="space-y-3">
                    {recommendations.critical.map((rec) => (
                      <RecommendationItem key={rec.id} recommendation={rec} />
                    ))}
                  </div>
                </div>
              )}

              {/* High Priority */}
              {recommendations.high.length > 0 && (
                <div className="bg-orange-50 rounded-lg p-6 border-l-4 border-orange-500">
                  <h3 className="text-lg font-bold text-orange-900 mb-4">
                    ⚠️ High Priority ({recommendations.high.length})
                  </h3>
                  <div className="space-y-3">
                    {recommendations.high.map((rec) => (
                      <RecommendationItem key={rec.id} recommendation={rec} />
                    ))}
                  </div>
                </div>
              )}

              {/* All Recommendations */}
              {recommendations.recommendations.length === 0 && (
                <div className="col-span-full text-center py-8 bg-green-50 rounded-lg">
                  <p className="text-green-900 font-semibold">✓ No urgent recommendations</p>
                  <p className="text-sm text-green-800">Continue monitoring compliance metrics</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * Recommendation Item Component
 */
function RecommendationItem({
  recommendation,
}: {
  recommendation: {
    id: string;
    metric: string;
    priority: string;
    action: string;
    daysToComplete: number;
    estimatedImpact: string;
    status: 'pending' | 'in_progress' | 'completed';
  };
}) {
  const handleStatusChange = (status: 'pending' | 'in_progress' | 'completed') => {
    // Would integrate with hook in real implementation
    console.log(`Update ${recommendation.id} to ${status}`);
  };

  return (
    <div className="bg-white p-3 rounded">
      <div className="flex justify-between items-start mb-2">
        <p className="font-semibold text-gray-900 text-sm">{recommendation.action}</p>
        <span className="text-xs px-2 py-1 bg-gray-100 rounded">{recommendation.daysToComplete}d</span>
      </div>
      <p className="text-xs text-gray-600 mb-2">{recommendation.metric}</p>

      {/* Status Selector */}
      <div className="flex gap-2">
        {(['pending', 'in_progress', 'completed'] as const).map((status) => (
          <button
            key={status}
            onClick={() => handleStatusChange(status)}
            className={`text-xs px-2 py-1 rounded capitalize ${
              recommendation.status === status
                ? 'bg-blue-600 text-white'
                : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
            }`}
          >
            {status === 'in_progress' ? 'In Progress' : status}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Action Plan Section Component
 */
function ActionPlanSection({ metric }: { metric: 'gdpr' | 'security' | 'performance' }) {
  return (
    <div className="bg-white rounded-lg p-6 border-2 border-gray-200">
      <p className="text-gray-600 italic text-center py-8">
        Action plan would be dynamically generated based on forecast for {metric}
      </p>
    </div>
  );
}
