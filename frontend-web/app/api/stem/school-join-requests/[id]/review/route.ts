import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin } from '@/src/server/stem/auth';
import { reviewSchoolJoinRequest } from '@/src/server/stem/persistence';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { actorId } = await assertStemAdmin(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return errorResponse('Invalid request ID', 400);
    const body = (await request.json().catch(() => null)) as {
      status?: 'approved' | 'rejected';
      note?: string;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);

    if (!body.status) return errorResponse('status is required', 400);

    const row = await reviewSchoolJoinRequest(id, body.status, body.note, actorId);
    return successResponse({ success: true, request: row });
  } catch (error) {
    return handleApiError(error, 'Failed to review school join request');
  }
}
