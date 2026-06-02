import { handleApiError, listResponse, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicAdmin, assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { createContest, listContests } from '@/src/server/openmic/persistence';
import type { OpenMicContest } from '@/src/features/openmic/types';
import { addAuditEvent } from '@/src/server/admin/audit';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    await assertOpenMicReadAdmin(request);
    const { searchParams } = new URL(request.url);
    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 20,
      defaultSortBy: 'updatedAt',
      defaultSortOrder: 'desc',
    });
    const contests = await listContests({ includeNonPublic: true });
    const sorted = sortItems(contests, query);
    const { items, meta } = paginateItems(sorted, query);
    return listResponse('contests', items, meta);
  } catch (error) {
    return handleApiError(error, 'Failed to list admin open mic contests');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertOpenMicAdmin(request);
    const body = (await request.json()) as Partial<OpenMicContest>;
    const result = await createContest(body, identity.actorId);
    if (!result.success) return successResponse(result, 400);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'open_mic_contest_create',
      module: 'open_mic',
      entityType: 'contest',
      entityId: result.contest?.id,
      reason: 'Created open mic contest edition',
      newValue: { title: body.title, month: body.month, year: body.year },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse(result, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create open mic contest');
  }
}
