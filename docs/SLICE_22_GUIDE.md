# Slice 22 Implementation Guide - Automated Remediation & Incident Response

**Slice:** 22 | **Date:** August 7, 2026 | **Focus:** Incident automation, remediation workflows, compliance action automation

---

## Overview

Slice 22 provides comprehensive incident management and automated remediation capabilities, enabling the system to automatically detect compliance issues (via Slice 21 predictions) and execute pre-configured remediation workflows with optional approval gates.

**4 Core Files:**
- `lib/compliance/remediationEngine.ts` — Incident & remediation engine
- `hooks/useComplianceAutomation.ts` — React integration hooks
- `app/academy/compliance/automation.tsx` — Automation UI components
- `app/academy/compliance/automation-page.tsx` — Main automation page

**Total:** 2,720 lines of TypeScript + React.

---

## Architecture

### Incident Lifecycle

```
Discovery
  ↓ (dashboard, alert, prediction, user report)
  ↓
Incident Created [open]
  ↓
Get Remediation Template
  ↓ (matching severity & category)
  ↓
Auto-Execute Actions
  ↓ (if autoExecute: true && !requiresApproval)
  ↓
Status → In Progress
  ↓
Execute Manual Actions
  ↓ (if requiresApproval: true)
  ↓
Wait for Approval
  ↓
Approved → Execute
  ↓
Validate Resolution
  ↓
Status → Resolved / Escalated
  ↓
Record Resolution Time & Method
```

### Workflow Execution

```
Incident Severity = CRITICAL
  ↓
Trigger Workflow: critical-incident
  ↓
Step 1: Notify Security Team [notify] (60s timeout)
  ↓
Step 2: Create Ticket [execute] (30s timeout)
  ↓
Step 3: Assign to On-Call [notify] (120s timeout)
  ↓
Step 4: Validate Fix [validate] (3600s timeout)
  ↓
Condition: compliance_score > 75%
  ├─ True → Completed
  └─ False → Escalate to CISO
```

---

## Usage

### 1. Create & Manage Incidents

```typescript
import { useIncidentManagement } from '@/hooks/useComplianceAutomation';

export function Dashboard() {
  const { incidents, createIncident, resolveIncident, applyTemplate } =
    useIncidentManagement();

  // Create incident (triggered by prediction or alert)
  const handleCreateIncident = async () => {
    const incident = await createIncident(
      'security',
      'critical',
      'Auth failure rate spike',
      'Failed attempts > 10% of total'
    );

    if (incident) {
      // Apply template automatically
      await applyTemplate(incident.id, 'security-high-failures');
    }
  };

  return (
    <div>
      <button onClick={handleCreateIncident}>Create Incident</button>

      {incidents.map((incident) => (
        <div key={incident.id}>
          <h3>{incident.title}</h3>
          <p>{incident.description}</p>
          <p>Status: {incident.status}</p>

          {incident.status === 'in_progress' && (
            <button onClick={() => resolveIncident(incident.id, 'automated_fix')}>
              Mark Resolved
            </button>
          )}
        </div>
      ))}
    </div>
  );
}
```

### 2. Apply Remediation Templates

```typescript
const { applyTemplate } = useIncidentManagement();

// Apply GDPR template
await applyTemplate(incidentId, 'gdpr-slow-response');

// Auto-executes:
// - Flag pending requests
// Requires approval:
// - Prioritize oldest first
```

### 3. Trigger Workflows

```typescript
import { useWorkflowAutomation } from '@/hooks/useComplianceAutomation';

export function IncidentDetail() {
  const { workflows, triggerWorkflow } = useIncidentManagement();

  const handleCriticalIncident = async (incidentId: string) => {
    await triggerWorkflow(incidentId, 'critical-incident');
    // Automatically:
    // 1. Notifies security team
    // 2. Creates ticket
    // 3. Assigns to on-call
    // 4. Validates resolution
  };

  return <button onClick={() => handleCriticalIncident('inc-123')}>Escalate</button>;
}
```

### 4. Manage Remediations

