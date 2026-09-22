import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { proposeApproval } from '@/src/server/voting/contest-approvals.service';

// UAT Batch 8 (SEC-005/G-MC): this route used to execute the reversal
// immediately under a single admin's authority. It now only PROPOSES the
// action — the actual reversal (incl. wallet refund) runs from
// sensitive-actions.service.ts#executeVoteReversal, invoked by a second
// approver via POST /api/admin/voting/approvals/[approvalId]/approve.
export async function POST(
  request: Request,
  context: { params: Promise<{ voteId: string }> },
) {
  try {
    const identity = await assertAdminPermission(request, 'votes:sensitive:initiate');
    const { voteId } = await context.params;
    const body = (await request.json()) as { reason: string };

    if (!body.reason || body.reason.trim().length < 5) {
      return errorResponse('A reason of at least 5 characters is required', 400);
    }

    const idempotencyKey =
      request.headers.get('Idempotency-Key') || request.headers.get('idempotency-key') || undefined;

    const result = await proposeApproval({
      actionType: 'vote_reversal',
      // contest_id is unknown from the payload alone without an extra read of
      // the vote row — left null, matching the migration's nullable column
      // note (display-only field, not required for correctness).
      contestId: null,
      payload: { voteId, reason: body.reason.trim() },
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
    return handleApiError(error, 'Failed to propose vote reversal');
  }
}
