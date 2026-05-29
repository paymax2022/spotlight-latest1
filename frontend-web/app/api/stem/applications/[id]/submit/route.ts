import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getApplication, submitApplication } from '@/src/server/stem/persistence';
import { requireUser } from '@/src/lib/auth/server';

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const { user } = await requireUser(request);
    const current = await getApplication(context.params.id);
    if (!current) return errorResponse('Application not found', 404);
    if (current.applicantUserId !== user.id) return errorResponse('Forbidden', 403);

    const result = await submitApplication(context.params.id);
    if (!result.success) return successResponse(result, 400);
    return successResponse(result, 200);
  } catch (error) {
    return handleApiError(error, 'Failed to submit STEM application');
  }
}
