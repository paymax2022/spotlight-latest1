import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getContestBySlug, getLeaderboard } from '@/src/server/openmic/persistence';

export async function GET(_request: Request, context: { params: { slug: string } }) {
  try {
    const contest = await getContestBySlug(context.params.slug);
    if (!contest) return errorResponse('Contest not found', 404);
    const leaderboard = await getLeaderboard(contest.id);
    return successResponse({ success: true, contest, leaderboard });
  } catch (error) {
    return handleApiError(error, 'Failed to load open mic contest');
  }
}

