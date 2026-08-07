'use client';

import React, { useState } from 'react';
import {
  GDPRComplianceDashboard,
  SecurityPostureDashboard,
  PerformanceDashboard,
  ComplianceOverview,
} from './dashboards';
import {
  useComplianceDashboard,
  useComplianceAlerts,
  useComplianceTrends,
  useComplianceScheduling,
  useComplianceExport,
} from '@/hooks/useComplianceDashboard';

/**
 * Compliance Dashboards Page
 */
export default function ComplianceDashboardPage() {
  const [activeTab, setActiveTab] = useState<'overview' | 'gdpr' | 'security' | 'performance' | 'alerts' | 'schedules'>(
    'overview'
  );

  const dashboard = useComplianceDashboard();
  const alerts = useComplianceAlerts();
  const trends = useComplianceTrends();
  const scheduling = useComplianceScheduling();
  const exportData = useComplianceExport();

  // Start watching alerts on mount
  React.useEffect(() => {
    alerts.startWatching();
    return () => alerts.stopWatching();
  }, [alerts]);

  const dateRangeOptions = [
    { value: 'today', label: 'Today' },
    { value: 'week', label: 'Last 7 Days' },
    { value: 'month', label: 'Last 30 Days' },
    { value: 'quarter', label: 'Last Quarter' },
    { value: 'year', label: 'Last Year' },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Compliance Dashboard</h1>
              <p className="text-gray-600 mt-1">Monitor GDPR, security, and performance compliance</p>
            </div>

            {/* Controls */}
            <div className="flex gap-4">
              <select
                value={dashboard.filters.dateRange}
                onChange={(e) => dashboard.setDateRange(e.target.value as any)}
                className="px-4 py-2 border border-gray-300 rounded-lg bg-white text-gray-900 hover:border-gray-400"
              >
                {dateRangeOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>

              <button
                onClick={() => dashboard.refreshData()}
                disabled={dashboard.isLoading}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
              >
                {dashboard.isLoading ? 'Refreshing...' : 'Refresh'}
              </button>

              <div className="relative group">
                <button className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300">
                  Export ⋮
                </button>
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-lg shadow-lg hidden group-hover:block z-10">
                  <button
                    onClick={() => exportData.exportMetrics('json')}
                    className="w-full text-left px-4 py-2 hover:bg-gray-100 first:rounded-t-lg"
                  >
                    Export as JSON
                  </button>
                  <button
                    onClick={() => exportData.exportMetrics('csv')}
                    className="w-full text-left px-4 py-2 hover:bg-gray-100"
                  >
                    Export as CSV
                  </button>
                  <button
                    onClick={() => exportData.exportMetrics('excel')}
                    className="w-full text-left px-4 py-2 hover:bg-gray-100 last:rounded-b-lg"
                  >
                    Export as Excel
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Error Alert */}
      {dashboard.error && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mx-4 mt-4">
          <p className="text-red-800">{dashboard.error}</p>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-8">
            {[
              { id: 'overview', label: 'Overview' },
              { id: 'gdpr', label: 'GDPR Compliance' },
              { id: 'security', label: 'Security Posture' },
              { id: 'performance', label: 'Performance' },
              { id: 'alerts', label: `Alerts (${alerts.alerts.length})` },
              { id: 'schedules', label: 'Schedules' },
            ].map((tab) => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id as any)}
                className={`px-4 py-4 font-medium border-b-2 transition-colors ${
                  activeTab === tab.id
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
                }`}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="max-w-7xl mx-auto px-4 py-8">
        {/* Loading State */}
        {dashboard.isLoading && (
          <div className="flex items-center justify-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
          </div>
        )}

        {/* Overview Tab */}
        {activeTab === 'overview' && dashboard.gdprMetrics && dashboard.securityMetrics && dashboard.performanceData && (
          <div className="space-y-8">
            <ComplianceOverview
              gdpr={dashboard.gdprMetrics}
              security={dashboard.securityMetrics}
              performance={dashboard.performanceData}
            />

            {/* Recent Reports */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h3 className="text-xl font-bold text-gray-900 mb-4">Recent Reports</h3>
              {dashboard.reports.length > 0 ? (
                <div className="space-y-3">
                  {dashboard.reports.slice(0, 5).map((report) => (
                    <div key={report.id} className="flex items-center justify-between p-3 bg-gray-50 rounded-lg">
                      <div>
                        <p className="font-semibold text-gray-900">{report.type}</p>
                        <p className="text-sm text-gray-600">
                          {new Date(report.generatedAt).toLocaleDateString()}
                        </p>
                      </div>
                      <button className="px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 text-sm">
                        View
                      </button>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-gray-600">No reports generated yet</p>
              )}
            </div>
          </div>
        )}

        {/* GDPR Tab */}
        {activeTab === 'gdpr' && dashboard.gdprMetrics && (
          <GDPRComplianceDashboard metrics={dashboard.gdprMetrics} />
        )}

        {/* Security Tab */}
        {activeTab === 'security' && dashboard.securityMetrics && (
          <SecurityPostureDashboard metrics={dashboard.securityMetrics} />
        )}

        {/* Performance Tab */}
        {activeTab === 'performance' && dashboard.performanceData && (
          <PerformanceDashboard data={dashboard.performanceData} />
        )}

        {/* Alerts Tab */}
        {activeTab === 'alerts' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Active Alerts</h2>
              {alerts.alerts.length > 0 && (
                <button
                  onClick={() => setActiveTab('overview')}
                  className="px-4 py-2 bg-gray-200 text-gray-900 rounded-lg hover:bg-gray-300"
                >
                  Clear All
                </button>
              )}
            </div>

            {alerts.alerts.length > 0 ? (
              <div className="space-y-3">
                {alerts.alerts.map((alert) => (
                  <div
                    key={alert.id}
                    className={`p-4 rounded-lg border-l-4 flex justify-between items-center ${
                      alert.type === 'critical'
                        ? 'bg-red-50 border-red-500'
                        : alert.type === 'warning'
                          ? 'bg-yellow-50 border-yellow-500'
                          : 'bg-blue-50 border-blue-500'
                    }`}
                  >
                    <div>
                      <p className={`font-semibold ${alert.type === 'critical' ? 'text-red-900' : alert.type === 'warning' ? 'text-yellow-900' : 'text-blue-900'}`}>
                        {alert.message}
                      </p>
                      <p className="text-sm text-gray-600">
                        {new Date(alert.timestamp).toLocaleString()}
                      </p>
                    </div>
                    <button
                      onClick={() => alerts.dismissAlert(alert.id)}
                      className="text-gray-400 hover:text-gray-600"
                    >
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-center py-8">✓ No active alerts</p>
            )}
          </div>
        )}

        {/* Schedules Tab */}
        {activeTab === 'schedules' && (
          <div className="bg-white rounded-lg shadow-lg p-6">
            <div className="flex justify-between items-center mb-6">
              <h2 className="text-2xl font-bold text-gray-900">Scheduled Reports</h2>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                + New Schedule
              </button>
            </div>

            {scheduling.schedules.length > 0 ? (
              <div className="overflow-x-auto">
                <table className="w-full">
                  <thead className="border-b">
                    <tr>
                      <th className="text-left py-3 px-4 text-gray-900 font-semibold">Report Type</th>
                      <th className="text-left py-3 px-4 text-gray-900 font-semibold">Frequency</th>
                      <th className="text-left py-3 px-4 text-gray-900 font-semibold">Recipients</th>
                      <th className="text-left py-3 px-4 text-gray-900 font-semibold">Next Run</th>
                      <th className="text-left py-3 px-4 text-gray-900 font-semibold">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {scheduling.schedules.map((schedule) => (
                      <tr key={schedule.id} className="border-b hover:bg-gray-50">
                        <td className="py-3 px-4 text-gray-900">{schedule.reportType}</td>
                        <td className="py-3 px-4 text-gray-900 capitalize">{schedule.frequency}</td>
                        <td className="py-3 px-4 text-gray-600 text-sm">{schedule.recipients.join(', ')}</td>
                        <td className="py-3 px-4 text-gray-600 text-sm">
                          {new Date(schedule.nextRun).toLocaleDateString()}
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex gap-2">
                            <button
                              onClick={() => scheduling.runNow(schedule.id)}
                              className="px-3 py-1 bg-green-600 text-white rounded text-sm hover:bg-green-700"
                            >
                              Run Now
                            </button>
                            <button
                              onClick={() => scheduling.deleteSchedule(schedule.id)}
                              className="px-3 py-1 bg-red-600 text-white rounded text-sm hover:bg-red-700"
                            >
                              Delete
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-gray-600 text-center py-8">No scheduled reports configured</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
