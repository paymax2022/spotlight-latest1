import { handleApiError, successResponse } from '@/src/lib/api/responses';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getAdminSettings, updateAdminSettings } from '@/src/server/admin/settings';

export async function GET(request: Request) {
  try {
    assertAdminPermission(request, 'dashboard:view');
    return successResponse({ success: true, settings: getAdminSettings() });
  } catch (error) {
    return handleApiError(error, 'Failed to load admin settings');
  }
}

export async function PATCH(request: Request) {
  try {
    const identity = assertAdminPermission(request, 'roles:manage');
    const body = await request.json();
    const oldSettings = getAdminSettings();
    const settings = updateAdminSettings(body || {});

    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'settings_update',
      module: 'settings',
      entityType: 'system_setting',
      oldValue: oldSettings,
      newValue: settings,
      reason: 'Updated admin settings',
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return successResponse({ success: true, settings });
  } catch (error) {
    return handleApiError(error, 'Failed to update settings');
  }
}

