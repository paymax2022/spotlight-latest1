import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { approveApproval } from '@/src/server/voting/contest-approvals.service';

// UAT Batch 8 (SEC-005/G-MC): the checker side of dual control for the three
// Contest sensitive actions (vote_reversal, vote_adjustment, results_publish).
//
// approveApproval() verifies the checker's identity + the self-approval
// guard, then EXECUTES the underlying action in this same request. If
// execution throws, the approval row is left 'pending_approval' (never
// marked executed) so it can be retried — see contest-approvals.service.ts.
export async function POST(
  request: Request,
  context: { params: Promise<{ approvalId: string }> },
) {
  try {
    const identity = await assertAdminPermission(request, 'votes:sensitive:approve');
    const { approvalId } = await context.params;

    let checkerNote: string | undefined;
    try {
      const body = (await request.json()) as { note?: string };
      checkerNote = body?.note;
    } catch {
      // No body / empty body is fine — checkerNote is optional on approve.
    }

    const executionResult = await approveApproval(approvalId, identity, checkerNote);

    return successResponse({
      success: true,
      approvalId,
      status: 'executed',
      executionResult,
    });
  } catch (error) {
    return handleApiError(error, 'Failed to approve action');
  }
}
