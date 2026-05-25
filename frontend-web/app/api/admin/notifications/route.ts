import { handleApiError, listResponse, successResponse } from '@/src/lib/api/responses';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { listNotifications, queueNotification } from '@/src/server/admin/notifications';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    assertAdminPermission(request, 'content:manage');
    const { searchParams } = new URL(request.url);
    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 25,
      defaultSortBy: 'sentAt',
      defaultSortOrder: 'desc',
    });
    const notifications = listNotifications();
    const sorted = sortItems(notifications, query);
    const { items, meta } = paginateItems(sorted, query);
    return listResponse('notifications', items, meta);
  } catch (error) {
    return handleApiError(error, 'Failed to list notifications');
  }
}

export async function POST(request: Request) {
  try {
    const identity = assertAdminPermission(request, 'content:manage');
    const body = await request.json();
    if (!body?.title || !body?.message || !body?.channel || !body?.audience) {
      return successResponse({ success: false, error: 'title, message, channel and audience are required.' }, 400);
    }

    const item = queueNotification({
      title: String(body.title),
      message: String(body.message),
      channel: body.channel,
      audience: body.audience,
      createdBy: identity.actorId,
    });

    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'notification_send',
      module: 'notifications',
      entityType: 'notification',
      entityId: item.id,
      reason: `Sent ${item.channel} notification`,
      newValue: { audience: item.audience, title: item.title },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return successResponse({ success: true, notification: item }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to send notification');
  }
}

