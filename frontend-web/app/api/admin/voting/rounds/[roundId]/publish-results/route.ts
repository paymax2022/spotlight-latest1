import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { proposeApproval } from '@/src/server/voting/contest-approvals.service';

type RouteContext = { params: Promise<{ roundId: string }> };

// UAT Batch 8 (SEC-005/G-MC): this route used to compute, publish, and lock
// results immediately under a single admin's authority. It now only PROPOSES
// the action — the actual compute/publish/lock runs from
// sensitive-actions.service.ts#executeResultsPublish, invoked by a second
// approver via POST /api/admin/voting/approvals/[approvalId]/approve.
//
// The already-published guard (409) still happens HERE, before proposing —
// no point proposing to publish a round that's already locked. It is also
// re-checked at execute-time (inside executeResultsPublish and, atomically,
// inside the publish_voting_round_results() RPC), since an approval can sit
// pending for a while and the round could be published via another path in
// the meantime.
export async function POST(request: Request, ctx: RouteContext) {
  try {
    const identity = await assertAdminPermission(request, 'votes:sensitive:initiate');
    const { roundId } = await ctx.params;

    const supabase = createAdminClient();

    const { data: round, error: roundError } = await supabase
      .from('voting_rounds')
      .select('id, contest_id, status, name')
      .eq('id', roundId)
      .maybeSingle();

    if (roundError) return errorResponse(`Failed to load round: ${roundError.message}`, 500);
    if (!round) return errorResponse('Voting round not found', 404);

    if ((round as any).status === 'results_published') {
      return errorResponse(
        'Results already published and locked for this round — publishing is a one-time, immutable action.',
        409,
      );
    }

    const contestId = (round as any).contest_id as string;

    const idempotencyKey =
      request.headers.get('Idempotency-Key') || request.headers.get('idempotency-key') || undefined;

    const result = await proposeApproval({
      actionType: 'results_publish',
      contestId,
      payload: { roundId },
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
    return handleApiError(error, 'Failed to propose results publish');
  }
}
