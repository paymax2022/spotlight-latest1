/**
 * Contest maker-checker approvals — PATH A (frontend-web via /api/web-proxy),
 * same shape/conventions as contestResultsService.ts / contestPrizesService.ts.
 *
 * WHY THIS EXISTS
 * Three Contest admin actions (vote reversal, vote count adjustment, results
 * publish/lock) moved from "execute immediately" to "propose, then require a
 * second approver to execute" — mirroring the existing Finance maker-checker
 * feature (see docs/adr/ADR-005-maker-checker.md and
 * paymentsFinanceAdminService.ts / app/admin/association/approvals/page.tsx
 * for the established UI pattern this module reuses).
 *
 * New RBAC permissions gate this server-side: `votes:sensitive:initiate`
 * (propose) and `votes:sensitive:approve` (approve/reject — held ONLY by
 * super_admin, unlike Finance where finance_admin holds both). A proposer
 * can never approve their own proposal — enforced server-side (403). This
 * client does not attempt to replicate that check; it surfaces the server's
 * error message as-is.
 */
import { webProxyBase } from '@/config/env';

export type ContestApprovalActionType = 'vote_reversal' | 'vote_adjustment' | 'results_publish';
export type ContestApprovalStatus = 'pending_approval' | 'executed' | 'rejected' | 'cancelled';

export type ContestApproval = {
  id: string;
  actionType: ContestApprovalActionType;
  contestId: string;
  payload: Record<string, unknown>;
  status: ContestApprovalStatus;
  initiatorId: string;
  initiatorRole: string;
  checkerId: string | null;
  checkerRole: string | null;
  checkerNote: string | null;
  checkedAt: string | null;
  executedAt: string | null;
  executionResult: Record<string, unknown> | null;
  createdAt: string;
  /** Ready-to-display human-readable summary — display directly, do not reconstruct from payload. */
  summary: string;
};

/**
 * A 409 means the item was already decided by someone else since the list
 * was loaded — a real race in a multi-admin console, not a bug. Callers
 * should catch this specifically and refresh rather than showing a raw
 * error toast. A 403 means the caller is the original proposer
 * (self-approval, blocked server-side).
 */
export class ApprovalActionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApprovalActionError';
    this.status = status;
  }
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const base = extra ?? {};
  if (typeof window === 'undefined') return base;
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const payload = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = (payload as { error?: string })?.error || `${label} failed: ${res.status}`;
    throw new ApprovalActionError(message, res.status);
  }
  return payload as Record<string, unknown>;
}

function pick(row: Record<string, unknown>, camel: string, snake: string): unknown {
  return row[camel] !== undefined ? row[camel] : row[snake];
}

function toApproval(row: Record<string, unknown>): ContestApproval {
  return {
    id: String(row.id ?? ''),
    actionType: String(pick(row, 'actionType', 'action_type') ?? 'vote_reversal') as ContestApprovalActionType,
    contestId: String(pick(row, 'contestId', 'contest_id') ?? ''),
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: String(row.status ?? 'pending_approval') as ContestApprovalStatus,
    initiatorId: String(pick(row, 'initiatorId', 'initiator_id') ?? ''),
    initiatorRole: String(pick(row, 'initiatorRole', 'initiator_role') ?? ''),
    checkerId: (pick(row, 'checkerId', 'checker_id') as string | null) ?? null,
    checkerRole: (pick(row, 'checkerRole', 'checker_role') as string | null) ?? null,
    checkerNote: (pick(row, 'checkerNote', 'checker_note') as string | null) ?? null,
    checkedAt: (pick(row, 'checkedAt', 'checked_at') as string | null) ?? null,
    executedAt: (pick(row, 'executedAt', 'executed_at') as string | null) ?? null,
    executionResult: (pick(row, 'executionResult', 'execution_result') as Record<string, unknown> | null) ?? null,
    createdAt: String(pick(row, 'createdAt', 'created_at') ?? ''),
    summary: String(row.summary ?? ''),
  };
}

export async function listApprovals(opts?: { status?: ContestApprovalStatus; contestId?: string }): Promise<ContestApproval[]> {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  if (opts?.contestId) qs.set('contestId', opts.contestId);
  const query = qs.toString();
  const res = await fetch(`${webProxyBase()}/api/admin/voting/approvals${query ? `?${query}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading approvals');
  const rows = (json.approvals ?? []) as Array<Record<string, unknown>>;
  return rows.map(toApproval);
}

export type ApprovalDecisionResult = {
  success: boolean;
  approvalId: string;
  status: ContestApprovalStatus;
  executionResult?: Record<string, unknown>;
};

export async function approveItem(approvalId: string): Promise<ApprovalDecisionResult> {
  const res = await fetch(`${webProxyBase()}/api/admin/voting/approvals/${encodeURIComponent(approvalId)}/approve`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
  });
  const json = await readJsonOrThrow(res, 'Approving item');
  return json as unknown as ApprovalDecisionResult;
}

export async function rejectItem(approvalId: string, note: string): Promise<ApprovalDecisionResult> {
  const res = await fetch(`${webProxyBase()}/api/admin/voting/approvals/${encodeURIComponent(approvalId)}/reject`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ note }),
  });
  const json = await readJsonOrThrow(res, 'Rejecting item');
  return json as unknown as ApprovalDecisionResult;
}

export const ACTION_TYPE_LABEL: Record<ContestApprovalActionType, string> = {
  vote_reversal: 'Vote Reversal',
  vote_adjustment: 'Vote Adjustment',
  results_publish: 'Results Publish',
};
