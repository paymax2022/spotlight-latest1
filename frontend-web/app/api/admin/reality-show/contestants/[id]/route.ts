import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import {
  getContestant, updateContestant,
  promoteToBootcamp, failAudition,
} from '@/src/server/services/reality-show/store';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'dashboard:view');
    const contestant = getContestant(params.id);
    if (!contestant) return errorResponse('Contestant not found', 404);
    return successResponse({ contestant });
  } catch (error) {
    return handleApiError(error, 'Failed to get contestant');
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const contestant = getContestant(params.id);
    if (!contestant) return errorResponse('Contestant not found', 404);

    const body = await request.json() as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : null;

    // Shortcut actions
    if (action === 'promote_to_bootcamp') {
      return successResponse({ contestant: promoteToBootcamp(params.id) });
    }
    if (action === 'fail_audition') {
      return successResponse({ contestant: failAudition(params.id) });
    }
    if (action === 'declare_winner') {
      return successResponse({ contestant: updateContestant(params.id, { phaseStatus: 'winner', finalistPosition: 1, isActive: false }) });
    }
    if (action === 'declare_finalist') {
      return successResponse({ contestant: updateContestant(params.id, { phaseStatus: 'finalist', finalistPosition: Number(body.position ?? 2) }) });
    }

    // Generic patch
    const allowed = ['displayName', 'stageName', 'primaryTalent', 'photoUrl', 'bioNotes', 'phaseStatus', 'auditionResult', 'isActive'];
    const patch: Record<string, unknown> = {};
    for (const key of allowed) {
      if (key in body) patch[key] = body[key];
    }
    return successResponse({ contestant: updateContestant(params.id, patch as Parameters<typeof updateContestant>[1]) });
  } catch (error) {
    return handleApiError(error, 'Failed to update contestant');
  }
}
