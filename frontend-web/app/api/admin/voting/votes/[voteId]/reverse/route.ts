import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createAdminClient } from '@/lib/supabase/server';
import { incrementVoteTotals } from '@/src/server/voting/totals.service';
import { appendAuditLog } from '@/src/server/voting/audit.service';

export async function POST(
  request: Request,
  context: { params: Promise<{ voteId: string }> },
) {
  try {
    const identity = await assertAdminPermission(request, 'votes:manage');
    const { voteId } = await context.params;
    const body = (await request.json()) as { reason: string };

    if (!body.reason || body.reason.trim().length < 5) {
      return errorResponse('A reason of at least 5 characters is required', 400);
    }

    const supabase = createAdminClient();

    // Fetch the vote
    const { data: vote, error: voteErr } = await supabase
      .from('votes')
      .select('*')
      .eq('id', voteId)
      .maybeSingle();

    if (voteErr || !vote) return errorResponse('Vote not found', 404);
    if ((vote as any).vote_status === 'reversed') {
      return errorResponse('Vote is already reversed', 400);
    }

    const v = vote as any;

    // Mark vote reversed
    await supabase
      .from('votes')
      .update({
        vote_status: 'reversed',
        reversal_reason: body.reason,
        reversed_at: new Date().toISOString(),
      })
      .eq('id', voteId);

    // Update totals
    const quantity = Math.abs(Number(v.vote_quantity));
    await incrementVoteTotals(v.contest_id, v.contestant_id, {
      reversedVotes: quantity,
    });

    await appendAuditLog({
      actorId: identity.actorId,
      actorRole: identity.role,
      action: 'vote_reversed',
      entityType: 'vote',
      entityId: voteId,
      contestId: v.contest_id,
      contestantId: v.contestant_id,
      oldValue: { vote_status: v.vote_status, vote_quantity: v.vote_quantity },
      newValue: { vote_status: 'reversed', reversal_reason: body.reason },
      reason: body.reason,
    });

    return successResponse({ success: true, voteId, reversedQuantity: quantity });
  } catch (error) {
    return handleApiError(error, 'Failed to reverse vote');
  }
}
