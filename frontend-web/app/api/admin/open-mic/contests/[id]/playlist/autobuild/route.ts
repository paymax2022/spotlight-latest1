import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicAdmin } from '@/src/server/openmic/auth';
import { buildFinalePlaylistFromFinalists } from '@/src/server/openmic/persistence';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    await assertOpenMicAdmin(request);
    const playlist = await buildFinalePlaylistFromFinalists(params.id);
    return successResponse({ success: true, playlist });
  } catch (error) {
    return handleApiError(error, 'Failed to auto-build finale playlist');
  }
}

