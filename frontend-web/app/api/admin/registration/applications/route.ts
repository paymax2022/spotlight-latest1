import { handleApiError, listResponse } from '@/src/lib/api/responses';
import { listRegistrationApplications } from '@/src/server/registration/store';
import type { RegistrationListFilter } from '@/src/features/registration/types';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'applications:review');
    const { searchParams } = new URL(request.url);
    const filter: RegistrationListFilter = {
      contestSlug: searchParams.get('contestSlug') || undefined,
      status: (searchParams.get('status') as RegistrationListFilter['status']) || undefined,
      contestCategory: (searchParams.get('contestCategory') as RegistrationListFilter['contestCategory']) || undefined,
      paymentStatus: (searchParams.get('paymentStatus') as RegistrationListFilter['paymentStatus']) || undefined,
      query: searchParams.get('query') || undefined,
    };

    if (searchParams.get('minAge')) filter.minAge = Number(searchParams.get('minAge'));
    if (searchParams.get('maxAge')) filter.maxAge = Number(searchParams.get('maxAge'));

    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 25,
      defaultSortBy: 'updatedAt',
      defaultSortOrder: 'desc',
    });
    const applications = listRegistrationApplications(filter);
    const sorted = sortItems(applications, query);
    const { items, meta } = paginateItems(sorted, query);

    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'registration_applications_list',
      module: 'applications',
      entityType: 'registration_application',
      reason: 'Viewed registration applications list',
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return listResponse('applications', items, meta, { filters: filter });
  } catch (error) {
    return handleApiError(error, 'Failed to list applications for admin');
  }
}
