import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { getContestById, getFinalePlaylist, updateContest } from '@/src/server/openmic/persistence';
import type { OpenMicContest } from '@/src/features/openmic/types';

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    assertOpenMicReadAdmin(request);
    const [contest, playlist] = await Promise.all([
      getContestById(context.params.id),
      getFinalePlaylist(context.params.id),
    ]);
    return successResponse({ success: true, contest, playlist });
  } catch (error) {
    return handleApiError(error, 'Failed to load finale details');
  }
}

export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    assertOpenMicReadAdmin(request);
    const body = (await request.json()) as { finale?: OpenMicContest['finale']; status?: OpenMicContest['status'] };
    const contest = await updateContest(context.params.id, {
      finale: body.finale,
      status: body.status,
    });
    return successResponse({ success: true, contest });
  } catch (error) {
    return handleApiError(error, 'Failed to update finale');
  }
}
