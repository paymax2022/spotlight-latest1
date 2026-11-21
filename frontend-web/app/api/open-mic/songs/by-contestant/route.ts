/**
 * GET /api/open-mic/songs/by-contestant?contestSlug=&contestantId=
 *
 * The companion the shared voting profile needs: `app/api/vote-page/route.ts` is a
 * protected-legacy file whose contestant payload has always ended in
 * `audioUrl: null`, and the Open Mic song lives on a different plane
 * (`competition_entries`, keyed by the artist's user id). This resolves the two
 * without touching the voting engine's response contract.
 *
 * Public by design — a voter is usually signed out — and it returns only what the
 * public reader would already serve: the newest submission whose status is
 * publicly playable, as a root-relative `/api/open-mic/songs/<id>` URL. A draft is
 * never named here, and a contest that is not Open Mic answers `audioUrl: null`
 * rather than an error, because the caller renders no player in both cases.
 */
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getVoterSong } from '@/src/server/openmic/voter-song';

export const dynamic = 'force-dynamic';

export async function GET(request: Request) {
  try {
    const params = new URL(request.url).searchParams;
    const contestSlug = String(params.get('contestSlug') || '').trim();
    const contestantId = String(params.get('contestantId') || '').trim();
    if (!contestSlug || !contestantId) {
      return errorResponse('contestSlug and contestantId are required', 400);
    }

    const song = await getVoterSong({ contestSlug, contestantId });
    return successResponse(
      {
        audioUrl: song?.audioUrl ?? null,
        songTitle: song?.songTitle ?? null,
        submissionId: song?.submissionId ?? null,
      },
      200,
    );
  } catch (error) {
    return handleApiError(error, 'Unable to load this song');
  }
}
