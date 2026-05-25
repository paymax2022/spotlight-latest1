import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { getApplicationTimeline } from '@/src/server/stem/persistence';

export async function GET(
  _request: Request,
  context: { params: { id: string } }
) {
  try {
    const timeline = await getApplicationTimeline(context.params.id);
    return successResponse({ success: true, timeline });
  } catch (error) {
    return handleApiError(error, 'Failed to load STEM application timeline');
  }
}
