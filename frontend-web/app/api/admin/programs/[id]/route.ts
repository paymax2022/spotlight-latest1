import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { addAuditEvent } from '@/src/server/admin/audit';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getProgram, updateProgram } from '@/src/server/admin/programs';

export async function GET(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    await assertAdminPermission(request, 'programs:manage');
    const program = getProgram(params.id);
    if (!program) return errorResponse('Program not found', 404);
    return successResponse({ success: true, program });
  } catch (error) {
    return handleApiError(error, 'Failed to load program');
  }
}

export async function PATCH(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const identity = await assertAdminPermission(request, 'programs:manage');
    const body = await request.json();
    const current = getProgram(params.id);
    if (!current) return errorResponse('Program not found', 404);
    const program = updateProgram(params.id, body, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'program_update',
      module: 'programs',
      entityType: 'program',
      entityId: params.id,
      oldValue: { status: current.status, title: current.title },
      newValue: { status: program?.status, title: program?.title },
      reason: 'Updated program',
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, program });
  } catch (error) {
    return handleApiError(error, 'Failed to update program');
  }
}

