/**
 * Multipart song sink for environments without object storage.
 *
 * Production has R2 credentials and never reaches this code — it keeps answering
 * 410 so the app server is not turned into a file server. Without credentials
 * (localhost, CI) there is nothing to presign, and this route is the only way a
 * song can be handed in at all; that is why it existed as a stub rather than
 * having been deleted.
 *
 * Everything the presign route decided still applies here, re-decided from the
 * bytes we actually received rather than from a client's `fileSize` claim.
 */
import { MAX_SONG_BYTES, isSongObjectKeyFor, songReaderUrl } from '@/src/features/openmic/song-storage';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { hasR2Config } from '@/src/lib/storage/r2';
import { saveLocalUpload } from '@/src/lib/storage/local-uploads';
import { getContestBySlug } from '@/src/server/openmic/persistence';
import { getSongSubmissionEligibility } from '@/src/server/openmic/submission-eligibility';
import {
  eligibilityForbiddenResponse,
  guardSongContentType,
  guardSongFileName,
  isSubmissionId,
  songObjectKeyFor,
} from '@/src/server/openmic/song-upload-request';

const DIRECT_DISABLED_MESSAGE =
  'Direct uploads are disabled. Use /api/open-mic/uploads/presign, upload directly to R2, then call /api/open-mic/uploads/complete.';

export async function POST(request: Request) {
  try {
    if (hasR2Config()) return errorResponse(DIRECT_DISABLED_MESSAGE, 410);

    const user = await requireRequestUser(request);

    let form: FormData;
    try {
      form = await request.formData();
    } catch {
      return errorResponse('Multipart form-data body is required', 400);
    }

    const file = form.get('file');
    const contestSlug = String(form.get('contestSlug') || '').trim();
    const submissionId = String(form.get('submissionId') || '').trim();

    if (!(file instanceof File)) return errorResponse('file is required', 400);
    if (!contestSlug) return errorResponse('contestSlug is required', 400);
    if (!isSubmissionId(submissionId)) return errorResponse('A valid submissionId is required', 400);

    const nameGuard = guardSongFileName(file.name);
    if (!nameGuard.ok) return errorResponse(nameGuard.message, 400);
    // An empty `file.type` is what some pickers send; the extension already has to
    // be .mp3, so only a *declared* non-audio type is a real contradiction.
    if (file.type) {
      const typeGuard = guardSongContentType(file.type);
      if (!typeGuard.ok) return errorResponse(typeGuard.message, 400);
    }
    // Server's own count of the bytes, not the client's claim.
    if (file.size <= 0) return errorResponse('Uploaded file is empty', 400);
    if (file.size > MAX_SONG_BYTES) return errorResponse('MP3 file must be 50MB or less', 400);

    const contest = await getContestBySlug(contestSlug);
    if (!contest) return errorResponse('Contest not found', 404);

    const verdict = await getSongSubmissionEligibility(contest, user.id);
    if (!verdict.eligible) return eligibilityForbiddenResponse(verdict);

    const objectKey = songObjectKeyFor({ contest, artistUserId: user.id, submissionId });
    // Belt and braces behind the key builder: this is the one route where the key
    // becomes a filesystem path, so re-assert the ownership shape before writing.
    if (
      !isSongObjectKeyFor({ key: objectKey, contestRef: String(contest.slug || contest.id), artistUserId: user.id })
    ) {
      return errorResponse('Upload object does not belong to this contest/user', 403);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    await saveLocalUpload(objectKey, buffer);

    return successResponse(
      {
        success: true,
        upload: {
          stored: true,
          contestId: contest.slug || contest.id,
          artistId: user.id,
          submissionId,
          objectKey,
          readerUrl: songReaderUrl(submissionId),
          sizeBytes: buffer.byteLength,
          fileName: file.name,
        },
      },
      201,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to upload song');
  }
}
