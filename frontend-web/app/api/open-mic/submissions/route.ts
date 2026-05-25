import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { createSubmission, listSubmissions } from '@/src/server/openmic/persistence';

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId') || undefined;
    const status = (searchParams.get('status') as any) || undefined;
    const submissions = await listSubmissions({ contestId, status });
    return successResponse({ success: true, submissions });
  } catch (error) {
    return handleApiError(error, 'Failed to list open mic submissions');
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as any;
    if (!body.contestSlug) return errorResponse('contestSlug is required', 400);
    if (!body.stageName) return errorResponse('stageName is required', 400);
    if (!body.genre) return errorResponse('genre is required', 400);
    if (!body.songTitle) return errorResponse('songTitle is required', 400);
    if (!body.songUrl) return errorResponse('songUrl is required', 400);

    const result = await createSubmission({
      contestSlug: body.contestSlug,
      artistUserId: body.artistUserId,
      stageName: body.stageName,
      realName: body.realName,
      email: body.email,
      phone: body.phone,
      genre: body.genre,
      songTitle: body.songTitle,
      songMood: body.songMood,
      language: body.language,
      songUrl: body.songUrl,
      videoUrl: body.videoUrl,
      lyricsUrl: body.lyricsUrl,
      artworkUrl: body.artworkUrl,
      story: body.story,
      votingSlogan: body.votingSlogan,
      fanMessage: body.fanMessage,
      explicitVersion: Boolean(body.explicitVersion),
      cleanVersionAvailable: Boolean(body.cleanVersionAvailable),
      officialBeatConfirmed: Boolean(body.officialBeatConfirmed),
      ownershipConfirmed: Boolean(body.ownershipConfirmed),
      noUnauthorizedSamplesConfirmed: Boolean(body.noUnauthorizedSamplesConfirmed),
      finaleAvailabilityConfirmed: Boolean(body.finaleAvailabilityConfirmed),
    });

    if (!result.success) return successResponse(result, 400);
    return successResponse(result, 201);
  } catch (error) {
    const message =
      (error instanceof Error ? error.message : undefined) ||
      (typeof error === 'object' && error && 'message' in error && typeof (error as any).message === 'string'
        ? (error as any).message
        : undefined) ||
      'Failed to create song submission';
    return handleApiError(new Error(message), message);
  }
}