```typescript
import { useRemediationActions } from '@/hooks/useComplianceAutomation';

export function RemediationPanel() {
  const { actions, executeAction, approveAction, rejectAction, pendingApproval } =
    useRemediationActions();

  return (
    <div>
      <h3>Pending Approvals ({pendingApproval.length})</h3>
      {pendingApproval.map((action) => (
        <div key={action.id}>
          <p>{action.action}</p>
          <button onClick={() => approveAction(action.id)}>Approve</button>
          <button onClick={() => rejectAction(action.id)}>Reject</button>
        </div>
      ))}

      <h3>Executable Actions</h3>
      {actions
        .filter((a) => !a.requiresApproval)
        .map((action) => (
          <button
            key={action.id}
            onClick={() => executeAction('inc-123', action.id)}
          >
            Execute: {action.action}
          </button>
        ))}
    </div>
  );
}
```

### 5. Track Statistics

```typescript
import { useIncidentStats } from '@/hooks/useComplianceAutomation';

export function StatsPanel() {
  const { stats } = useIncidentStats();

  if (!stats) return <p>Loading...</p>;

  return (
    <div>
      <p>Total: {stats.total}</p>
      <p>Open: {stats.open}</p>
      <p>Resolved: {stats.resolved}</p>
      <p>Avg Resolution: {stats.averageResolutionTime} min</p>
    </div>
  );
}
```

---

## Remediation Template Schema

### Template Structure

```typescript
interface RemediationTemplate {
  id: string;
  category: 'gdpr' | 'security' | 'performance';
  trigger: string;
  actions: RemediationAction[];
  priority: 'low' | 'medium' | 'high' | 'critical';
  description: string;
  successCriteria: string[];
  rollbackPlan?: string;
}
```

### Action Structure

```typescript
interface RemediationAction {
  id: string;
  type: 'auto' | 'manual' | 'workflow';
  category: 'gdpr' | 'security' | 'performance';
  trigger: string;
  action: string;
  priority: 'low' | 'medium' | 'high' | 'critical';
  estimatedDuration: number; // minutes
  requiresApproval: boolean;
  autoExecute: boolean;
}
```

### Example GDPR Template

```json
{
  "id": "gdpr-slow-response",
  "category": "gdpr",
  "trigger": "GDPR response time > 25 days",
  "actions": [
    {
      "id": "gdpr-slow-response-1",
      "type": "auto",
      "action": "Flag all pending data requests",
      "priority": "high",
      "estimatedDuration": 15,
      "requiresApproval": false,
      "autoExecute": true
    },
    {
      "id": "gdpr-slow-response-2",
      "type": "manual",
      "action": "Prioritize oldest requests first",
      "priority": "high",
      "estimatedDuration": 120,
      "requiresApproval": true,
      "autoExecute": false
    }
  ],
  "successCriteria": [
    "All requests processed within 25 days",
    "Response time < 20 days"
  ]
}
```

---

## Workflow Configuration

### Critical Incident Workflow

```typescript
{
  id: 'critical-incident',
  name: 'Critical Incident Response',
  trigger: 'Compliance score < 50%',
  steps: [
    {
      id: 'step-1',
      name: 'Detect incident',
      action: 'notify',
      handler: 'notifySecurityTeam',
      timeout: 60,
      onFailure: 'escalate'
    },
    {
      id: 'step-2',
      name: 'Create incident ticket',
      action: 'execute',
      handler: 'createIncidentTicket',
      timeout: 30,
      onFailure: 'escalate'
    },
    {
      id: 'step-3',
      name: 'Assign to on-call',
      action: 'notify',
      handler: 'assignToOncall',
      timeout: 120,
      onFailure: 'escalate'
    },
    {
      id: 'step-4',
      name: 'Validate resolution',
      action: 'validate',
      condition: 'compliance_score > 75',
      timeout: 3600,
      onFailure: 'escalate'
    }
  ],
  escalationPath: ['security-lead', 'ciso', 'cto'],
  notificationChannels: ['email', 'slack', 'pagerduty'],
  autoResolve: false,
  timeLimit: 120
}
```

---

## Automation Rules

### Rule Structure

