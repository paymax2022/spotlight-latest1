import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin, assertStemReadAdmin } from '@/src/server/stem/auth';
import { getContestById, updateContest } from '@/src/server/stem/persistence';
import type { StemContest } from '@/src/features/stem/types';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function GET(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    assertStemReadAdmin(request);
    const contest = await getContestById(context.params.id);
    if (!contest) return errorResponse('Contest not found', 404);
    return successResponse({ success: true, contest });
  } catch (error) {
    return handleApiError(error, 'Failed to load STEM contest for admin');
  }
}

export async function PATCH(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const identity = await assertStemAdmin(request);
    const body = (await request.json()) as Partial<StemContest>;
    const contest = await updateContest(context.params.id, body, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'stem_contest_update',
      module: 'stem',
      entityType: 'contest',
      entityId: context.params.id,
      reason: 'Updated STEM contest',
      newValue: body,
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, contest });
  } catch (error) {
    return handleApiError(error, 'Failed to update STEM contest');
  }
}
