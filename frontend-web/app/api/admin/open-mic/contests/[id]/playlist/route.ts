import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicAdmin, assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { getFinalePlaylist, saveFinalePlaylist } from '@/src/server/openmic/persistence';

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    assertOpenMicReadAdmin(request);
    const playlist = await getFinalePlaylist(context.params.id);
    return successResponse({ success: true, playlist });
  } catch (error) {
    return handleApiError(error, 'Failed to load finale playlist');
  }
}

export async function POST(request: Request, context: { params: { id: string } }) {
  try {
    assertOpenMicAdmin(request);
    const body = (await request.json()) as { entries?: Array<{ submissionId?: string; order?: number }> };
    const entries = (body.entries || [])
      .filter((item) => item.submissionId)
      .map((item) => ({ submissionId: String(item.submissionId), order: item.order }));
    if (entries.length === 0) return errorResponse('entries is required', 400);
    const playlist = await saveFinalePlaylist(context.params.id, entries);
    return successResponse({ success: true, playlist });
  } catch (error) {
    return handleApiError(error, 'Failed to save finale playlist');
  }
}
