import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { listEvents, updateEvent } from '@/src/server/admin/events';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    await assertAdminPermission(request, 'programs:manage');
    const event = listEvents().find((e) => e.id === params.id);
    if (!event) return errorResponse('Event not found', 404);
    return successResponse({ success: true, event });
  } catch (error) {
    return handleApiError(error, 'Failed to load event');
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    const body = await request.json();
    const current = listEvents().find((e) => e.id === params.id);
    if (!current) return errorResponse('Event not found', 404);
    const event = updateEvent(params.id, body, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'event_update',
      module: 'events',
      entityType: 'event',
      entityId: params.id,
      oldValue: { status: current.status, startsAt: current.startsAt },
      newValue: { status: event?.status, startsAt: event?.startsAt },
      reason: 'Updated event',
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, event });
  } catch (error) {
    return handleApiError(error, 'Failed to update event');
  }
}

