import { successResponse, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { listSeasons, createSeason } from '@/src/server/services/reality-show/persistence';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'dashboard:view');
    return successResponse({ seasons: await listSeasons() });
  } catch (error) {
    return handleApiError(error, 'Failed to list seasons');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    const body = await request.json() as Record<string, unknown>;
    if (!body.seasonName || typeof body.seasonName !== 'string') {
      return errorResponse('seasonName is required', 400);
    }
    const season = await createSeason({
      seasonName: body.seasonName,
      seasonNumber: Number(body.seasonNumber ?? 1),
      contestSlug: typeof body.contestSlug === 'string' ? body.contestSlug : 'reality-tv-show',
      auditionStartDate: typeof body.auditionStartDate === 'string' ? body.auditionStartDate : undefined,
      auditionEndDate: typeof body.auditionEndDate === 'string' ? body.auditionEndDate : undefined,
      bootcampStartDate: typeof body.bootcampStartDate === 'string' ? body.bootcampStartDate : undefined,
      bootcampEndDate: typeof body.bootcampEndDate === 'string' ? body.bootcampEndDate : undefined,
      notes: typeof body.notes === 'string' ? body.notes : undefined,
      createdBy: identity.actorId,
    });
    return successResponse({ season }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create season');
  }
}
