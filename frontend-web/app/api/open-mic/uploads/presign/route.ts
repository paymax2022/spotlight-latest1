/**
 * Ask for permission to hand in a song.
 *
 * The answer now comes with a `mode`, because "where do the bytes go?" is a
 * deployment question rather than a client question: with R2 credentials the
 * server signs a PUT straight to the bucket, and without them (localhost, CI)
 * the client POSTs multipart to `/api/open-mic/uploads`, which holds the file on
 * disk. Both modes return the same `objectKey`, `submissionId` and `readerUrl`,
 * so `complete` and every reader afterwards are identical.
 *
 * The eligibility gate here is the one change with security weight: this route
 * used to check only the submission window, so a signed-up-but-`pending`
 * applicant could obtain a presigned PUT for the bucket.
 */
import { randomUUID } from 'crypto';
import { DIRECT_SONG_UPLOAD_PATH, SONG_CONTENT_TYPE } from '@/src/features/openmic/song-storage';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createR2UploadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { resolveOpenMicEdition } from '@/src/server/openmic/edition-resolution';
import { getSongSubmissionEligibility } from '@/src/server/openmic/submission-eligibility';
import {
  eligibilityForbiddenResponse,
  guardSongContentType,
  guardSongFileName,
  guardSongSize,
  songUploadDescriptor,
} from '@/src/server/openmic/song-upload-request';

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json().catch(() => null)) as {
      contestSlug?: string;
      fileName?: string;
      fileSize?: number;
      contentType?: string;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);
    const contestSlug = String(body.contestSlug || '').trim();
    const fileName = String(body.fileName || '');
    const contentType = String(body.contentType || '');
    const fileSize = body.fileSize;

    if (!contestSlug) return errorResponse('contestSlug is required', 400);
    const nameGuard = guardSongFileName(fileName);
    if (!nameGuard.ok) return errorResponse(nameGuard.message, 400);
    const typeGuard = guardSongContentType(contentType);
    if (!typeGuard.ok) return errorResponse(typeGuard.message, 400);
    const sizeGuard = guardSongSize(fileSize);
    if (!sizeGuard.ok) return errorResponse(sizeGuard.message, 400);

    // A caller may pass the catalog slug (`open-mic-competition`) or the edition's
    // own; one rule maps either onto the live edition — see resolveOpenMicEdition.
    const contest = await resolveOpenMicEdition(contestSlug);
    if (!contest) return errorResponse('Contest not found', 404);

    const verdict = await getSongSubmissionEligibility(contest, user.id);
    if (!verdict.eligible) return eligibilityForbiddenResponse(verdict);

    const submissionId = randomUUID();
    const upload = songUploadDescriptor({ contest, artistUserId: user.id, submissionId });

    if (!hasR2Config()) {
      return successResponse(
        {
          success: true,
          upload: {
            ...upload,
            mode: 'direct' as const,
            uploadUrl: DIRECT_SONG_UPLOAD_PATH,
            method: 'POST' as const,
            fieldName: 'file' as const,
            headers: {},
          },
        },
        201,
      );
    }

    // The object we presign is always served back as mp3, whatever the client
    // declared; `SONG_CONTENT_TYPE` keeps the signature and the stored metadata
    // on one value instead of echoing a client string into a signed header.
    const uploadUrl = await createR2UploadUrl({ key: upload.objectKey, contentType: SONG_CONTENT_TYPE });
    return successResponse(
      {
        success: true,
        upload: {
          ...upload,
          mode: 'presigned' as const,
          uploadUrl,
          method: 'PUT' as const,
          fieldName: null,
          headers: { 'Content-Type': SONG_CONTENT_TYPE },
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to create upload URL');
  }
}
