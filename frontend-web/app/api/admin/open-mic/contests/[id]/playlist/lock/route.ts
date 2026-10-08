import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicAdmin } from '@/src/server/openmic/auth';
import { setFinalePlaylistLocked } from '@/src/server/openmic/persistence';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    await assertOpenMicAdmin(request);
    const body = (await request.json().catch(() => null)) as { locked?: boolean };
    if (!body) return errorResponse('Invalid JSON body', 400);
    if (typeof body.locked !== 'boolean') return errorResponse('locked boolean is required', 400);
    const contest = await setFinalePlaylistLocked(params.id, body.locked);
    return successResponse({ success: true, contest });
  } catch (error) {
    return handleApiError(error, 'Failed to update finale playlist lock');
  }
}

