import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { listSubmissions } from '@/src/server/openmic/persistence';
import { createR2DownloadUrl } from '@/src/lib/storage/r2';

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    await assertOpenMicReadAdmin(request);
    const { searchParams } = new URL(request.url);
    const disposition = searchParams.get('download') === '1' ? 'attachment' : 'inline';
    const submissions = await listSubmissions();
    const submission = submissions.find((item) => item.id === context.params.id);
    if (!submission) return errorResponse('Submission not found', 404);

    if (!submission.songObjectKey) {
      if (!submission.songUrl) return errorResponse('Submission has no song upload', 404);
      return successResponse({ success: true, signedUrl: submission.songUrl });
    }

    const signedUrl = await createR2DownloadUrl({
      key: submission.songObjectKey,
      fileName: submission.songFileName || `${submission.songTitle}.mp3`,
      disposition,
    });
    return successResponse({ success: true, signedUrl });
  } catch (error) {
    return handleApiError(error, 'Failed to create song access URL');
  }
}
