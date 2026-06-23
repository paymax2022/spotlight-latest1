import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { getVoteTotals, incrementVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';
import type { AdminAdjustmentType } from '@/src/features/voting/types';

// Admin vote adjustment — every change requires a reason and creates an audit trail.
export async function POST(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { contestId } = await context.params;

    const body = (await request.json()) as {
      contestantId: string;
      adjustmentType: AdminAdjustmentType;
      voteQuantity: number;
      reason: string;
    };

    if (!body.contestantId) return errorResponse('contestantId is required', 400);
    if (!body.adjustmentType) return errorResponse('adjustmentType is required', 400);
    if (!body.voteQuantity || body.voteQuantity <= 0) return errorResponse('voteQuantity must be > 0', 400);
    if (!body.reason || body.reason.trim().length < 5) return errorResponse('A reason of at least 5 characters is required', 400);

    const supabase = createAdminClient();

    // Fetch current totals
    const currentTotals = await getVoteTotals(contestId, body.contestantId);
    const beforeTotal = currentTotals?.totalConfirmedVotes ?? 0;

    // Apply the adjustment
    let delta: { adminAdjustmentVotes?: number; reversedVotes?: number } = {};
    let voteRecord: Record<string, unknown> = {};

    if (body.adjustmentType === 'add') {
      delta = { adminAdjustmentVotes: body.voteQuantity };
      voteRecord = {
        contest_id: contestId,
        contestant_id: body.contestantId,
        vote_type: 'admin_adjustment',
        vote_quantity: body.voteQuantity,
        vote_status: 'confirmed',
        fraud_score: 0,
        fraud_status: 'clean',
        confirmed_at: new Date().toISOString(),
      };
    } else if (body.adjustmentType === 'subtract' || body.adjustmentType === 'reverse') {
      delta = { reversedVotes: body.voteQuantity };
      voteRecord = {
        contest_id: contestId,
        contestant_id: body.contestantId,
        vote_type: 'fraud_reversal',
        vote_quantity: -body.voteQuantity,
        vote_status: 'reversed',
        reversal_reason: body.reason,
        reversed_at: new Date().toISOString(),
        fraud_score: 0,
        fraud_status: 'clean',
      };
    }

    await incrementVoteTotals(contestId, body.contestantId, delta);

    if (Object.keys(voteRecord).length > 0) {
      await supabase.from('votes').insert(voteRecord);
    }

    const afterTotals = await getVoteTotals(contestId, body.contestantId);
    const afterTotal = afterTotals?.totalConfirmedVotes ?? 0;

    // Record the adjustment with full audit trail
    await supabase.from('admin_vote_adjustments').insert({
      contest_id: contestId,
      contestant_id: body.contestantId,
      admin_id: identity.actorId,
      adjustment_type: body.adjustmentType,
      vote_quantity: body.voteQuantity,
      reason: body.reason,
      before_total: beforeTotal,
      after_total: afterTotal,
      status: 'applied',
      applied_at: new Date().toISOString(),
    });

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'admin_vote_adjustment',
      entityType: 'vote_totals',
      entityId: body.contestantId,
      contestId,
      contestantId: body.contestantId,
      oldValue: { totalConfirmedVotes: beforeTotal },
      newValue: { totalConfirmedVotes: afterTotal, adjustmentType: body.adjustmentType, voteQuantity: body.voteQuantity },
      reason: body.reason,
    });

    return successResponse({ success: true, beforeTotal, afterTotal, adjustment: body.voteQuantity });
  } catch (error) {
    return handleApiError(error, 'Failed to apply vote adjustment');
  }
}
