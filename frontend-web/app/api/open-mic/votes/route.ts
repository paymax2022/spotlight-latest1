import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { castVote, getContestById } from '@/src/server/openmic/persistence';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);

    const body = (await request.json()) as {
      contestId?: string;
      submissionId?: string;
      voterName?: string;
      source?: 'free' | 'paid' | 'bundle' | 'bonus';
      votes?: number;
      paymentReference?: string;
    };

    if (!body.contestId)    return errorResponse('contestId is required', 400);
    if (!body.submissionId) return errorResponse('submissionId is required', 400);
    if (!body.source)       return errorResponse('source is required', 400);
    if (body.source === 'paid' && !body.paymentReference) {
      return errorResponse('paymentReference is required for paid votes', 400);
    }
    if (!body.votes || body.votes <= 0) return errorResponse('votes must be greater than 0', 400);
    if (body.votes > 10000)             return errorResponse('votes exceeds maximum per request', 400);

    // ── Free vote daily-limit check ──────────────────────────────────────
    if (body.source === 'free') {
      const contest = await getContestById(body.contestId);
      const freeVotesPerDay = contest?.votingConfig?.freeVotesPerDay ?? 3;

      if (freeVotesPerDay > 0) {
        const supabase = createAdminClient();
        const dayStart = new Date();
        dayStart.setHours(0, 0, 0, 0);

        const { data: todayVotes } = await supabase
          .from('competition_entry_votes')
          .select('vote_count')
          .eq('competition_id', body.contestId)
          .eq('user_id', user.id)
          .eq('vote_type', 'free')
          .gte('created_at', dayStart.toISOString());

        const usedToday = (todayVotes ?? []).reduce(
          (s: number, r: any) => s + (Number(r.vote_count) || 0), 0
        );

        if (usedToday >= freeVotesPerDay) {
          return errorResponse(
            `You have used all ${freeVotesPerDay} free vote${freeVotesPerDay !== 1 ? 's' : ''} for today. Free votes reset at midnight.`,
            429,
          );
        }
      }
    }

    const submission = await castVote({
      contestId: body.contestId,
      submissionId: body.submissionId,
      voterUserId: user.id,
      voterName: body.voterName,
      source: body.source,
      votes: body.votes,
      paymentReference: body.paymentReference,
    });

    return successResponse({ success: true, newCount: submission.voteCount });
  } catch (error) {
    return handleApiError(error, 'Failed to cast vote');
  }
}
