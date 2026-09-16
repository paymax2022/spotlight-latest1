/**
 * UAT Batch 8 (SEC-005/G-MC) — Contest maker-checker approvals.
 *
 * Mirrors frontend-web/src/server/admin/fintech/service.ts (ADR-005) — same
 * propose/approve/reject/list shape, same self-approval guard pattern — but
 * covers all THREE Contest sensitive actions (vote_reversal, vote_adjustment,
 * results_publish) through one table (contest_admin_approvals) with an
 * action_type + payload column, and with NO auto-execute threshold: every
 * proposal always requires a second approver.
 */
import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import type { AdminIdentity } from '@/src/server/admin/auth';
import {
  executeVoteReversal,
  executeVoteAdjustment,
  executeResultsPublish,
  type VoteAdjustmentParams,
} from '@/src/server/voting/sensitive-actions.service';

export type ContestApprovalActionType = 'vote_reversal' | 'vote_adjustment' | 'results_publish';
export type ContestApprovalStatus = 'pending_approval' | 'executed' | 'rejected' | 'cancelled';

export interface ContestApprovalRecord {
  id: string;
  actionType: ContestApprovalActionType;
  contestId: string | null;
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
}

function mapRow(row: Record<string, unknown>): ContestApprovalRecord {
  return {
    id: String(row.id ?? ''),
    actionType: row.action_type as ContestApprovalActionType,
    contestId: (row.contest_id as string | null) ?? null,
    payload: (row.payload as Record<string, unknown>) ?? {},
    status: row.status as ContestApprovalStatus,
    initiatorId: String(row.initiator_id ?? ''),
    initiatorRole: String(row.initiator_role ?? ''),
    checkerId: (row.checker_id as string | null) ?? null,
    checkerRole: (row.checker_role as string | null) ?? null,
    checkerNote: (row.checker_note as string | null) ?? null,
    checkedAt: (row.checked_at as string | null) ?? null,
    executedAt: (row.executed_at as string | null) ?? null,
    executionResult: (row.execution_result as Record<string, unknown> | null) ?? null,
    createdAt: String(row.created_at ?? ''),
  };
}

// ---------------------------------------------------------------------------
// proposeApproval
// ---------------------------------------------------------------------------

export interface ProposeApprovalInput {
  actionType: ContestApprovalActionType;
  contestId: string | null;
  payload: Record<string, unknown>;
  initiatorId: string;
  initiatorRole: string;
  idempotencyKey?: string;
}

export interface ProposeApprovalResult {
  id: string;
  status: ContestApprovalStatus;
  /** true when an existing row (matched by idempotencyKey) was returned instead of inserting a new one. */
  alreadyProposed: boolean;
}

// Idempotency: mirrors admin_adjustments/fintech-service's re-propose handling
// — a repeated Idempotency-Key returns the EXISTING row's state rather than
// inserting a duplicate proposal (checked up front, and again on a 23505 race
// against the idempotency_key UNIQUE constraint).
export async function proposeApproval(input: ProposeApprovalInput): Promise<ProposeApprovalResult> {
  const supabase = createAdminClient();

  if (input.idempotencyKey) {
    const { data: existing } = await supabase
      .from('contest_admin_approvals')
      .select('id, status')
      .eq('idempotency_key', input.idempotencyKey)
      .maybeSingle();
    if (existing) {
      const row = existing as { id: string; status: string };
      return { id: row.id, status: row.status as ContestApprovalStatus, alreadyProposed: true };
    }
  }

  const { data: inserted, error } = await supabase
    .from('contest_admin_approvals')
    .insert({
      action_type: input.actionType,
      contest_id: input.contestId,
      payload: input.payload,
      status: 'pending_approval',
      initiator_id: input.initiatorId,
      initiator_role: input.initiatorRole,
      idempotency_key: input.idempotencyKey ?? null,
    })
    .select('id, status')
    .single();

  if (error) {
    if ((error as { code?: string }).code === '23505' && input.idempotencyKey) {
      // Race on idempotency_key — re-fetch instead of failing.
      const { data: raced } = await supabase
        .from('contest_admin_approvals')
        .select('id, status')
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();
      if (raced) {
        const row = raced as { id: string; status: string };
        return { id: row.id, status: row.status as ContestApprovalStatus, alreadyProposed: true };
      }
    }
    throw new ApiError(`Failed to propose action: ${error.message}`, 500);
  }

  const row = inserted as { id: string; status: string };
  return { id: row.id, status: row.status as ContestApprovalStatus, alreadyProposed: false };
}

// ---------------------------------------------------------------------------
// approveApproval / rejectApproval
// ---------------------------------------------------------------------------

