import { handleApiError, listResponse, successResponse } from '@/src/lib/api/responses';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { createCmsPage, listCmsPages } from '@/src/server/admin/cms';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';

export async function GET(request: Request) {
  try {
    assertAdminPermission(request, 'content:manage');
    const { searchParams } = new URL(request.url);
    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 20,
      defaultSortBy: 'updatedAt',
      defaultSortOrder: 'desc',
    });
    const pages = listCmsPages();
    const sorted = sortItems(pages, query);
    const { items, meta } = paginateItems(sorted, query);
    return listResponse('pages', items, meta);
  } catch (error) {
    return handleApiError(error, 'Failed to list CMS pages');
  }
}

export async function POST(request: Request) {
  try {
    const identity = assertAdminPermission(request, 'content:manage');
    const body = await request.json();
    const page = createCmsPage(body, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'cms_page_create',
      module: 'cms',
      entityType: 'content_page',
      entityId: page.id,
      reason: 'Created CMS page',
      newValue: { title: page.title, status: page.status },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, page }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create CMS page');
  }
}

