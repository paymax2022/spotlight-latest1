import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicAdmin, assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { getContestById, updateContest } from '@/src/server/openmic/persistence';
import type { OpenMicContest } from '@/src/features/openmic/types';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function GET(request: Request, context: { params: { id: string } }) {
  try {
    await assertOpenMicReadAdmin(request);
    const contest = await getContestById(context.params.id);
    if (!contest) return errorResponse('Contest not found', 404);
    return successResponse({ success: true, contest });
  } catch (error) {
    return handleApiError(error, 'Failed to load open mic contest');
  }
}

export async function PATCH(request: Request, context: { params: { id: string } }) {
  try {
    const identity = await assertOpenMicAdmin(request);
    const body = (await request.json()) as Partial<OpenMicContest>;
    const contest = await updateContest(context.params.id, body, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'open_mic_contest_update',
      module: 'open_mic',
      entityType: 'contest',
      entityId: context.params.id,
      reason: 'Updated open mic contest configuration',
      newValue: body,
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, contest });
  } catch (error) {
    const fallback = 'Failed to update open mic contest';
    if (error instanceof Error && error.message.toLowerCase().includes('contest not found')) {
      return errorResponse('Contest not found', 404);
    }
    if (process.env.NODE_ENV !== 'production' && error instanceof Error) {
      return errorResponse(`${fallback}: ${error.message}`, 500);
    }
    return handleApiError(error, fallback);
  }
}
