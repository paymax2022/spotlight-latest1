import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getApplication, getApplicationTimeline } from '@/src/server/stem/persistence';
import { requireUser } from '@/src/lib/auth/server';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { user } = await requireUser(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return errorResponse('Invalid application ID', 400);
    const current = await getApplication(id);
    if (!current) return errorResponse('Application not found', 404);
    if (current.applicantUserId !== user.id) return errorResponse('Forbidden', 403);

    const timeline = await getApplicationTimeline(id);
    return successResponse({ success: true, timeline });
  } catch (error) {
    return handleApiError(error, 'Failed to load STEM application timeline');
  }
}
