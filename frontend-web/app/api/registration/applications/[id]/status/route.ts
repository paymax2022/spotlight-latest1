import { successResponse, handleApiError } from '@/src/lib/api/responses';
import { getRegistrationDraft, getRegistrationStatusTimeline } from '@/src/server/registration/store';

export async function GET(_request: Request, { params }: { params: { id: string } }) {
  try {
    const draft = getRegistrationDraft(params.id);
    const timeline = getRegistrationStatusTimeline(params.id);
    return successResponse({ success: true, draft, timeline });
  } catch (error) {
    return handleApiError(error, 'Failed to load application status timeline');
  }
}
