import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getSeason, listWeeks, createWeek } from '@/src/server/services/reality-show/store';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'dashboard:view');
    if (!getSeason(params.id)) return errorResponse('Season not found', 404);
    return successResponse({ weeks: listWeeks(params.id) });
  } catch (error) {
    return handleApiError(error, 'Failed to list weeks');
  }
}

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    if (!getSeason(params.id)) return errorResponse('Season not found', 404);

    const body = await request.json() as Record<string, unknown>;
    const weekNumber = Number(body.weekNumber);
    if (!weekNumber || weekNumber < 1) return errorResponse('weekNumber is required and must be >= 1', 400);

    const week = createWeek({
      seasonId: params.id,
      weekNumber,
      title: typeof body.title === 'string' ? body.title : undefined,
      theme: typeof body.theme === 'string' ? body.theme : undefined,
      votingOpensAt: typeof body.votingOpensAt === 'string' ? body.votingOpensAt : undefined,
      votingClosesAt: typeof body.votingClosesAt === 'string' ? body.votingClosesAt : undefined,
      evictionCount: typeof body.evictionCount === 'number' ? body.evictionCount : undefined,
      createdBy: identity.actorId,
    });
    return successResponse({ week }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create week');
  }
}
