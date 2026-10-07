import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { getSubmissionById } from '@/src/server/openmic/persistence';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const user = await requireRequestUser(request);
    const { id } = await context.params;
    const submission = await getSubmissionById(id);
    if (!submission) return errorResponse('Submission not found', 404);
    if (!submission.artistUserId || submission.artistUserId !== user.id) {
      return errorResponse('Submission not found', 404);
    }
    return successResponse({ success: true, submission });
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to submit song');
  }
}
