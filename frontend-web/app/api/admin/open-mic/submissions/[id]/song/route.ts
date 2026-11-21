import { songReaderUrl } from '@/src/features/openmic/song-storage';
import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { createR2DownloadUrl, hasR2Config } from '@/src/lib/storage/r2';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { listSubmissions } from '@/src/server/openmic/persistence';

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    await assertOpenMicReadAdmin(request);
    const { searchParams } = new URL(request.url);
    const download = searchParams.get('download') === '1';
    const submissions = await listSubmissions();
    const submission = submissions.find((item) => item.id === params.id);
    if (!submission) return errorResponse('Submission not found', 404);

    if (!submission.songObjectKey) {
      if (!submission.songUrl) return errorResponse('Submission has no song upload', 404);
      return successResponse({ success: true, signedUrl: submission.songUrl });
    }

    // Local development has no bucket to sign against, but the song is on disk and
    // the public reader serves it. Returning the reader path keeps the admin
    // play/download buttons working in every deployment instead of 500ing here.
    if (!hasR2Config()) {
      return successResponse({
        success: true,
        signedUrl: `${songReaderUrl(submission.id)}${download ? '?download=1' : ''}`,
      });
    }

    const signedUrl = await createR2DownloadUrl({
      key: submission.songObjectKey,
      fileName: submission.songFileName || `${submission.songTitle}.mp3`,
      disposition: download ? 'attachment' : 'inline',
    });
    return successResponse({ success: true, signedUrl });
  } catch (error) {
    return handleApiError(error, 'Failed to create song access URL');
  }
}
