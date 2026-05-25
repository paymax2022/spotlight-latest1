import { handleApiError, listResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { listApplications } from '@/src/server/openmic/persistence';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    assertOpenMicReadAdmin(request);
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId') || undefined;
    const applicationStatus = (searchParams.get('applicationStatus') as any) || undefined;
    const paymentStatus = (searchParams.get('paymentStatus') as any) || undefined;
    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 25,
      defaultSortBy: 'createdAt',
      defaultSortOrder: 'desc',
    });
    const rows = await listApplications({ contestId, applicationStatus, paymentStatus });
    const sorted = sortItems(rows, query);
    const { items, meta } = paginateItems(sorted, query);
    return listResponse('applications', items, meta, {
      filters: { contestId, applicationStatus, paymentStatus },
    });
  } catch (error) {
    return handleApiError(error, 'Failed to list open mic applications');
  }
}
