import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin } from '@/src/server/stem/auth';
import { reviewSchool } from '@/src/server/stem/persistence';

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const { actorId } = assertStemAdmin(request);
    const body = (await request.json()) as {
      status?: 'draft' | 'submitted' | 'under_verification' | 'more_information_required' | 'verified' | 'rejected' | 'suspended' | 'archived';
      note?: string;
    };

    if (!body.status) return errorResponse('status is required', 400);

    const school = await reviewSchool(context.params.id, body.status, body.note, actorId);
    return successResponse({ success: true, school });
  } catch (error) {
    return handleApiError(error, 'Failed to review school');
  }
}
