import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { createSubmission, listSubmissions } from '@/src/server/openmic/persistence';
import { requireRequestUser } from '@/src/lib/auth/request';

export async function GET(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId') || undefined;
    const status = (searchParams.get('status') as any) || undefined;
    const submissions = await listSubmissions({ contestId, status, userId: user.id });
    return successResponse({ success: true, submissions });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to list open mic submissions');
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as any;
    if (!body.contestSlug) return errorResponse('contestSlug is required', 400);
    if (!body.stageName) return errorResponse('stageName is required', 400);
    for (const key of ['country', 'state', 'lga']) {
      if (!String(body?.[key] || '').trim()) return errorResponse(`${key} is required`, 400);
    }
    const hasSocialHandle = [
      body.instagramHandle,
      body.tiktokHandle,
      body.youtubeHandle,
      body.facebookHandle,
      body.xHandle,
    ].some((value) => String(value || '').trim());
    if (!hasSocialHandle) return errorResponse('At least one social media handle is required', 400);
    if (!body.songUrl && !body.songObjectKey) return errorResponse('song upload is required', 400);
    if (body.songObjectKey && !body.submissionId) return errorResponse('submissionId is required for uploaded songs', 400);

    const result = await createSubmission({
      contestSlug: body.contestSlug,
      artistUserId: user.id,
      stageName: body.stageName,
      realName: body.realName,
      email: body.email,
      phone: body.phone,
      country: String(body.country || '').trim(),
      state: String(body.state || '').trim(),
      lga: String(body.lga || '').trim(),
      instagramHandle: String(body.instagramHandle || '').trim() || undefined,
      tiktokHandle: String(body.tiktokHandle || '').trim() || undefined,
      youtubeHandle: String(body.youtubeHandle || '').trim() || undefined,
      facebookHandle: String(body.facebookHandle || '').trim() || undefined,
      xHandle: String(body.xHandle || '').trim() || undefined,
      genre: typeof body.genre === 'string' ? body.genre.trim() : '',
      songTitle: typeof body.songTitle === 'string' ? body.songTitle.trim() : '',
      songMood: body.songMood,
      language: body.language,
      songUrl: body.songUrl || '',
      submissionId: body.submissionId,
      songObjectKey: body.songObjectKey,
      songFileName: body.songFileName,
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
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    const message =
      (error instanceof Error ? error.message : undefined) ||
      (typeof error === 'object' && error && 'message' in error && typeof (error as any).message === 'string'
        ? (error as any).message
        : undefined) ||
      'Failed to create song submission';
    return handleApiError(new Error(message), message);
  }
}
