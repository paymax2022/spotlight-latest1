import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { submitApplication } from '@/src/server/stem/persistence';

export async function POST(
  _request: Request,
  context: { params: { id: string } }
) {
  try {
    const result = await submitApplication(context.params.id);
    if (!result.success) return successResponse(result, 400);
    return successResponse(result, 200);
  } catch (error) {
    return handleApiError(error, 'Failed to submit STEM application');
  }
}
