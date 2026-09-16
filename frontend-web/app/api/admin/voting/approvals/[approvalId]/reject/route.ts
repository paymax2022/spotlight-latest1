import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { rejectApproval } from '@/src/server/voting/contest-approvals.service';

// UAT Batch 8 (SEC-005/G-MC): the checker's rejection path for a proposed
// Contest sensitive action. Requires a note (min 5 chars, matching the
// existing reason-length convention used on reverse/adjust). Self-rejection
// is blocked the same way self-approval is.
export async function POST(
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  try {
    const identity = await assertAdminPermission(request, 'votes:sensitive:approve');
    const { approvalId } = await context.params;

    const body = (await request.json()) as { note?: string };
    if (!body?.note || body.note.trim().length < 5) {
      return errorResponse('A note of at least 5 characters is required', 400);
    }

    await rejectApproval(approvalId, identity, body.note.trim());

    return successResponse({
      success: true,
      approvalId,
      status: 'rejected',
    });
  } catch (error) {
    return handleApiError(error, 'Failed to reject action');
  }
}
