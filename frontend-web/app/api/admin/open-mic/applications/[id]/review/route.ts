import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicAdmin } from '@/src/server/openmic/auth';
import { reviewApplication } from '@/src/server/openmic/persistence';

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    await assertOpenMicAdmin(request);
    const body = (await request.json()) as {
      applicationStatus?: 'pending' | 'approved' | 'rejected';
      paymentStatus?: 'not_required' | 'pending' | 'paid' | 'failed' | 'waived';
      beatDownloadStatus?: 'not_available' | 'available' | 'downloaded';
      rejectionReason?: string;
    };
    if (!body.applicationStatus && !body.paymentStatus && !body.beatDownloadStatus) {
      return errorResponse('At least one review field is required', 400);
    }
    const application = await reviewApplication(params.id, body);
    return successResponse({ success: true, application });
  } catch (error) {
    return handleApiError(error, 'Failed to review application');
  }
}
