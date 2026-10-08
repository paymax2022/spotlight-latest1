import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin } from '@/src/server/stem/auth';
import { reviewSchool } from '@/src/server/stem/persistence';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { actorId } = await assertStemAdmin(request);
    const { id } = await context.params;
    if (!UUID_RE.test(id)) return errorResponse('Invalid school ID', 400);
    const body = (await request.json().catch(() => null)) as {
      status?: 'draft' | 'submitted' | 'under_verification' | 'more_information_required' | 'verified' | 'rejected' | 'suspended' | 'archived';
      note?: string;
    };
    if (!body) return errorResponse('Invalid JSON body', 400);

    if (!body.status) return errorResponse('status is required', 400);

    const school = await reviewSchool(id, body.status, body.note, actorId);
    return successResponse({ success: true, school });
  } catch (error) {
    return handleApiError(error, 'Failed to review school');
  }
}
