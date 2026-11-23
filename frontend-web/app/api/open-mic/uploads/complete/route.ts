/**
 * "The bytes landed — book the submission slot."
 *
 * Runs after the client has PUT (presigned) or POSTed (direct) the mp3. It owns
 * two decisions: does this object really exist, and does its key really name the
 * caller's own slot. Ownership stays structural — the artist id is a segment of
 * the key the server issued, so handing over a key that merely exists in the
 * bucket is not enough to claim someone else's song.
 *
 * The existence check is storage-agnostic, which is what lets localhost complete
 * an upload at all: previously this route called `assertR2ObjectExists`
 * unconditionally and threw on a machine with no bucket.
 */
import { SONG_CONTENT_TYPE, isSongObjectKeyFor, songContestRef, songReaderUrl } from '@/src/features/openmic/song-storage';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { statLocalUpload } from '@/src/lib/storage/local-uploads';
import { assertR2ObjectExists, createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { resolveOpenMicEdition } from '@/src/server/openmic/edition-resolution';
import { recordSubmissionUploadComplete } from '@/src/server/openmic/persistence';
import { isSubmissionId, songObjectKeyFor } from '@/src/server/openmic/song-upload-request';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json().catch(() => null)) as {
      contestSlug?: string;
      submissionId?: string;
      objectKey?: string;
      fileName?: string;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);
    const contestSlug = String(body.contestSlug || '').trim();
    const submissionId = String(body.submissionId || '').trim();
    const objectKey = String(body.objectKey || '').trim();
    if (!contestSlug) return errorResponse('contestSlug is required', 400);
    if (!isSubmissionId(submissionId)) return errorResponse('A valid submissionId is required', 400);
    if (!objectKey) return errorResponse('objectKey is required', 400);

    // A caller may pass the catalog slug (`open-mic-competition`) or the edition's
    // own; one rule maps either onto the live edition — see resolveOpenMicEdition.
    const contest = await resolveOpenMicEdition(contestSlug);
    if (!contest) return errorResponse('Contest not found', 404);

    const expectedObjectKey = songObjectKeyFor({ contest, artistUserId: user.id, submissionId });
    if (
      objectKey !== expectedObjectKey ||
      !isSongObjectKeyFor({ key: objectKey, contestRef: expectedObjectKey.split('/')[1], artistUserId: user.id })
    ) {
      return errorResponse('Upload object does not belong to this contest/user', 403);
    }

    if (hasR2Config()) {
      await assertR2ObjectExists(objectKey);
    } else if (!(await statLocalUpload(objectKey))) {
      return errorResponse('Uploaded song was not found. Upload the file again.', 404);
    }

    const record = await recordSubmissionUploadComplete({
      contestSlug,
      artistUserId: user.id,
      submissionId,
      objectKey,
      fileName: body.fileName,
      mimeType: SONG_CONTENT_TYPE,
    });

    // Presigned GET in production; the public reader path in local mode, which is
    // the same URL every other surface plays through.
    const signedUrl = hasR2Config()
      ? await createR2DownloadUrl({ key: objectKey, fileName: body.fileName, disposition: 'inline' })
      : songReaderUrl(submissionId);

    return successResponse({
      success: true,
      upload: {
        contestId: record.contestId,
        artistId: user.id,
        submissionId,
        objectKey,
        r2ObjectKey: record.r2ObjectKey,
        mimeType: record.mimeType,
        status: record.status,
        fileName: body.fileName,
        readerUrl: songReaderUrl(submissionId),
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