async function loadPendingApproval(approvalId: string): Promise<Record<string, unknown>> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from('contest_admin_approvals')
    .select('*')
    .eq('id', approvalId)
    .maybeSingle();

  if (error || !data) throw new ApiError('Approval not found', 404);
  const row = data as Record<string, unknown>;
  if (row.status !== 'pending_approval') {
    throw new ApiError(`Approval is already '${row.status}' — cannot act on it`, 409);
  }
  return row;
}

// Execution semantics: verify identity + self-approval guard, THEN execute the
// underlying action in the SAME request. If execution throws, the row is
// NEVER marked executed and checker fields are NEVER persisted — the error
// propagates to the caller and the row stays 'pending_approval' so it can be
// retried. A failed execution attempt must never silently look like "a
// checker approved this and nothing happened."
export async function approveApproval(
  approvalId: string,
  identity: AdminIdentity,
  checkerNote?: string,
): Promise<Record<string, unknown>> {
  const row = await loadPendingApproval(approvalId);

  // Self-approval guard (belt + suspenders over the DB CHECK constraint) —
  // mirrors frontend-web/src/server/admin/fintech/service.ts#approveAdjustment.
  if (row.initiator_id === identity.actorId) {
    throw new ApiError('Self-approval is not permitted', 403);
  }

  const payload = (row.payload as Record<string, unknown>) ?? {};
  const executionIdentity = { actorId: identity.actorId, role: identity.role };

  let executionResult: Record<string, unknown>;
  switch (row.action_type) {
    case 'vote_reversal':
      executionResult = (await executeVoteReversal(
        payload.voteId as string,
        payload.reason as string,
        executionIdentity,
      )) as unknown as Record<string, unknown>;
      break;
    case 'vote_adjustment':
      executionResult = (await executeVoteAdjustment(
        payload as unknown as VoteAdjustmentParams,
        executionIdentity,
      )) as unknown as Record<string, unknown>;
      break;
    case 'results_publish':
      executionResult = (await executeResultsPublish(
        payload.roundId as string,
        executionIdentity,
      )) as unknown as Record<string, unknown>;
      break;
    default:
      throw new ApiError(`Unknown action_type '${row.action_type}'`, 500);
  }

  // Execution succeeded — only now persist the terminal state. If execution
  // threw above, we never reach this update, so the row stays pending.
  const supabase = createAdminClient();
  await supabase
    .from('contest_admin_approvals')
    .update({
      status: 'executed',
      checker_id: identity.actorId,
      checker_role: identity.role,
      checker_note: checkerNote ?? null,
      checked_at: new Date().toISOString(),
      executed_at: new Date().toISOString(),
      execution_result: executionResult,
    })
    .eq('id', approvalId);

  return executionResult;
}

export async function rejectApproval(approvalId: string, identity: AdminIdentity, note: string): Promise<void> {
  if (!note || note.trim().length < 5) {
    throw new ApiError('A note of at least 5 characters is required', 400);
  }

  const row = await loadPendingApproval(approvalId);

  if (row.initiator_id === identity.actorId) {
    throw new ApiError('Self-rejection is not permitted', 403);
  }

  const supabase = createAdminClient();
  await supabase
    .from('contest_admin_approvals')
    .update({
      status: 'rejected',
      checker_id: identity.actorId,
      checker_role: identity.role,
      checker_note: note.trim(),
      checked_at: new Date().toISOString(),
    })
    .eq('id', approvalId);
}

// ---------------------------------------------------------------------------
// listApprovals
// ---------------------------------------------------------------------------

export interface ListApprovalsOptions {
  status?: string;
  contestId?: string;
  limit?: number;
  offset?: number;
}

export async function listApprovals(options: ListApprovalsOptions = {}): Promise<ContestApprovalRecord[]> {
  const supabase = createAdminClient();
  const limit = Math.min(options.limit ?? 50, 200);
  const offset = options.offset ?? 0;

  let query = supabase
    .from('contest_admin_approvals')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.status) query = query.eq('status', options.status);
  if (options.contestId) query = query.eq('contest_id', options.contestId);

  const { data, error } = await query;
  if (error) throw new ApiError('Failed to list approvals', 500);

  return ((data ?? []) as Array<Record<string, unknown>>).map(mapRow);
}

// Human-readable summary so the frontend doesn't need to know each payload
// shape — saves it from branching on actionType just to render a queue row.
export function summarizeApproval(record: ContestApprovalRecord): string {
  const p = record.payload;
  switch (record.actionType) {
    case 'vote_reversal':
      return `Reverse vote ${p.voteId}: ${p.reason}`;
    case 'vote_adjustment':
      return `Adjust votes for contestant ${p.contestantId}: ${p.adjustmentType} ${p.voteQuantity} — ${p.reason}`;
    case 'results_publish':
      return `Publish & lock results for round ${p.roundId}`;
    default:
      return `Unknown action ${record.actionType}`;
  }
}
