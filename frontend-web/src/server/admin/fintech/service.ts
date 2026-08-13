/**
 * Block 9 — Fintech Admin Maker-Checker Service
 *
 * Manual wallet adjustments (credit or debit) with two-tier approval:
 *
 *   Adjustment < ₦100,000 (AUTO_EXECUTE_THRESHOLD_KOBO):
 *     → executed immediately by the maker; status = 'executed'
 *
 *   Adjustment ≥ ₦100,000:
 *     → status = 'pending_approval'; requires a different user with
 *       finance:adjust:approve permission to call approveAdjustment()
 *
 * Self-approval: blocked in service + CHECK constraint in DB.
 * Audit trail: every state change recorded in admin_adjustments.
 */

import { createAdminClient } from '@/lib/supabase/server';
import { ApiError } from '@/src/lib/api/responses';
import { creditWallet, debitWallet } from '@/src/server/wallet/service';
import { hasPermission, parseAdminRole } from '@/src/server/admin/rbac';
import { getRequestUserRole } from '@/src/lib/auth/request';

/** Adjustments below this threshold execute immediately (no checker required). */
const AUTO_EXECUTE_THRESHOLD_KOBO = 10_000_000; // ₦100,000

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface AdjustmentRecord {
  id: string;
  idempotencyKey: string;
  initiatorId: string;
  initiatorRole: string;
  targetUserId: string;
  type: 'CREDIT' | 'DEBIT';
  amountKobo: number;
  reason: string;
  status: 'pending_approval' | 'executed' | 'rejected' | 'cancelled';
  checkerId: string | null;
  checkerRole: string | null;
  checkerNote: string | null;
  checkedAt: string | null;
  ledgerEntryId: string | null;
  createdAt: string;
}

// ---------------------------------------------------------------------------
// requireFinanceRole — shared guard
// ---------------------------------------------------------------------------

async function requireFinanceRole(
  userId: string,
  permission: 'finance:adjust:initiate' | 'finance:adjust:approve',
): Promise<string> {
  const rawRole = await getRequestUserRole(userId);
  const role = parseAdminRole(rawRole);
  if (!hasPermission(role, permission)) {
    throw new ApiError(`Role '${role}' does not have permission '${permission}'`, 403);
  }
  return rawRole ?? role;
}

// ---------------------------------------------------------------------------
// executeAdjustment — shared execution path
// ---------------------------------------------------------------------------

async function executeAdjustment(
  adjustmentId: string,
  targetUserId: string,
  type: 'CREDIT' | 'DEBIT',
  amountKobo: number,
  idempotencyKey: string,
  reason: string,
): Promise<string> {
  const supabase = createAdminClient();

  const mutationInput = {
    amountKobo,
    reference: `ADJ_${adjustmentId.slice(0, 8).toUpperCase()}`,
    idempotencyKey: `admin-adjustment:${idempotencyKey}`,
    description: `Admin manual ${type.toLowerCase()}: ${reason}`,
    // ADR-PR98: a manual adjustment moves value against the platform's own
    // clearing pot, not against a payment provider. Naming it explicitly keeps
    // provider_clearing reconcilable against actual PSP settlements.
    counterAccount: 'settlement' as const,
    metadata: { adjustment_id: adjustmentId, type, admin_action: true },
  };

  const result =
    type === 'CREDIT'
      ? await creditWallet(targetUserId, mutationInput)
      : await debitWallet(targetUserId, mutationInput);

  // Update adjustment to executed
  await supabase
    .from('admin_adjustments')
    .update({
      status: 'executed',
      ledger_entry_id: result.alreadyProcessed ? null : null, // entry ID not returned by creditWallet
      updated_at: new Date().toISOString(),
    })
    .eq('id', adjustmentId);

  return adjustmentId;
}

// ---------------------------------------------------------------------------
// initiateAdjustment
// ---------------------------------------------------------------------------

export interface InitiateAdjustmentInput {
  initiatorId: string;
  targetUserId: string;
  type: 'CREDIT' | 'DEBIT';
  amountKobo: number;
  reason: string;
  idempotencyKey: string;
}

