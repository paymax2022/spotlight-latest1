/**
 * Vote audit log admin data — PATH A (frontend-web via /api/web-proxy), same
 * shape as votePackagesService.
 *
 * WHY THIS EXISTS
 * Voting admin actions (settings changes, vote adjustments/reversals,
 * freeze/unfreeze) are durably recorded in `vote_audit_logs` via
 * appendAuditLog/getAuditLogs (frontend-web/src/server/voting/audit.service.ts,
 * brownfield-protected — never edit it directly), but until
 * GET /api/admin/voting/{contestId}/audit-log was added there was no admin
 * route to query that trail at all. `frontend-admin/audit-logs` and the web
 * app's own `/api/admin/audit-logs` both read unrelated tables (a generic
 * in-memory admin event log, and the Go backend's separate `audit_logs`) —
 * neither ever touches `vote_audit_logs`.
 */
import { webProxyBase } from '@/config/env';

export type VoteAuditEntry = {
  id: string;
  actorId: string | null;
  actorRole: string | null;
  action: string;
  entityType: string;
  entityId: string;
  contestId: string | null;
  contestantId: string | null;
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  reason: string | null;
  ipAddress: string | null;
  deviceFingerprint: string | null;
  userAgent: string | null;
  createdAt: string;
};

export type VoteAuditLogFilters = {
  entityType?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
};

function authHeaders(): Record<string, string> {
  if (typeof window === 'undefined') return { 'Content-Type': 'application/json' };
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token
    ? { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((payload as { error?: string })?.error || `${label} failed: ${res.status}`);
  }
  return payload as Record<string, unknown>;
}

function toEntry(row: Record<string, unknown>): VoteAuditEntry {
  return {
    id: String(row.id ?? ''),
    actorId: (row.actor_id as string | null) ?? null,
    actorRole: (row.actor_role as string | null) ?? null,
    action: String(row.action ?? ''),
    entityType: String(row.entity_type ?? ''),
    entityId: String(row.entity_id ?? ''),
    contestId: (row.contest_id as string | null) ?? null,
    contestantId: (row.contestant_id as string | null) ?? null,
    oldValue: (row.old_value as Record<string, unknown> | null) ?? null,
    newValue: (row.new_value as Record<string, unknown> | null) ?? null,
    reason: (row.reason as string | null) ?? null,
    ipAddress: (row.ip_address as string | null) ?? null,
    deviceFingerprint: (row.device_fingerprint as string | null) ?? null,
    userAgent: (row.user_agent as string | null) ?? null,
    createdAt: String(row.created_at ?? ''),
  };
}

export async function listVoteAuditLog(
  contestId: string,
  filters: VoteAuditLogFilters = {},
): Promise<VoteAuditEntry[]> {
  const params = new URLSearchParams();
  if (filters.entityType) params.set('entityType', filters.entityType);
  if (filters.entityId) params.set('entityId', filters.entityId);
  params.set('limit', String(filters.limit ?? 100));
  params.set('offset', String(filters.offset ?? 0));

  const res = await fetch(
    `${webProxyBase()}/api/admin/voting/${encodeURIComponent(contestId)}/audit-log?${params.toString()}`,
    { cache: 'no-store', headers: authHeaders() },
  );
  const json = await readJsonOrThrow(res, 'Loading voting audit log');
  const rows = (json.entries ?? []) as Array<Record<string, unknown>>;
  return rows.map(toEntry);
}
