import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { getAuditLogs } from '@/src/server/voting/audit.service';

export async function GET(
  request: Request,
  context: { params: Promise<{ contestId: string }> },
) {
  try {
    await assertAdminPermission(request, 'votes:manage');
    const { contestId } = await context.params;
    if (!contestId) return errorResponse('contestId is required', 400);

    const { searchParams } = new URL(request.url);
    const entityType = searchParams.get('entityType') ?? undefined;
    const entityId = searchParams.get('entityId') ?? undefined;
    const limit = Math.min(500, Number(searchParams.get('limit') ?? 100));
    const offset = Math.max(0, Number(searchParams.get('offset') ?? 0));

    const entries = await getAuditLogs(contestId, { entityType, entityId, limit, offset });

    return successResponse({ success: true, contestId, entries, limit, offset });
  } catch (error) {
    return handleApiError(error, 'Failed to load audit log');
  }
}
