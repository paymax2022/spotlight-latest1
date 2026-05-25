import { handleApiError, listResponse } from '@/src/lib/api/responses';
import { assertStemReadAdmin } from '@/src/server/stem/auth';
import { listApplications } from '@/src/server/stem/persistence';
import type { StemApplicationFilter } from '@/src/features/stem/types';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    assertStemReadAdmin(request);
    const { searchParams } = new URL(request.url);
    const filter: StemApplicationFilter = {
      contestId: searchParams.get('contestId') || undefined,
      contestSlug: searchParams.get('contestSlug') || undefined,
      status: (searchParams.get('status') as StemApplicationFilter['status']) || undefined,
      applicantType: (searchParams.get('applicantType') as StemApplicationFilter['applicantType']) || undefined,
      track: (searchParams.get('track') as StemApplicationFilter['track']) || undefined,
      schoolId: searchParams.get('schoolId') || undefined,
      paymentStatus: (searchParams.get('paymentStatus') as StemApplicationFilter['paymentStatus']) || undefined,
      state: searchParams.get('state') || undefined,
      query: searchParams.get('query') || undefined,
    };

    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 25,
      defaultSortBy: 'updatedAt',
      defaultSortOrder: 'desc',
    });
    const applications = await listApplications(filter);
    const sorted = sortItems(applications, query);
    const { items, meta } = paginateItems(sorted, query);
    return listResponse('applications', items, meta, { filters: filter });
  } catch (error) {
    return handleApiError(error, 'Failed to list STEM applications for admin');
  }
}
