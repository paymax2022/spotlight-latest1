import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { listBeatDownloads } from '@/src/server/openmic/persistence';

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    await assertOpenMicReadAdmin(request);
    const downloads = await listBeatDownloads(context.params.id);
    return successResponse({ success: true, downloads });
  } catch (error) {
    return handleApiError(error, 'Failed to list beat downloads');
  }
}
