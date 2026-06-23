import { randomUUID } from 'crypto';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createR2UploadUrl, sanitizeObjectFileName } from '@/src/lib/storage/r2';
import { getContestBySlug } from '@/src/server/openmic/persistence';

const MAX_MP3_BYTES = 50 * 1024 * 1024;
const ALLOWED_AUDIO_TYPE = 'audio/mp3';

function isSubmissionWindowOpen(contest: Awaited<ReturnType<typeof getContestBySlug>>) {
  if (!contest) return false;
  if (contest.status === 'submission_open') return true;
  const end = contest.submissionEndAt ? Date.parse(contest.submissionEndAt) : Number.NaN;
  const start = contest.submissionStartAt ? Date.parse(contest.submissionStartAt) : Number.NaN;
  const now = Date.now();
  if (Number.isFinite(start) && now < start) return false;
  if (Number.isFinite(end) && now > end) return false;
  return Number.isFinite(start) || Number.isFinite(end);
}

export async function POST(request: Request) {
  try {
    const user = await requireRequestUser(request);
    const body = (await request.json()) as {
      contestSlug?: string;
      fileName?: string;
      fileSize?: number;
      contentType?: string;
    };
    const contestSlug = String(body.contestSlug || '').trim();
    const fileName = sanitizeObjectFileName(String(body.fileName || ''));
    const contentType = String(body.contentType || '').toLowerCase();
    const fileSize = Number(body.fileSize || 0);

    if (!contestSlug) return errorResponse('contestSlug is required', 400);
    if (!fileName.toLowerCase().endsWith('.mp3')) return errorResponse('Only MP3 uploads are allowed', 400);
    if (contentType !== ALLOWED_AUDIO_TYPE) return errorResponse('File type must be audio/mp3', 400);
    if (!Number.isFinite(fileSize) || fileSize <= 0) return errorResponse('fileSize is required', 400);
    if (fileSize > MAX_MP3_BYTES) return errorResponse('MP3 file must be 50MB or less', 400);

    const contest = await getContestBySlug(contestSlug);
    if (!contest) return errorResponse('Contest not found', 404);
    if (!isSubmissionWindowOpen(contest)) {
      return errorResponse('Song upload deadline is closed for this contest', 403);
    }

    const submissionId = randomUUID();
    const artistId = user.id;
    const contestId = contest.slug || contest.id;
    const objectKey = `openmic/${contestId}/${artistId}/${submissionId}.mp3`;

    const uploadUrl = await createR2UploadUrl({ key: objectKey, contentType });
    return successResponse(
      {
        success: true,
        upload: {
          contestId,
          artistId,
          submissionId,
          objectKey,
          uploadUrl,
          method: 'PUT',
          headers: { 'Content-Type': contentType },
          maxBytes: MAX_MP3_BYTES,
        },
      },
      201
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    const message = error instanceof Error ? error.message : 'Failed to create upload URL';
    return handleApiError(new Error(message), message);
  }
}