```typescript
interface AutomationRule {
  id: string;
  trigger: string; // Condition (e.g., "GDPR score < 75%")
  action: string;  // Remediation or workflow
  enabled: boolean;
  priority: 'low' | 'medium' | 'high' | 'critical';
}
```

### Example Rules

```
Rule 1:
  Trigger: GDPR score < 75%
  Action: Apply gdpr-slow-response template
  Priority: high

Rule 2:
  Trigger: Security failures > 10%
  Action: Apply security-high-failures template
  Priority: critical

Rule 3:
  Trigger: LCP > 3000ms
  Action: Apply performance-high-lcp template
  Priority: high

Rule 4:
  Trigger: Composite risk > 60%
  Action: Trigger critical-incident workflow
  Priority: critical
```

---

## Incident Status Transitions

```
open ──apply_template──> in_progress
  ↑                           ↓
  ├─ execute_auto_actions ───┤
  ├─ wait_approval ──────────┤
  ├─ execute_manual ─────────┤
  ↓                           ↓
  └─── escalate <──── resolve
       │
       ├──> escalated (leadership intervention)
       └──> resolved (fixed)
```

---

## Statistics Calculation

```typescript
// Incident Stats
const stats = {
  total: incidents.length,
  open: incidents.filter(i => i.status === 'open').length,
  inProgress: incidents.filter(i => i.status === 'in_progress').length,
  resolved: incidents.filter(i => i.status === 'resolved').length,
  escalated: incidents.filter(i => i.status === 'escalated').length,
  
  // Average resolution time (only for resolved)
  averageResolutionTime: resolved.length > 0
    ? resolved.reduce((sum, i) => sum + (i.resolution?.resolvedAt - i.createdAt), 0) / resolved.length / 1000 / 60
    : 0  // in minutes
}
```

---

## Approval Workflow

```
Action requires approval
  ↓
Add to pendingApproval list
  ↓
Display in Pending Approvals panel
  ↓
User approves → executeAction()
  ↓
Action executes and completes
  OR
User rejects → remove from queue
  ↓
Incident stays in_progress
```

---

## Error Handling

### Action Failure

```
Action execution fails
  ↓
Step onFailure directive:
  ├─ stop: Halt workflow
  ├─ continue: Move to next step
  └─ escalate: Jump to escalation path
```

### Workflow Failure

```
Workflow timeout exceeded
  ↓
Escalate to higher authority
  ↓
Notify escalationPath contacts
  ↓
Incident status → escalated
```

---

## Performance Optimization

**Action Batching:**
- Auto-actions execute in parallel
- Manual actions queued for review
- Reduces incident resolution time

**Template Caching:**
- Load templates on engine init
- Cache in memory
- Update on manual template creation

**Statistics Calculation:**
- Auto-refresh every 60 seconds
- Incremental updates
- Avoid full recalculation

---

## Testing Guide

### Unit Tests
- Incident creation
- Template application
- Action execution
- Workflow step execution
- Statistics calculation

### Integration Tests
- Full incident lifecycle
- Workflow automation
- Approval flows
- Escalation paths

### E2E Tests
- Create incident → apply template → execute → resolve
- Trigger workflow → step through → escalate
- Approval flow → approve → execute → complete

---

## Security Considerations

1. **Approval Gates** — Critical actions require approval
2. **Audit Trail** — All actions logged
3. **Escalation** — Unresolved issues escalate automatically
4. **Rate Limiting** — Prevent action spam
5. **Notification** — Secure channels only (Slack, PagerDuty, email)

---

## Integration with Prior Slices

**Slice 21** (Predictive Monitoring)
→ Predictions trigger incident creation

**Slice 20** (Dashboards)
→ Incidents displayed in overview

**Slice 19** (Reporting)
→ Remediations become recommendations

---

## Files Summary

| File | Lines | Purpose |
|------|-------|---------|
| `lib/compliance/remediationEngine.ts` | 800 | Incident & remediation engine |
| `hooks/useComplianceAutomation.ts` | 540 | React hooks |
| `app/academy/compliance/automation.tsx` | 700 | Components |
| `app/academy/compliance/automation-page.tsx` | 680 | Main page |
| **Total** | **2,720** | |

