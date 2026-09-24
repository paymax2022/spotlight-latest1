import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { proposeApproval } from '@/src/server/voting/contest-approvals.service';
import type { AdminAdjustmentType } from '@/src/features/voting/types';

// UAT Batch 8 (SEC-005/G-MC): this route used to apply the adjustment
// immediately under a single admin's authority. It now only PROPOSES the
// action — the actual adjustment runs from
// sensitive-actions.service.ts#executeVoteAdjustment, invoked by a second
// approver via POST /api/admin/voting/approvals/[approvalId]/approve.
//
// Admin vote adjustment — every change requires a reason and creates an audit trail.
export async function POST(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    const identity = await assertAdminPermission(request, 'votes:sensitive:initiate');
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
    if (!['add', 'subtract', 'reverse'].includes(body.adjustmentType)) {
      // Previously any unrecognized adjustmentType fell through both branches
      // below, leaving `delta` empty — incrementVoteTotals ran as a no-op and
      // the route still returned 200 with beforeTotal === afterTotal, reporting
      // "success" for an adjustment that changed nothing.
      return errorResponse('adjustmentType must be one of: add, subtract, reverse', 400);
    }

    const idempotencyKey =
      request.headers.get('Idempotency-Key') || request.headers.get('idempotency-key') || undefined;

    const result = await proposeApproval({
      actionType: 'vote_adjustment',
      contestId,
      payload: {
        contestId,
        contestantId: body.contestantId,
        adjustmentType: body.adjustmentType,
        voteQuantity: body.voteQuantity,
        reason: body.reason.trim(),
      },
      initiatorId: identity.actorId,
      initiatorRole: identity.role,
      idempotencyKey,
    });

    return successResponse(
      {
        success: true,
        approvalId: result.id,
        status: result.status,
        message: 'Proposed — awaiting a second approver.',
      },
      202,
    );
  } catch (error) {
    return handleApiError(error, 'Failed to propose vote adjustment');
  }
}
