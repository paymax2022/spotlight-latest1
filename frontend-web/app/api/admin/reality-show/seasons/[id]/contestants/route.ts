import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getSeason, listContestants, addContestant } from '@/src/server/services/reality-show/persistence';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'dashboard:view');
    if (!(await getSeason(params.id))) return errorResponse('Season not found', 404);
    return successResponse({ contestants: await listContestants(params.id) });
  } catch (error) {
    return handleApiError(error, 'Failed to list contestants');
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    if (!(await getSeason(params.id))) return errorResponse('Season not found', 404);

    const body = await request.json() as Record<string, unknown>;
    if (!body.displayName || typeof body.displayName !== 'string') {
      return errorResponse('displayName is required', 400);
    }
    if (!body.applicationId || typeof body.applicationId !== 'string') {
      return errorResponse('applicationId is required', 400);
    }

    const contestant = await addContestant({
      seasonId: params.id,
      applicationId: body.applicationId,
      userId: typeof body.userId === 'string' ? body.userId : '',
      displayName: body.displayName,
      stageName: typeof body.stageName === 'string' ? body.stageName : undefined,
      primaryTalent: typeof body.primaryTalent === 'string' ? body.primaryTalent : undefined,
      photoUrl: typeof body.photoUrl === 'string' ? body.photoUrl : undefined,
      bioNotes: typeof body.bioNotes === 'string' ? body.bioNotes : undefined,
      createdBy: identity.actorId,
    });
    return successResponse({ contestant }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to add contestant');
  }
}
