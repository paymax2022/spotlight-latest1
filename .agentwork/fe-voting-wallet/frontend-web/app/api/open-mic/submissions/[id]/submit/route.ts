import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { getSubmissionById } from '@/src/server/openmic/persistence';

export async function POST(_request: Request, context: { params: { id: string } }) {
  try {
    const submission = await getSubmissionById(context.params.id);
    if (!submission) return errorResponse('Submission not found', 404);
    return successResponse({ success: true, submission });
  } catch (error) {
    return handleApiError(error, 'Failed to submit song');
  }
}