export interface InitiateAdjustmentResult {
  adjustmentId: string;
  status: 'pending_approval' | 'executed';
  requiresApproval: boolean;
  alreadyProcessed: boolean;
}

export async function initiateAdjustment(
  input: InitiateAdjustmentInput,
): Promise<InitiateAdjustmentResult> {
  if (!Number.isInteger(input.amountKobo) || input.amountKobo < 1) {
    throw new ApiError('amount_kobo must be a positive integer', 400);
  }
  if (!input.reason || input.reason.trim().length < 10) {
    throw new ApiError('reason must be at least 10 characters', 400);
  }
  if (input.type !== 'CREDIT' && input.type !== 'DEBIT') {
    throw new ApiError("type must be 'CREDIT' or 'DEBIT'", 400);
  }

  const initiatorRoleName = await requireFinanceRole(input.initiatorId, 'finance:adjust:initiate');

  const supabase = createAdminClient();

  // Idempotency check
  const { data: existing } = await supabase
    .from('admin_adjustments')
    .select('id, status')
    .eq('idempotency_key', input.idempotencyKey)
    .maybeSingle();

  if (existing) {
    const row = existing as { id: string; status: string };
    return {
      adjustmentId:     row.id,
      status:           row.status as InitiateAdjustmentResult['status'],
      requiresApproval: row.status === 'pending_approval',
      alreadyProcessed: true,
    };
  }

  const requiresApproval = input.amountKobo >= AUTO_EXECUTE_THRESHOLD_KOBO;
  const initialStatus = requiresApproval ? 'pending_approval' : 'executed';

  // Insert the adjustment record
  const { data: inserted, error: insertError } = await supabase
    .from('admin_adjustments')
    .insert({
      idempotency_key:  input.idempotencyKey,
      initiator_id:     input.initiatorId,
      initiator_role:   initiatorRoleName,
      target_user_id:   input.targetUserId,
      type:             input.type,
      amount_kobo:      input.amountKobo,
      reason:           input.reason.trim(),
      status:           requiresApproval ? 'pending_approval' : 'pending_approval', // always start pending; execute below
    })
    .select('id')
    .single();

  if (insertError) {
    if (insertError.code === '23505') {
      // Race on idempotency_key — re-fetch
      const { data: raced } = await supabase
        .from('admin_adjustments')
        .select('id, status')
        .eq('idempotency_key', input.idempotencyKey)
        .maybeSingle();
      if (raced) {
        const row = raced as { id: string; status: string };
        return { adjustmentId: row.id, status: row.status as InitiateAdjustmentResult['status'], requiresApproval: false, alreadyProcessed: true };
      }
    }
    throw new ApiError(`Failed to create adjustment: ${insertError.message}`, 500);
  }

  const adjustmentId = (inserted as { id: string }).id;

  // Auto-execute if below threshold
  if (!requiresApproval) {
    await executeAdjustment(
      adjustmentId,
      input.targetUserId,
      input.type,
      input.amountKobo,
      input.idempotencyKey,
      input.reason,
    );
  }

  return { adjustmentId, status: initialStatus, requiresApproval, alreadyProcessed: false };
}

// ---------------------------------------------------------------------------
// approveAdjustment
// ---------------------------------------------------------------------------

export interface ApproveAdjustmentInput {
  adjustmentId: string;
  checkerId: string;
  checkerNote?: string;
  idempotencyKey: string;
}

