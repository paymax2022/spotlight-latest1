'use client';

import { useCallback, useEffect, useState } from 'react';
import { getRemediationEngine } from '@/lib/compliance/remediationEngine';
import type { Incident, RemediationTemplate, IncidentWorkflow, RemediationAction } from '@/lib/compliance/remediationEngine';

/**
 * Hook for incident management
 */
export function useIncidentManagement() {
  const [incidents, setIncidents] = useState<Incident[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const engine = getRemediationEngine();

  /**
   * Fetch incidents from server
   */
  const fetchIncidents = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch('/api/compliance/incidents');
      if (!response.ok) throw new Error('Failed to fetch incidents');

      const data = await response.json();
      setIncidents(data.incidents || []);
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to fetch incidents';
      setError(errorMsg);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create new incident
   */
  const createIncident = useCallback(
    async (
      category: 'gdpr' | 'security' | 'performance',
      severity: 'warning' | 'alert' | 'critical',
      title: string,
      description: string
    ) => {
      try {
        const response = await fetch('/api/compliance/incidents', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ category, severity, title, description }),
        });

        if (!response.ok) throw new Error('Failed to create incident');

        const data = await response.json();
        setIncidents((prev) => [data.incident, ...prev]);
        return data.incident;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Failed to create incident';
        setError(errorMsg);
        return null;
      }
    },
    []
  );

  /**
   * Resolve incident
   */
  const resolveIncident = useCallback(async (incidentId: string, method: string) => {
    try {
      const response = await fetch(`/api/compliance/incidents/${incidentId}/resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method }),
      });

      if (!response.ok) throw new Error('Failed to resolve incident');

      setIncidents((prev) =>
        prev.map((i) => (i.id === incidentId ? { ...i, status: 'resolved' } : i))
      );
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to resolve incident';
      setError(errorMsg);
    }
  }, []);

  /**
   * Apply remediation template
   */
  const applyTemplate = useCallback(async (incidentId: string, templateId: string) => {
    try {
      const response = await fetch(`/api/compliance/incidents/${incidentId}/apply-template`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templateId }),
      });

      if (!response.ok) throw new Error('Failed to apply template');

      await fetchIncidents();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to apply template';
      setError(errorMsg);
    }
  }, [fetchIncidents]);

  /**
   * Trigger workflow
   */
  const triggerWorkflow = useCallback(async (incidentId: string, workflowId: string) => {
    try {
      const response = await fetch(`/api/compliance/incidents/${incidentId}/workflow`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ workflowId }),
      });

      if (!response.ok) throw new Error('Failed to trigger workflow');

      await fetchIncidents();
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to trigger workflow';
      setError(errorMsg);
    }
  }, [fetchIncidents]);

  useEffect(() => {
    fetchIncidents();
  }, [fetchIncidents]);

  return {
    incidents,
    isLoading,
    error,
    createIncident,
    resolveIncident,
    applyTemplate,
    triggerWorkflow,
    refresh: fetchIncidents,
  };
}

/**
 * Hook for remediation actions
 */
export function useRemediationActions() {
  const [actions, setActions] = useState<RemediationAction[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  const engine = getRemediationEngine();

  /**
   * Execute action
   */
  const executeAction = useCallback(async (incidentId: string, actionId: string) => {
    setIsLoading(true);

    try {
      const response = await fetch(`/api/compliance/actions/${actionId}/execute`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ incidentId }),
      });

      if (!response.ok) throw new Error('Failed to execute action');

      // Update local state
      setActions((prev) =>
        prev.map((a) => (a.id === actionId ? { ...a, status: 'completed' } : a))
      );
    } catch (err) {
      console.error('Failed to execute action:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Approve action
   */
  const approveAction = useCallback(async (actionId: string) => {
    try {
      await fetch(`/api/compliance/actions/${actionId}/approve`, { method: 'POST' });
      setActions((prev) =>
        prev.map((a) => (a.id === actionId ? { ...a, requiresApproval: false } : a))
      );
    } catch (err) {
      console.error('Failed to approve action:', err);
    }
  }, []);

  /**
   * Reject action
   */
  const rejectAction = useCallback(async (actionId: string) => {
    try {
      await fetch(`/api/compliance/actions/${actionId}/reject`, { method: 'POST' });
      setActions((prev) => prev.filter((a) => a.id !== actionId));
    } catch (err) {
      console.error('Failed to reject action:', err);
    }
  }, []);

  return {
    actions,
    isLoading,
    executeAction,
    approveAction,
    rejectAction,
    pendingApproval: actions.filter((a) => a.requiresApproval),
  };
}

/**
 * Hook for workflow automation
 */
export function useWorkflowAutomation() {
  const [workflows, setWorkflows] = useState<IncidentWorkflow[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  /**
   * Fetch workflows
   */
  const fetchWorkflows = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/compliance/workflows');
      if (!response.ok) throw new Error('Failed to fetch workflows');

      const data = await response.json();
      setWorkflows(data.workflows || []);
    } catch (err) {
      console.error('Failed to fetch workflows:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create custom workflow
   */
  const createWorkflow = useCallback(
    async (name: string, trigger: string, steps: any[], escalationPath: string[]) => {
      try {
        const response = await fetch('/api/compliance/workflows', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, trigger, steps, escalationPath }),
        });

        if (!response.ok) throw new Error('Failed to create workflow');

        const data = await response.json();
        setWorkflows((prev) => [...prev, data.workflow]);
        return data.workflow;
      } catch (err) {
        console.error('Failed to create workflow:', err);
        return null;
      }
    },
    []
  );

  /**
   * Enable/disable workflow
   */
  const toggleWorkflow = useCallback(async (workflowId: string, enabled: boolean) => {
    try {
      await fetch(`/api/compliance/workflows/${workflowId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ enabled }),
      });

      setWorkflows((prev) =>
        prev.map((w) =>
          w.id === workflowId ? { ...w, autoResolve: enabled } : w
        )
      );
    } catch (err) {
      console.error('Failed to toggle workflow:', err);
    }
  }, []);

  useEffect(() => {
    fetchWorkflows();
  }, [fetchWorkflows]);

  return {
    workflows,
    isLoading,
    createWorkflow,
    toggleWorkflow,
    refresh: fetchWorkflows,
  };
}

