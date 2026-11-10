import path from 'path';
import { randomUUID } from 'crypto';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { hasR2Config, uploadR2Object } from '@/src/lib/storage/r2';
import { saveLocalUpload } from '@/src/lib/storage/local-uploads';
import { beatObjectKey, beatReaderUrl } from '@/src/features/openmic/beat-storage';

/**
 * Upload this edition's official beat.
 *
 * Same shape as the contest banner upload: admin-gated on 'programs:manage'
 * (only someone who may edit the contest should attach its beat), server-side
 * credentials, R2 when configured and the local disk otherwise. The difference
 * is what it returns — root-relative reader paths for the caller to store in
 * `competition_beats.preview_url` / `download_url`, replacing the
 * /api/registration/uploads/ values that only the uploader could open.
 *
 * 50MB matches the artist's own submission cap (app/api/open-mic/uploads/presign),
 * so a beat is never smaller than the songs recorded over it.
 */
const MAX_BEAT_BYTES = 50 * 1024 * 1024;
const ALLOWED_TYPES = new Set(['', 'audio/mp3', 'audio/mpeg']);
const SAFE_TOKEN = /^[A-Za-z0-9._-]{1,64}$/;

export async function POST(request: Request) {
  try {
    // Before touching the body: an unauthorised caller learns nothing about
    // which payloads are valid.
    await assertAdminPermission(request, 'programs:manage');

    const formData = await request.formData().catch(() => null);
    if (!formData) return errorResponse('Expected multipart/form-data', 415);

    const contestIdFromQuery = new URL(request.url).searchParams.get('contestId');
    const rawContestId = String(contestIdFromQuery || formData.get('contestId') || '').trim();
    // The builder uploads the beat before the contest row exists, so an id is
    // optional — but it becomes part of the object key, so it must be a token.
    const contestId = rawContestId || 'unassigned';
    // `..` is refused on top of the token class because the public reader
    // (app/api/open-mic/beats/[fileKey]) checks `!key.includes('..')`: a key
    // carrying it would be stored happily and 404 forever, which is the one
    // pairing this route must never break.
    if (rawContestId && (!SAFE_TOKEN.test(rawContestId) || rawContestId.includes('..'))) {
      return errorResponse('contestId is not a valid identifier', 400);
    }

    const file = formData.get('file');
    if (!(file instanceof File)) return errorResponse('file is required', 400);
    if (path.extname(file.name).toLowerCase() !== '.mp3') {
      return errorResponse('Beat must be an MP3 file', 400);
    }
    if (!ALLOWED_TYPES.has(String(file.type || '').toLowerCase())) {
      return errorResponse('Beat must be an MP3 audio file', 400);
    }
    if (file.size > MAX_BEAT_BYTES) {
      return errorResponse('Beat must be 50MB or less', 400);
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const objectKey = beatObjectKey(contestId, randomUUID());
    if (hasR2Config()) {
      await uploadR2Object({ key: objectKey, body: buffer, contentType: 'audio/mpeg' });
    } else {
      await saveLocalUpload(objectKey, buffer);
    }

    return successResponse(
      {
        success: true,
        beat: {
          objectKey,
          previewUrl: beatReaderUrl(objectKey),
          downloadUrl: beatReaderUrl(objectKey, { download: true }),
          fileName: file.name,
          sizeBytes: file.size,
        },
      },
      201,
    );
  } catch (error) {
    console.error('[admin/open-mic/beats] upload failed:', error);
    return handleApiError(error, 'Failed to upload beat');
  }
}
