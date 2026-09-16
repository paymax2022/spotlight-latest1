import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { getContestById, getLeaderboard } from '@/src/server/openmic/persistence';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    await assertOpenMicReadAdmin(request);
    const contest = await getContestById(params.id);
    const leaderboard = await getLeaderboard(params.id);
    const totalVotes = leaderboard.reduce((sum, row) => sum + row.voteCount, 0);
    const votePrice = contest?.votingConfig.votePrice || 0;
    return successResponse({
      success: true,
      totalVotes,
      votePrice,
      paidVoteRevenue: totalVotes * votePrice,
      leaderboard: leaderboard.slice(0, 100),
    });
  } catch (error) {
    return handleApiError(error, 'Failed to load voting analytics');
  }
}
