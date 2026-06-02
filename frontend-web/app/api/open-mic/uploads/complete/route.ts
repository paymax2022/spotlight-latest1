import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { assertR2ObjectExists, createR2DownloadUrl } from '@/src/lib/storage/r2';
import { getContestBySlug, recordSubmissionUploadComplete } from '@/src/server/openmic/persistence';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as {
      contestSlug?: string;
      submissionId?: string;
      objectKey?: string;
      fileName?: string;
    };
    const contestSlug = String(body.contestSlug || '').trim();
    const submissionId = String(body.submissionId || '').trim();
    const objectKey = String(body.objectKey || '').trim();
    if (!contestSlug) return errorResponse('contestSlug is required', 400);
    if (!submissionId) return errorResponse('submissionId is required', 400);
    if (!objectKey) return errorResponse('objectKey is required', 400);

    const contest = await getContestBySlug(contestSlug);
    if (!contest) return errorResponse('Contest not found', 404);

    const contestId = contest.slug || contest.id;
    const expectedObjectKey = `openmic/${contestId}/${user.id}/${submissionId}.mp3`;
    if (objectKey !== expectedObjectKey) {
      return errorResponse('Upload object does not belong to this contest/user', 403);
    }

    await assertR2ObjectExists(objectKey);
    const record = await recordSubmissionUploadComplete({
      contestSlug,
      artistUserId: user.id,
      submissionId,
      objectKey,
      fileName: body.fileName,
      mimeType: 'audio/mp3',
    });
    const signedUrl = await createR2DownloadUrl({
      key: objectKey,
      fileName: body.fileName,
      disposition: 'inline',
    });

    return successResponse({
      success: true,
      upload: {
        contestId,
        artistId: user.id,
        submissionId,
        objectKey,
        r2ObjectKey: record.r2ObjectKey,
        mimeType: record.mimeType,
        status: record.status,
        fileName: body.fileName,
        signedUrl,
      },
    });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to complete upload');
  }
}
