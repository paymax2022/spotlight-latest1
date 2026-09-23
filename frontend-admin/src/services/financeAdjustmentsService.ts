/**
 * Finance adjustment approvals — ADR-005 maker-checker checker-side UI.
 *
 * WAL-004: closing the payments-finance wallet-adjustment bypass (see
 * paymentsFinanceAdminService.ts's adjustWallet()) meant repointing the
 * admin console at the real, already-tested maker-checker endpoint
 * (POST /api/v1/admin/adjustments — frontend-web/src/server/admin/fintech/service.ts).
 * That endpoint queues any adjustment >= ₦100,000 as 'pending_approval'
 * instead of executing it — but nothing in frontend-admin consumed the
 * list/approve/reject routes that already existed server-side
 * (GET /api/v1/admin/adjustments, POST .../[id]/approve, POST .../[id]/reject).
 * Without this queue, a large adjustment would go in and simply never come
 * out: not closing the defect, just changing its shape from "unlimited
 * instant money movement" to "large adjustments get permanently stuck".
 *
 * Mirrors contestApprovalsService.ts's shape and conventions (same
 * ApprovalActionError class pattern, same 409-race / 403-self-approval
 * handling contract) — that module is the established maker-checker UI
 * precedent in this codebase (see docs/adr/ADR-005-maker-checker.md).
 *
 * PATH A: goes through frontend-web via the admin web proxy, same as
 * paymentsFinanceAdminService.ts.
 */
import { webProxyBase } from '@/config/env';

export type AdjustmentType = 'CREDIT' | 'DEBIT';
export type AdjustmentStatus = 'pending_approval' | 'executed' | 'rejected' | 'cancelled';

export interface Adjustment {
  id: string;
  idempotencyKey: string;
  initiatorId: string;
  initiatorRole: string;
  targetUserId: string;
  type: AdjustmentType;
  amountKobo: number;
  reason: string;
  status: AdjustmentStatus;
  checkerId: string | null;
  checkerRole: string | null;
  checkerNote: string | null;
  checkedAt: string | null;
  ledgerEntryId: string | null;
  createdAt: string;
}

/**
 * A 409 means the adjustment was already decided by someone else since the
 * list was loaded — a real race in a multi-admin console, not a bug. A 403
 * means the caller is the original initiator (self-approval/self-rejection,
 * blocked server-side). Callers should catch this specifically — see
 * contestApprovalsService.ts's ApprovalActionError for the precedent.
 */
export class ApprovalActionError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = 'ApprovalActionError';
    this.status = status;
  }
}

function webBase(): string {
  return webProxyBase();
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  const base = extra ?? {};
  if (typeof window === 'undefined') return base;
  const token = localStorage.getItem('spotlight_admin_access_token') || '';
  return token ? { ...base, Authorization: `Bearer ${token}` } : base;
}

async function readJsonOrThrow(res: Response, label: string): Promise<Record<string, unknown>> {
  const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) {
    const message = (payload as { error?: string })?.error || `${label} failed: ${res.status}`;
    throw new ApprovalActionError(message, res.status);
  }
  return payload;
}

function toAdjustment(row: Record<string, unknown>): Adjustment {
  return {
    id: String(row.id ?? ''),
    idempotencyKey: String(row.idempotencyKey ?? ''),
    initiatorId: String(row.initiatorId ?? ''),
    initiatorRole: String(row.initiatorRole ?? ''),
    targetUserId: String(row.targetUserId ?? ''),
    type: (row.type as AdjustmentType) ?? 'CREDIT',
    amountKobo: Number(row.amountKobo ?? 0),
    reason: String(row.reason ?? ''),
    status: (row.status as AdjustmentStatus) ?? 'pending_approval',
    checkerId: (row.checkerId as string | null) ?? null,
    checkerRole: (row.checkerRole as string | null) ?? null,
    checkerNote: (row.checkerNote as string | null) ?? null,
    checkedAt: (row.checkedAt as string | null) ?? null,
    ledgerEntryId: (row.ledgerEntryId as string | null) ?? null,
    createdAt: String(row.createdAt ?? ''),
  };
}

export async function listAdjustments(opts?: { status?: AdjustmentStatus }): Promise<Adjustment[]> {
  const qs = new URLSearchParams();
  if (opts?.status) qs.set('status', opts.status);
  const query = qs.toString();
  const res = await fetch(`${webBase()}/api/v1/admin/adjustments${query ? `?${query}` : ''}`, {
    cache: 'no-store',
    headers: authHeaders(),
  });
  const json = await readJsonOrThrow(res, 'Loading adjustments');
  const rows = (json.adjustments ?? []) as Array<Record<string, unknown>>;
  return rows.map(toAdjustment);
}

export interface AdjustmentDecisionResult {
  adjustmentId: string;
  ledgerEntryId?: string | null;
}

export async function approveAdjustment(adjustmentId: string, checkerNote?: string): Promise<AdjustmentDecisionResult> {
  const idempotencyKey = crypto.randomUUID();
  const res = await fetch(`${webBase()}/api/v1/admin/adjustments/${encodeURIComponent(adjustmentId)}/approve`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey }),
    body: JSON.stringify(checkerNote ? { checker_note: checkerNote } : {}),
  });
  const json = await readJsonOrThrow(res, 'Approving adjustment');
  return json.adjustment as unknown as AdjustmentDecisionResult;
}

export async function rejectAdjustment(adjustmentId: string, checkerNote: string): Promise<void> {
  const res = await fetch(`${webBase()}/api/v1/admin/adjustments/${encodeURIComponent(adjustmentId)}/reject`, {
    method: 'POST',
    headers: authHeaders({ 'Content-Type': 'application/json' }),
    body: JSON.stringify({ checker_note: checkerNote }),
  });
  await readJsonOrThrow(res, 'Rejecting adjustment');
}
