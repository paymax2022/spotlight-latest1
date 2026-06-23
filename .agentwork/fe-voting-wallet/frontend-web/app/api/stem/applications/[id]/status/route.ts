import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getApplication, getApplicationTimeline } from '@/src/server/stem/persistence';
import { requireUser } from '@/src/lib/auth/server';

export async function GET(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const { user } = await requireUser(request);
    const current = await getApplication(context.params.id);
    if (!current) return errorResponse('Application not found', 404);
    if (current.applicantUserId !== user.id) return errorResponse('Forbidden', 403);

    const timeline = await getApplicationTimeline(context.params.id);
    return successResponse({ success: true, timeline });
  } catch (error) {
    return handleApiError(error, 'Failed to load STEM application timeline');
  }
}
