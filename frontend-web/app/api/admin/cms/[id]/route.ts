import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { listCmsPages, updateCmsPage } from '@/src/server/admin/cms';

export async function GET(request: Request, { params }: { params: { id: string } }) {
  try {
    assertAdminPermission(request, 'content:manage');
    const page = listCmsPages().find((entry) => entry.id === params.id);
    if (!page) return errorResponse('Page not found', 404);
    return successResponse({ success: true, page });
  } catch (error) {
    return handleApiError(error, 'Failed to load CMS page');
  }
}

export async function PATCH(request: Request, { params }: { params: { id: string } }) {
  try {
    const identity = assertAdminPermission(request, 'content:manage');
    const body = await request.json();
    const current = listCmsPages().find((entry) => entry.id === params.id);
    if (!current) return errorResponse('Page not found', 404);
    const page = updateCmsPage(params.id, body, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'cms_page_update',
      module: 'cms',
      entityType: 'content_page',
      entityId: params.id,
      oldValue: { status: current.status, title: current.title },
      newValue: { status: page?.status, title: page?.title },
      reason: 'Updated CMS page',
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, page });
  } catch (error) {
    return handleApiError(error, 'Failed to update CMS page');
  }
}

