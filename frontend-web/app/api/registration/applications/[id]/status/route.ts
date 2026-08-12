import { successResponse, handleApiError, errorResponse } from '@/src/lib/api/responses';
import { getRegistrationDraft, getRegistrationStatusTimeline } from '@/src/server/registration/supabase-store';
import { requireUser } from '@/src/lib/auth/server';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireUser(request);
    const draft = getRegistrationDraft(params.id);
    if (!draft) return errorResponse('Application not found', 404);
    if (draft.userId !== user.id) return errorResponse('Forbidden', 403);
    const timeline = getRegistrationStatusTimeline(params.id);
    return successResponse({ success: true, draft, timeline });
  } catch (error) {
    return handleApiError(error, 'Failed to load application status timeline');
  }
}
