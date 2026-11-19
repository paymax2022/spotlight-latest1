/**
 * "What stage am I at, and what may I do next?"
 *
 * One round trip for the Open Mic screen: whether the beat is published and where
 * it is, whether this account has been approved (and through which plane), whether
 * the submission window currently allows a hand-in, and what the applicant already
 * has in flight. Without it a client had to infer the stage from three endpoints
 * that each disagreed about what "Open Mic" even meant.
 *
 * Read-only and self-scoped: the caller can only ever ask about themselves.
 */
import { publicBeatUrl } from '@/src/features/openmic/beat-storage';
import { songReaderUrl } from '@/src/features/openmic/song-storage';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getContestBySlug, listSubmissions } from '@/src/server/openmic/persistence';
import { getSongSubmissionEligibility } from '@/src/server/openmic/submission-eligibility';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const { searchParams } = new URL(request.url);
    const contestSlug = String(searchParams.get('contestSlug') || '').trim();
    if (!contestSlug) return errorResponse('contestSlug is required', 400);

    const contest = await getContestBySlug(contestSlug);
    if (!contest) return errorResponse('Contest not found', 404);

    const verdict = await getSongSubmissionEligibility(contest, user.id);
    const submissions = (await listSubmissions({ contestId: contest.id, userId: user.id })).filter(
      (item) => item.artistUserId === user.id,
    );
    const latest = submissions[0];

    return successResponse({
      success: true,
      eligibility: {
        contestId: contest.id,
        contestSlug: contest.slug,
        status: contest.status,
        canSubmitSong: verdict.eligible,
        reason: verdict.reason,
        source: verdict.source,
        beat: contest.beat
          ? {
              id: contest.beat.id,
              title: contest.beat.beatTitle,
              genre: contest.beat.genre,
              durationSeconds: contest.beat.durationSeconds,
              producerCredit: contest.beat.producerCredit,
              usageRules: contest.beat.usageRules,
              // Only the public reader counts as playable: a stored value that is
              // a legacy owner-only path or an off-origin free-text URL cannot be
              // heard by an applicant, and pretending otherwise gives the phone a
              // `<audio>` that silently fails.
              previewUrl: publicBeatUrl(contest.beat.previewUrl) || publicBeatUrl(contest.beat.downloadUrl),
              downloadUrl:
                contest.beat.allowDownload === false || contest.beat.previewOnly === true
                  ? null
                  : publicBeatUrl(contest.beat.downloadUrl) || publicBeatUrl(contest.beat.previewUrl),
            }
          : null,
        window: verdict.window,
        submission: latest
          ? {
              id: latest.id,
              status: latest.status,
              songTitle: latest.songTitle,
              hasSong: Boolean(latest.songObjectKey),
              playableUrl: songReaderUrl(latest.id),
              submittedAt: latest.submittedAt,
            }
          : null,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to load Open Mic eligibility');
  }
}
