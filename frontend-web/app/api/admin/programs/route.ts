import { handleApiError, listResponse, successResponse } from '@/src/lib/api/responses';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { paginateItems, parseAdminListQuery, sortItems } from '@/src/server/admin/query';
import { createProgram, listPrograms } from '@/src/server/admin/programs';

export async function GET(request: Request) {
  try {
    assertAdminPermission(request, 'programs:manage');
    const { searchParams } = new URL(request.url);
    const query = parseAdminListQuery(searchParams, {
      defaultPageSize: 20,
      defaultSortBy: 'updatedAt',
      defaultSortOrder: 'desc',
    });
    const programs = listPrograms();
    const sorted = sortItems(programs, query);
    const { items, meta } = paginateItems(sorted, query);
    return listResponse('programs', items, meta);
  } catch (error) {
    return handleApiError(error, 'Failed to list programs');
  }
}

export async function POST(request: Request) {
  try {
    const identity = assertAdminPermission(request, 'programs:manage');
    const body = await request.json();
    const program = createProgram(body, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'program_create',
      module: 'programs',
      entityType: 'program',
      entityId: program.id,
      reason: 'Created program',
      newValue: { title: program.title, status: program.status },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, program }, 201);
  } catch (error) {
    return handleApiError(error, 'Failed to create program');
  }
}

