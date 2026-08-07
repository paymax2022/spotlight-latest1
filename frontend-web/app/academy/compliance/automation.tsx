'use client';

import React from 'react';
import type { Incident, RemediationAction } from '@/lib/compliance/remediationEngine';

/**
 * Incident Card Component
 */
export function IncidentCard({
  incident,
  onResolve,
  onApplyTemplate,
  onTriggerWorkflow,
}: {
  incident: Incident;
  onResolve: (incidentId: string) => void;
  onApplyTemplate: (incidentId: string, templateId: string) => void;
  onTriggerWorkflow: (incidentId: string, workflowId: string) => void;
}) {
  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'critical':
        return 'bg-red-100 border-red-500 text-red-900';
      case 'alert':
        return 'bg-orange-100 border-orange-500 text-orange-900';
      case 'warning':
        return 'bg-yellow-100 border-yellow-500 text-yellow-900';
      default:
        return 'bg-blue-100 border-blue-500 text-blue-900';
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'open':
        return 'bg-blue-500 text-white';
      case 'in_progress':
        return 'bg-yellow-500 text-white';
      case 'resolved':
        return 'bg-green-500 text-white';
      case 'escalated':
        return 'bg-red-500 text-white';
      default:
        return 'bg-gray-500 text-white';
    }
  };

  const getIcon = (category: string) => {
    switch (category) {
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

  const formatTime = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffMins < 1440) return `${Math.floor(diffMins / 60)}h ago`;
    return `${Math.floor(diffMins / 1440)}d ago`;
  };

  return (
    <div className={`rounded-lg border-l-4 p-4 ${getSeverityColor(incident.severity)}`}>
      <div className="flex justify-between items-start mb-3">
        <div className="flex items-start gap-3 flex-1">
          <span className="text-2xl">{getIcon(incident.category)}</span>
          <div>
            <h3 className="font-bold text-lg">{incident.title}</h3>
            <p className="text-sm opacity-90">{incident.description}</p>
            <p className="text-xs opacity-75 mt-1">
              Created {formatTime(incident.createdAt)} • {incident.category.toUpperCase()}
            </p>
          </div>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-semibold ${getStatusBadge(incident.status)}`}>
          {incident.status.replace('_', ' ').toUpperCase()}
        </span>
      </div>

      {/* Remediations List */}
      {incident.remediations.length > 0 && (
        <div className="mb-4 bg-white bg-opacity-50 rounded p-3">
          <p className="text-xs font-semibold mb-2">Applied Remediations:</p>
          <ul className="space-y-1">
            {incident.remediations.map((rem) => (
              <li key={rem.id} className="text-xs flex items-start gap-2">
                <span>✓</span>
                <span>{rem.action}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-2">
        {incident.status === 'open' && (
          <>
            <button
              onClick={() => onApplyTemplate(incident.id, 'gdpr-slow-response')}
              className="px-3 py-1 bg-white text-gray-900 rounded text-xs hover:bg-gray-100 font-semibold"
            >
              Apply Template
            </button>
            <button
              onClick={() => onTriggerWorkflow(incident.id, 'critical-incident')}
              className="px-3 py-1 bg-white text-gray-900 rounded text-xs hover:bg-gray-100 font-semibold"
            >
              Trigger Workflow
            </button>
          </>
        )}
        {incident.status === 'in_progress' && (
          <button
            onClick={() => onResolve(incident.id)}
            className="px-3 py-1 bg-white text-gray-900 rounded text-xs hover:bg-gray-100 font-semibold"
          >
            Mark Resolved
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Remediation Action Card
 */
export function RemediationActionCard({
  action,
  onExecute,
  onApprove,
  onReject,
}: {
  action: RemediationAction;
  onExecute: (actionId: string) => void;
  onApprove: (actionId: string) => void;
  onReject: (actionId: string) => void;
}) {
  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'critical':
        return 'border-red-500 bg-red-50';
      case 'high':
        return 'border-orange-500 bg-orange-50';
      case 'medium':
        return 'border-yellow-500 bg-yellow-50';
      default:
        return 'border-green-500 bg-green-50';
    }
  };

  const getTypeIcon = (type: string) => {
    switch (type) {
      case 'auto':
        return '⚙️ Auto';
      case 'manual':
        return '👤 Manual';
      case 'workflow':
        return '🔄 Workflow';
      default:
        return '📋';
    }
  };

  return (
    <div className={`rounded-lg border-2 p-4 ${getPriorityColor(action.priority)}`}>
      <div className="flex justify-between items-start mb-3">
        <div>
          <p className="font-semibold text-gray-900">{action.action}</p>
          <p className="text-xs text-gray-600 mt-1">
            {getTypeIcon(action.type)} • Est. {action.estimatedDuration} min
          </p>
        </div>
        <span className="text-xs px-2 py-1 bg-white rounded capitalize">{action.priority}</span>
      </div>

      {/* Buttons */}
      <div className="flex gap-2">
        {action.requiresApproval ? (
          <>
            <button
              onClick={() => onApprove(action.id)}
              className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 font-semibold"
            >
              Approve
            </button>
            <button
              onClick={() => onReject(action.id)}
              className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 font-semibold"
            >
              Reject
            </button>
          </>
        ) : (
          <button
            onClick={() => onExecute(action.id)}
            className="px-3 py-1 bg-blue-600 text-white rounded text-xs hover:bg-blue-700 font-semibold"
          >
            Execute
          </button>
        )}
      </div>
    </div>
  );
}

/**
 * Incident Statistics Panel
 */
export function IncidentStatistics({
  stats,
}: {
  stats: {
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    escalated: number;
    averageResolutionTime: number;
  };
}) {
  const getResolutionStatus = (avgTime: number) => {
    if (avgTime < 60) return { text: 'Excellent', color: 'text-green-600' };
    if (avgTime < 120) return { text: 'Good', color: 'text-yellow-600' };
    return { text: 'Needs Improvement', color: 'text-red-600' };
  };

  const resolution = getResolutionStatus(stats.averageResolutionTime);

  return (
    <div className="bg-white rounded-lg shadow-lg p-6">
      <h2 className="text-xl font-bold text-gray-900 mb-6">Incident Statistics</h2>

      {/* Grid */}
      <div className="grid grid-cols-3 gap-4 mb-6">
        <div className="bg-blue-50 rounded-lg p-4">
          <p className="text-sm text-blue-600 font-semibold">Total</p>
          <p className="text-3xl font-bold text-blue-900">{stats.total}</p>
        </div>
        <div className="bg-yellow-50 rounded-lg p-4">
          <p className="text-sm text-yellow-600 font-semibold">Open</p>
          <p className="text-3xl font-bold text-yellow-900">{stats.open}</p>
        </div>
        <div className="bg-orange-50 rounded-lg p-4">
          <p className="text-sm text-orange-600 font-semibold">In Progress</p>
          <p className="text-3xl font-bold text-orange-900">{stats.inProgress}</p>
        </div>
      </div>

      {/* Secondary Grid */}
      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="bg-green-50 rounded-lg p-4">
          <p className="text-sm text-green-600 font-semibold">Resolved</p>
          <p className="text-2xl font-bold text-green-900">{stats.resolved}</p>
        </div>
        <div className="bg-red-50 rounded-lg p-4">
          <p className="text-sm text-red-600 font-semibold">Escalated</p>
          <p className="text-2xl font-bold text-red-900">{stats.escalated}</p>
        </div>
      </div>

      {/* Resolution Time */}
      <div className="border-t pt-4">
        <p className="text-sm text-gray-600 mb-2">Average Resolution Time</p>
        <div className="flex items-end gap-3">
          <p className="text-2xl font-bold text-gray-900">{stats.averageResolutionTime} min</p>
          <p className={`text-sm font-semibold ${resolution.color}`}>{resolution.text}</p>
        </div>
      </div>
    </div>
  );
}

/**
 * Workflow Execution Timeline
 */
export function WorkflowTimeline({
  workflow,
}: {
  workflow: {
    id: string;
    name: string;
    steps: Array<{ id: string; name: string; action: string; timeout: number }>;
    notificationChannels: string[];
  };
}) {
  return (
    <div className="bg-white rounded-lg p-6 border-2 border-gray-200">
      <h3 className="text-lg font-bold text-gray-900 mb-4">{workflow.name}</h3>

      {/* Timeline */}
      <div className="space-y-4">
        {workflow.steps.map((step, idx) => (
          <div key={step.id} className="flex gap-4">
            {/* Timeline dot */}
            <div className="flex flex-col items-center">
              <div className="w-8 h-8 bg-blue-600 text-white rounded-full flex items-center justify-center text-xs font-bold">
                {idx + 1}
              </div>
              {idx < workflow.steps.length - 1 && <div className="w-1 h-12 bg-blue-200 mt-2" />}
            </div>

            {/* Step details */}
            <div className="flex-1">
              <p className="font-semibold text-gray-900">{step.name}</p>
              <p className="text-xs text-gray-600 mt-1">
                {step.action} • Timeout: {step.timeout}s
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Notifications */}
      <div className="mt-6 pt-4 border-t">
        <p className="text-sm font-semibold text-gray-900 mb-2">Notifications:</p>
        <div className="flex gap-2">
          {workflow.notificationChannels.map((channel) => (
            <span key={channel} className="px-2 py-1 bg-gray-100 text-gray-700 rounded text-xs font-semibold">
              {channel}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Automation Rule Card
 */
export function AutomationRuleCard({
  rule,
  onDelete,
}: {
  rule: { id: string; trigger: string; action: string; enabled: boolean; priority: string };
  onDelete: (ruleId: string) => void;
}) {
  return (
    <div className="bg-white rounded-lg border-2 border-gray-200 p-4">
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <p className="text-sm font-semibold text-gray-900">When: {rule.trigger}</p>
          <p className="text-sm text-gray-600 mt-1">Then: {rule.action}</p>
          <p className="text-xs text-gray-500 mt-2">Priority: {rule.priority}</p>
        </div>
        <div className="flex items-center gap-2">
          <span
            className={`px-2 py-1 rounded text-xs font-semibold ${
              rule.enabled ? 'bg-green-100 text-green-900' : 'bg-gray-100 text-gray-900'
            }`}
          >
            {rule.enabled ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      </div>

      <button
        onClick={() => onDelete(rule.id)}
        className="px-3 py-1 bg-red-100 text-red-900 rounded text-xs hover:bg-red-200 font-semibold"
      >
        Delete Rule
      </button>
    </div>
  );
}

/**
 * Pending Approvals Panel
 */
export function PendingApprovals({
  actions,
  onApprove,
  onReject,
  count,
}: {
  actions: any[];
  onApprove: (actionId: string) => void;
  onReject: (actionId: string) => void;
  count: number;
}) {
  return (
    <div className="bg-yellow-50 rounded-lg p-6 border-l-4 border-yellow-500">
      <h2 className="text-lg font-bold text-yellow-900 mb-4">⏳ Pending Approvals ({count})</h2>

      {count > 0 ? (
        <div className="space-y-3">
          {actions.slice(0, 5).map((action) => (
            <div key={action.id} className="bg-white rounded p-3">
              <p className="font-semibold text-gray-900 text-sm">{action.action}</p>
              <p className="text-xs text-gray-600 mt-1">Est. {action.estimatedDuration} min</p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={() => onApprove(action.id)}
                  className="px-3 py-1 bg-green-600 text-white rounded text-xs hover:bg-green-700 font-semibold"
                >
                  Approve
                </button>
                <button
                  onClick={() => onReject(action.id)}
                  className="px-3 py-1 bg-red-600 text-white rounded text-xs hover:bg-red-700 font-semibold"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-yellow-800">No pending approvals</p>
      )}
    </div>
  );
}