export async function approveAdjustment(
  input: ApproveAdjustmentInput,
): Promise<{ adjustmentId: string; ledgerEntryId: string | null }> {
  const checkerRoleName = await requireFinanceRole(input.checkerId, 'finance:adjust:approve');

  const supabase = createAdminClient();

  const { data: adj, error: fetchError } = await supabase
    .from('admin_adjustments')
    .select('*')
    .eq('id', input.adjustmentId)
    .maybeSingle();

  if (fetchError || !adj) throw new ApiError('Adjustment not found', 404);

  const row = adj as {
    id: string; status: string; initiator_id: string;
    target_user_id: string; type: string; amount_kobo: number;
    reason: string; idempotency_key: string;
  };

  if (row.status !== 'pending_approval') {
    throw new ApiError(`Adjustment is already '${row.status}' — cannot approve`, 409);
  }

  // Self-approval guard (belt + suspenders over the DB CHECK constraint)
  if (row.initiator_id === input.checkerId) {
    throw new ApiError('Self-approval is not permitted', 403);
  }

  // Stamp the checker before executing — so the audit trail is correct even if execution fails
  await supabase
    .from('admin_adjustments')
    .update({
      checker_id:   input.checkerId,
      checker_role: checkerRoleName,
      checker_note: input.checkerNote ?? null,
      checked_at:   new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    })
    .eq('id', input.adjustmentId);

  await executeAdjustment(
    row.id,
    row.target_user_id,
    row.type as 'CREDIT' | 'DEBIT',
    row.amount_kobo,
    row.idempotency_key,
    row.reason,
  );

  return { adjustmentId: input.adjustmentId, ledgerEntryId: null };
}

// ---------------------------------------------------------------------------
// rejectAdjustment
// ---------------------------------------------------------------------------

export interface RejectAdjustmentInput {
  adjustmentId: string;
  checkerId: string;
  checkerNote: string;
}

export async function rejectAdjustment(input: RejectAdjustmentInput): Promise<void> {
  const checkerRoleName = await requireFinanceRole(input.checkerId, 'finance:adjust:approve');

  const supabase = createAdminClient();

  const { data: adj } = await supabase
    .from('admin_adjustments')
    .select('status, initiator_id')
    .eq('id', input.adjustmentId)
    .maybeSingle();

  if (!adj) throw new ApiError('Adjustment not found', 404);

  const row = adj as { status: string; initiator_id: string };

  if (row.status !== 'pending_approval') {
    throw new ApiError(`Adjustment is already '${row.status}' — cannot reject`, 409);
  }

  if (row.initiator_id === input.checkerId) {
    throw new ApiError('Self-rejection is not permitted', 403);
  }

  await supabase
    .from('admin_adjustments')
    .update({
      status:       'rejected',
      checker_id:   input.checkerId,
      checker_role: checkerRoleName,
      checker_note: input.checkerNote,
      checked_at:   new Date().toISOString(),
      updated_at:   new Date().toISOString(),
    })
    .eq('id', input.adjustmentId);
}

// ---------------------------------------------------------------------------
// listAdjustments
// ---------------------------------------------------------------------------

export interface ListAdjustmentsOptions {
  status?: string;
  limit?: number;
  offset?: number;
}

export async function listAdjustments(options: ListAdjustmentsOptions = {}): Promise<AdjustmentRecord[]> {
  const supabase = createAdminClient();
  const limit  = Math.min(options.limit  ?? 20, 100);
  const offset = options.offset ?? 0;

  let query = supabase
    .from('admin_adjustments')
    .select('*')
    .order('created_at', { ascending: false })
    .range(offset, offset + limit - 1);

  if (options.status) query = query.eq('status', options.status);

  const { data, error } = await query;
  if (error) throw new ApiError('Failed to list adjustments', 500);

  return ((data ?? []) as Array<Record<string, unknown>>).map(mapAdjustmentRow);
}

function mapAdjustmentRow(row: Record<string, unknown>): AdjustmentRecord {
  return {
    id:             String(row.id ?? ''),
    idempotencyKey: String(row.idempotency_key ?? ''),
    initiatorId:    String(row.initiator_id ?? ''),
    initiatorRole:  String(row.initiator_role ?? ''),
    targetUserId:   String(row.target_user_id ?? ''),
    type:           row.type as 'CREDIT' | 'DEBIT',
    amountKobo:     Number(row.amount_kobo ?? 0),
    reason:         String(row.reason ?? ''),
    status:         row.status as AdjustmentRecord['status'],
    checkerId:      (row.checker_id as string | null) ?? null,
    checkerRole:    (row.checker_role as string | null) ?? null,
    checkerNote:    (row.checker_note as string | null) ?? null,
    checkedAt:      (row.checked_at as string | null) ?? null,
    ledgerEntryId:  (row.ledger_entry_id as string | null) ?? null,
    createdAt:      String(row.created_at ?? ''),
  };
}
