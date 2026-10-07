import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { castVote, getContestById } from '@/src/server/openmic/persistence';
import { createAdminClient } from '@/lib/supabase/server';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);

    const body = (await request.json().catch(() => null)) as {
      contestId?: string;
      submissionId?: string;
      voterName?: string;
      source?: 'free' | 'paid' | 'bundle' | 'bonus';
      votes?: number;
      paymentReference?: string;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);

    if (!body.contestId)    return errorResponse('contestId is required', 400);
    if (!body.submissionId) return errorResponse('submissionId is required', 400);
    if (!body.source)       return errorResponse('source is required', 400);
    // Paid/bundle/bonus votes carry money — they may ONLY be cast through the
    // verified rail (/api/open-mic/votes/pay/initiate + /pay/verify, which calls
    // castVote after server-side Paystack verification). A caller-asserted
    // source:'paid' here mints votes (and a 'successful' payment event) with no
    // payment at all — forged votes.
    if (body.source !== 'free') {
      return errorResponse('Only free votes are cast on this route — paid votes must go through pay/initiate + pay/verify.', 400);
    }
    if (!body.votes || body.votes <= 0) return errorResponse('votes must be greater than 0', 400);
    if (body.votes > 10000)             return errorResponse('votes exceeds maximum per request', 400);

    const contest = await getContestById(body.contestId);
    const freeVotesPerDay = contest?.votingConfig?.freeVotesPerDay ?? 3;
    if (freeVotesPerDay <= 0) {
      return errorResponse('Free voting is not enabled for this contest.', 403);
    }

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
    const remaining = freeVotesPerDay - usedToday;
    if (remaining <= 0) {
      return errorResponse(
        `You have used all ${freeVotesPerDay} free vote${freeVotesPerDay !== 1 ? 's' : ''} for today. Free votes reset at midnight.`,
        429,
      );
    }
    // The daily cap must bound the REQUEST size too — without this a single
    // call mints up to 10,000 free votes regardless of freeVotesPerDay.
    if (body.votes > remaining) {
      return errorResponse(
        `Only ${remaining} free vote${remaining !== 1 ? 's' : ''} remaining today (limit ${freeVotesPerDay}/day).`,
        429,
      );
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
