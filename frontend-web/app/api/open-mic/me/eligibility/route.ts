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
import { listSubmissions } from '@/src/server/openmic/persistence';
import { resolveOpenMicEdition } from '@/src/server/openmic/edition-resolution';
import { getSongSubmissionEligibility } from '@/src/server/openmic/submission-eligibility';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const { searchParams } = new URL(request.url);
    const contestSlug = String(searchParams.get('contestSlug') || '').trim();
    if (!contestSlug) return errorResponse('contestSlug is required', 400);

    // The caller passes the slug it knows, which for an application coming from the
    // registration plane is the CATALOG slug (`open-mic-competition`) rather than
    // the slug of the edition that carries the beat. An exact lookup answered 404
    // for those, and a 404 here is what made the phone's phase panel show neither
    // the beat nor the upload. `resolveOpenMicEdition` is the one rule that maps
    // either slug onto the live edition, and the response then carries the EDITION
    // slug so every later call (beat download, presign, hand-in) uses it.
    const contest = await resolveOpenMicEdition(contestSlug);
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
              // The beat-download POST refuses unless the caller confirms paid
              // access when the edition requires it. A client cannot tick that
              // honestly without knowing the rule exists, so the rule travels
              // with the beat rather than being guessed from the entry fee.
              requiresPaidEntry: contest.beat.requiresPaidEntryForDownload === true,
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
              // The artist's own key, and only ever their own: a `draft` row that
              // already holds bytes is resumable, and without this the client
              // would have to re-upload to find out it had nothing to re-upload.
              // `createSubmission` re-derives and compares the key anyway.
              songObjectKey: latest.songObjectKey ?? null,
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
