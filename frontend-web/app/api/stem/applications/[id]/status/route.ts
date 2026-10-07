import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getApplication, getApplicationTimeline } from '@/src/server/stem/persistence';
import { requireUser } from '@/src/lib/auth/server';

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    const current = await getApplication(id);
    if (!current) return errorResponse('Application not found', 404);
    if (current.applicantUserId !== user.id) return errorResponse('Forbidden', 403);

    const timeline = await getApplicationTimeline(id);
    return successResponse({ success: true, timeline });
  } catch (error) {
    return handleApiError(error, 'Failed to load STEM application timeline');
  }
}