/**
 * Hook for incident statistics
 */
export function useIncidentStats() {
  const [stats, setStats] = useState<{
    total: number;
    open: number;
    inProgress: number;
    resolved: number;
    escalated: number;
    averageResolutionTime: number;
  } | null>(null);

  const [isLoading, setIsLoading] = useState(false);

  const fetchStats = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/compliance/incidents/stats');
      if (!response.ok) throw new Error('Failed to fetch stats');

      const data = await response.json();
      setStats(data.stats);
    } catch (err) {
      console.error('Failed to fetch stats:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchStats();
    const interval = setInterval(fetchStats, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [fetchStats]);

  return {
    stats,
    isLoading,
    refresh: fetchStats,
  };
}

/**
 * Hook for automation rules
 */
export function useAutomationRules() {
  const [rules, setRules] = useState<
    Array<{
      id: string;
      trigger: string;
      action: string;
      enabled: boolean;
      priority: string;
    }>
  >([]);

  const [isLoading, setIsLoading] = useState(false);

  /**
   * Fetch rules
   */
  const fetchRules = useCallback(async () => {
    setIsLoading(true);

    try {
      const response = await fetch('/api/compliance/automation/rules');
      if (!response.ok) throw new Error('Failed to fetch rules');

      const data = await response.json();
      setRules(data.rules || []);
    } catch (err) {
      console.error('Failed to fetch rules:', err);
    } finally {
      setIsLoading(false);
    }
  }, []);

  /**
   * Create rule
   */
  const createRule = useCallback(
    async (trigger: string, action: string, priority: string) => {
      try {
        const response = await fetch('/api/compliance/automation/rules', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ trigger, action, priority }),
        });

        if (!response.ok) throw new Error('Failed to create rule');

        await fetchRules();
      } catch (err) {
        console.error('Failed to create rule:', err);
      }
    },
    [fetchRules]
  );

  /**
   * Delete rule
   */
  const deleteRule = useCallback(
    async (ruleId: string) => {
      try {
        await fetch(`/api/compliance/automation/rules/${ruleId}`, { method: 'DELETE' });
        setRules((prev) => prev.filter((r) => r.id !== ruleId));
      } catch (err) {
        console.error('Failed to delete rule:', err);
      }
    },
    []
  );

  useEffect(() => {
    fetchRules();
  }, [fetchRules]);

  return {
    rules,
    isLoading,
    createRule,
    deleteRule,
    refresh: fetchRules,
    enabled: rules.filter((r) => r.enabled),
  };
}
