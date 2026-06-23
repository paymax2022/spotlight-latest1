import { successResponse, handleApiError, errorResponse } from '@/src/lib/api/responses';
import { getRegistrationDraft, withdrawRegistrationApplication } from '@/src/server/registration/store';
import { requireUser } from '@/src/lib/auth/server';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const { user } = await requireUser(request);
    const current = getRegistrationDraft(params.id);
    if (!current) return errorResponse('Application not found', 404);
    if (current.userId !== user.id) return errorResponse('Forbidden', 403);

    const body = (await request.json().catch(() => ({}))) as { note?: string };
    const draft = withdrawRegistrationApplication(params.id, body.note);
    return successResponse({ success: true, draft });
  } catch (error) {
    return handleApiError(error, 'Failed to withdraw application');
  }
}
