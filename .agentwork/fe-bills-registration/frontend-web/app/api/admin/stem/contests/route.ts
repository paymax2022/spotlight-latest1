import { errorResponse, handleApiError, listResponse, successResponse } from '@/src/lib/api/responses';
import { assertStemAdmin, assertStemReadAdmin } from '@/src/server/stem/auth';
import { createContest, listAdminContests } from '@/src/server/stem/persistence';
import type { StemContest } from '@/src/features/stem/types';
import { addAuditEvent } from '@/src/server/admin/audit';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    assertStemReadAdmin(request);
    const { searchParams } = new URL(request.url);
    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 20,
      defaultSortBy: 'updatedAt',
      defaultSortOrder: 'desc',
    });
    const contests = await listAdminContests();
    const sorted = sortItems(contests, query);
    const { items, meta } = paginateItems(sorted, query);
    return listResponse('contests', items, meta);
  } catch (error) {
    return handleApiError(error, 'Failed to list STEM contests for admin');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertStemAdmin(request);
    const body = (await request.json()) as Partial<StemContest>;

    const created = await createContest(body, identity.actorId);
    if (!created.success) {
      return successResponse(created, 400);
    }
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'stem_contest_create',
      module: 'stem',
      entityType: 'contest',
      entityId: created.contest?.id,
      reason: 'Created STEM contest',
      newValue: { title: body.title, slug: body.slug, season: body.season },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return successResponse(created, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create STEM contest');
  }
}
