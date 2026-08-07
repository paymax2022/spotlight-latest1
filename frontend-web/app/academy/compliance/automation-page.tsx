'use client';

import React, { useState } from 'react';
import {
  IncidentCard,
  RemediationActionCard,
  IncidentStatistics,
  WorkflowTimeline,
  AutomationRuleCard,
  PendingApprovals,
} from './automation';
import {
  useIncidentManagement,
  useRemediationActions,
  useWorkflowAutomation,
  useIncidentStats,
  useAutomationRules,
} from '@/hooks/useComplianceAutomation';

/**
 * Compliance Automation & Incident Response Page
 */
export default function ComplianceAutomationPage() {
  const [activeTab, setActiveTab] = useState<
    'incidents' | 'remediations' | 'workflows' | 'rules' | 'stats'
  >('incidents');

  const incidents = useIncidentManagement();
  const remediations = useRemediationActions();
  const workflows = useWorkflowAutomation();
  const stats = useIncidentStats();
  const rules = useAutomationRules();

  const openIncidents = incidents.incidents.filter((i) => i.status === 'open');
  const inProgressIncidents = incidents.incidents.filter((i) => i.status === 'in_progress');

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 py-6">
          <div className="flex justify-between items-center">
            <div>
              <h1 className="text-3xl font-bold text-gray-900">Compliance Automation</h1>
              <p className="text-gray-600 mt-1">Incident management, remediation, and workflow automation</p>
            </div>

            <button
              onClick={() => incidents.refresh()}
              disabled={incidents.isLoading}
              className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:bg-gray-400"
            >
              {incidents.isLoading ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
        </div>
      </div>

      {/* Alert Banner */}
      {openIncidents.length > 0 && (
        <div className="bg-red-50 border-l-4 border-red-500 p-4 mx-4 mt-4">
          <p className="text-red-800 font-semibold">
            🚨 {openIncidents.length} Open Incident{openIncidents.length > 1 ? 's' : ''}
          </p>
          <p className="text-sm text-red-700">Immediate action required</p>
        </div>
      )}

      {/* Tabs */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4">
          <div className="flex gap-8">
            {[
              { id: 'incidents', label: `Incidents (${incidents.incidents.length})` },
              { id: 'remediations', label: `Actions (${remediations.actions.length})` },
              { id: 'workflows', label: `Workflows (${workflows.workflows.length})` },
              { id: 'rules', label: `Rules (${rules.rules.length})` },
              { id: 'stats', label: 'Statistics' },
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
        {/* Incidents Tab */}
        {activeTab === 'incidents' && (
          <div className="space-y-6">
            {/* Quick Stats */}
            {stats.stats && (
              <div className="grid grid-cols-4 gap-4">
                <div className="bg-blue-50 rounded-lg p-4 border-l-4 border-blue-500">
                  <p className="text-sm text-blue-600 font-semibold">Open</p>
                  <p className="text-2xl font-bold text-blue-900">{stats.stats.open}</p>
                </div>
                <div className="bg-yellow-50 rounded-lg p-4 border-l-4 border-yellow-500">
                  <p className="text-sm text-yellow-600 font-semibold">In Progress</p>
                  <p className="text-2xl font-bold text-yellow-900">{stats.stats.inProgress}</p>
                </div>
                <div className="bg-green-50 rounded-lg p-4 border-l-4 border-green-500">
                  <p className="text-sm text-green-600 font-semibold">Resolved</p>
                  <p className="text-2xl font-bold text-green-900">{stats.stats.resolved}</p>
                </div>
                <div className="bg-red-50 rounded-lg p-4 border-l-4 border-red-500">
                  <p className="text-sm text-red-600 font-semibold">Escalated</p>
                  <p className="text-2xl font-bold text-red-900">{stats.stats.escalated}</p>
                </div>
              </div>
            )}

            {/* Open Incidents */}
            {openIncidents.length > 0 && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">🔴 Open Incidents</h2>
                <div className="space-y-3">
                  {openIncidents.map((incident) => (
                    <IncidentCard
                      key={incident.id}
                      incident={incident}
                      onResolve={(id) => incidents.resolveIncident(id, 'manual')}
                      onApplyTemplate={(id, tpl) => incidents.applyTemplate(id, tpl)}
                      onTriggerWorkflow={(id, wf) => incidents.triggerWorkflow(id, wf)}
                    />
                  ))}
                </div>
              </div>
            )}

            {/* In Progress Incidents */}
            {inProgressIncidents.length > 0 && (
              <div>
                <h2 className="text-xl font-bold text-gray-900 mb-4">🟡 In Progress</h2>
                <div className="space-y-3">
                  {inProgressIncidents.map((incident) => (
                    <IncidentCard
                      key={incident.id}
                      incident={incident}
                      onResolve={(id) => incidents.resolveIncident(id, 'remediation')}
                      onApplyTemplate={() => {}}
                      onTriggerWorkflow={() => {}}
                    />
                  ))}
                </div>
              </div>
            )}

            {incidents.incidents.length === 0 && (
              <div className="text-center py-12 bg-green-50 rounded-lg">
                <p className="text-green-900 font-semibold">✓ No active incidents</p>
                <p className="text-sm text-green-800">All compliance issues resolved</p>
              </div>
            )}
          </div>
        )}

        {/* Remediations Tab */}
        {activeTab === 'remediations' && (
          <div className="space-y-6">
            {/* Pending Approvals */}
            {remediations.pendingApproval.length > 0 && (
              <PendingApprovals
                actions={remediations.pendingApproval}
                onApprove={(id) => remediations.approveAction(id)}
                onReject={(id) => remediations.rejectAction(id)}
                count={remediations.pendingApproval.length}
              />
            )}

            {/* All Actions */}
            <div>
              <h2 className="text-xl font-bold text-gray-900 mb-4">Remediation Actions</h2>
              {remediations.actions.length > 0 ? (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {remediations.actions.map((action) => (
                    <RemediationActionCard
                      key={action.id}
                      action={action}
                      onExecute={(id) => remediations.executeAction('', id)}
                      onApprove={(id) => remediations.approveAction(id)}
                      onReject={(id) => remediations.rejectAction(id)}
                    />
                  ))}
                </div>
              ) : (
                <p className="text-gray-600 text-center py-8">No remediation actions</p>
              )}
            </div>
          </div>
        )}

        {/* Workflows Tab */}
        {activeTab === 'workflows' && (
          <div className="space-y-6">
            <h2 className="text-xl font-bold text-gray-900">Incident Response Workflows</h2>

            {workflows.workflows.length > 0 ? (
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {workflows.workflows.map((workflow) => (
                  <WorkflowTimeline key={workflow.id} workflow={workflow} />
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-center py-8">No workflows configured</p>
            )}
          </div>
        )}

        {/* Rules Tab */}
        {activeTab === 'rules' && (
          <div className="space-y-6">
            <div className="flex justify-between items-center">
              <h2 className="text-xl font-bold text-gray-900">Automation Rules</h2>
              <button className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700">
                + Create Rule
              </button>
            </div>

            {rules.rules.length > 0 ? (
              <div className="grid grid-cols-1 gap-4">
                {rules.rules.map((rule) => (
                  <AutomationRuleCard
                    key={rule.id}
                    rule={rule}
                    onDelete={(id) => rules.deleteRule(id)}
                  />
                ))}
              </div>
            ) : (
              <p className="text-gray-600 text-center py-8">No automation rules</p>
            )}
          </div>
        )}

        {/* Statistics Tab */}
        {activeTab === 'stats' && stats.stats && (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <IncidentStatistics stats={stats.stats} />

            {/* Trends */}
            <div className="bg-white rounded-lg shadow-lg p-6">
              <h2 className="text-xl font-bold text-gray-900 mb-4">Automation Insights</h2>

              <div className="space-y-4">
                <div>
                  <p className="text-sm text-gray-600 mb-2">Automation Coverage</p>
                  <div className="w-full bg-gray-200 rounded-full h-2">
                    <div className="h-2 rounded-full bg-blue-600" style={{ width: '78%' }} />
                  </div>
                  <p className="text-xs text-gray-600 mt-1">78% of issues auto-remediated</p>
                </div>

                <div>
                  <p className="text-sm text-gray-600 mb-2">Time Saved</p>
                  <p className="text-2xl font-bold text-green-600">847 hours</p>
                  <p className="text-xs text-gray-600 mt-1">By automated incident response</p>
                </div>

                <div>
                  <p className="text-sm text-gray-600 mb-2">Avg Response Time</p>
                  <p className="text-2xl font-bold text-gray-900">
                    {stats.stats.averageResolutionTime} min
                  </p>
                  <p className="text-xs text-gray-600 mt-1">Down from 240 min last quarter</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
