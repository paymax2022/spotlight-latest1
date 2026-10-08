import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getContestBySlug, getLeaderboard } from '@/src/server/openmic/persistence';

export async function GET(_request: Request, context: { params: Promise<{ slug: string }> }) {
  try {
    const { slug } = await context.params;
    const contest = await getContestBySlug(slug);
    if (!contest) return errorResponse('Contest not found', 404);
    const leaderboard = await getLeaderboard(contest.id);
    // Public leaderboard: strip entrant PII (realName/email/phone/user id) and
    // storage internals (songObjectKey) that mapSubmissionRow carries for the
    // owner/admin views.
    const publicLeaderboard = leaderboard.map((entry) => ({
      id: entry.id,
      contestId: entry.contestId,
      stageName: entry.stageName,
      country: entry.country,
      state: entry.state,
      genre: entry.genre,
      songTitle: entry.songTitle,
      songUrl: entry.songUrl,
      songFileName: entry.songFileName,
      videoUrl: entry.videoUrl,
      artworkUrl: entry.artworkUrl,
      story: entry.story,
      votingSlogan: entry.votingSlogan,
      fanMessage: entry.fanMessage,
      instagramHandle: entry.instagramHandle,
      tiktokHandle: entry.tiktokHandle,
      youtubeHandle: entry.youtubeHandle,
      facebookHandle: entry.facebookHandle,
      xHandle: entry.xHandle,
      status: entry.status,
      voteCount: entry.voteCount,
      leaderboardScore: entry.leaderboardScore,
      isFinalist: entry.isFinalist,
      isWinner: entry.isWinner,
      submittedAt: entry.submittedAt,
      publishedAt: entry.publishedAt,
    }));
    return successResponse({ success: true, contest, leaderboard: publicLeaderboard });
  } catch (error) {
    return handleApiError(error, 'Failed to load open mic contest');
  }
}

