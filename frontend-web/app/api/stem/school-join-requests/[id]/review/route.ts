import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin } from '@/src/server/stem/auth';
import { reviewSchoolJoinRequest } from '@/src/server/stem/persistence';

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const { actorId } = assertStemAdmin(request);
    const body = (await request.json()) as {
      status?: 'approved' | 'rejected';
      note?: string;
    };

    if (!body.status) return errorResponse('status is required', 400);

    const row = await reviewSchoolJoinRequest(context.params.id, body.status, body.note, actorId);
    return successResponse({ success: true, request: row });
  } catch (error) {
    return handleApiError(error, 'Failed to review school join request');
  }
}
