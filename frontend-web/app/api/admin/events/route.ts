import { handleApiError, listResponse, successResponse } from '@/src/lib/api/responses';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createEvent, listEvents } from '@/src/server/admin/events';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const { searchParams } = new URL(request.url);
    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 20,
      defaultSortBy: 'startsAt',
      defaultSortOrder: 'desc',
    });
    const events = listEvents();
    const sorted = sortItems(events, query);
    const { items, meta } = paginateItems(sorted, query);
    return listResponse('events', items, meta);
  } catch (error) {
    return handleApiError(error, 'Failed to list events');
  }
}

export async function POST(request: Request) {
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    const body = await request.json();
    const event = createEvent(body, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'event_create',
      module: 'events',
      entityType: 'event',
      entityId: event.id,
      reason: 'Created event',
      newValue: { title: event.title, startsAt: event.startsAt },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, event }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create event');
  }
}

