import { handleApiError, listResponse } from '@/src/lib/api/responses';
import { assertOpenMicReadAdmin } from '@/src/server/openmic/auth';
import { listSubmissions } from '@/src/server/openmic/persistence';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    assertOpenMicReadAdmin(request);
    const { searchParams } = new URL(request.url);
    const contestId = searchParams.get('contestId') || undefined;
    const status = (searchParams.get('status') as any) || undefined;
    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 25,
      defaultSortBy: 'submittedAt',
      defaultSortOrder: 'desc',
    });
    const submissions = await listSubmissions({ contestId, status });
    const sorted = sortItems(submissions, query);
    const { items, meta } = paginateItems(sorted, query);
    return listResponse('submissions', items, meta, { filters: { contestId, status } });
  } catch (error) {
    return handleApiError(error, 'Failed to list open mic submissions');
  }
}
