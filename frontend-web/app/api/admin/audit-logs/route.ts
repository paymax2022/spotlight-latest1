import { handleApiError, listResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent, listAuditEvents } from '@/src/server/admin/audit';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    const identity = assertAdminPermission(request, 'audit:view');
    const { searchParams } = new URL(request.url);
    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 50,
      maxPageSize: 200,
      defaultSortBy: 'timestamp',
      defaultSortOrder: 'desc',
    });
    const events = listAuditEvents(500);
    const sorted = sortItems(events, query);
    const { items, meta } = paginateItems(sorted, query);

    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'audit_log_view',
      module: 'audit_logs',
      entityType: 'audit_log',
      reason: 'Viewed audit log list',
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return listResponse('events', items, meta);
  } catch (error) {
    return handleApiError(error, 'Failed to load audit logs');
  }
}
