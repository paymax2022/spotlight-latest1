import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getWeek, castVote, retractVote, getVotesForWeek, getVoteTallies, getContestant } from '@/src/server/services/reality-show/store';
import { createClient } from '@/lib/supabase/server';

async function getVoterName(userId: string): Promise<string> {
  try {
    const supabase = await createClient();
    const { data } = await supabase.from('user_profiles').select('full_name').eq('id', userId).maybeSingle();
    return (data as { full_name?: string } | null)?.full_name || userId;
  } catch {
    return userId;
  }
}

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await assertAdminPermission(request, 'dashboard:view');
    const week = getWeek(params.id);
    if (!week) return errorResponse('Week not found', 404);

    const votes = getVotesForWeek(params.id);
    const tallies = getVoteTallies(params.id).map((t) => ({
      ...t,
      contestant: getContestant(t.contestantId),
    }));

    return successResponse({ week, votes, tallies });
  } catch (error) {
    return handleApiError(error, 'Failed to get votes');
  }
}

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    const week = getWeek(params.id);
    if (!week) return errorResponse('Week not found', 404);
    if (week.status !== 'open') return errorResponse('Voting is not open for this week', 400);

    const body = await request.json() as { contestantId?: string; reason?: string; retract?: boolean };
    if (!body.contestantId) return errorResponse('contestantId is required', 400);

    if (!getContestant(body.contestantId)) return errorResponse('Contestant not found', 404);

    if (body.retract) {
      retractVote(params.id, identity.actorId, body.contestantId);
      return successResponse({ retracted: true });
    }

    const voterName = await getVoterName(identity.actorId);
    const vote = castVote({
      weekId: params.id,
      voterId: identity.actorId,
      voterName,
      voterRole: identity.role,
      contestantId: body.contestantId,
      reason: body.reason,
    });
    return successResponse({ vote });
  } catch (error) {
    return handleApiError(error, 'Failed to cast vote');
  }
}
