import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { ApiError } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { hasPermission, parseAdminRole } from '@/src/server/admin/rbac';
import { listApprovals, summarizeApproval } from '@/src/server/voting/contest-approvals.service';

// UAT Batch 8 (SEC-005/G-MC): the approvals queue — both makers (to track
// their own proposals) and checkers (to act on them) can see it, so this
// accepts EITHER votes:sensitive:initiate OR votes:sensitive:approve, unlike
// the propose/approve/reject routes which each require exactly one.
export async function GET(request: Request) {
  try {
    // assertAdminPermission only checks a single permission, so resolve the
    // identity against 'votes:sensitive:initiate' first and fall back to
    // checking 'votes:sensitive:approve' by hand — either is sufficient here.
    let identity;
    try {
      identity = await assertAdminPermission(request, 'votes:sensitive:initiate');
    } catch (initiateError) {
      // Only retry against the other permission when the failure was a
      // permission mismatch (403) — an auth failure (401/etc.) would fail the
      // same way on the second call, so surface the original error instead.
      if (initiateError instanceof ApiError && initiateError.status === 403) {
        identity = await assertAdminPermission(request, 'votes:sensitive:approve');
      } else {
        throw initiateError;
      }
    }

    const role = parseAdminRole(identity.role);
    if (!hasPermission(role, 'votes:sensitive:initiate') && !hasPermission(role, 'votes:sensitive:approve')) {
      throw new ApiError('Forbidden', 403);
    }

    const url = new URL(request.url);
    const status = url.searchParams.get('status') || undefined;
    const contestId = url.searchParams.get('contestId') || undefined;

    const records = await listApprovals({ status, contestId });

    const approvals = records.map((record) => ({
      id: record.id,
      actionType: record.actionType,
      contestId: record.contestId,
      payload: record.payload,
      status: record.status,
      initiatorId: record.initiatorId,
      initiatorRole: record.initiatorRole,
      checkerId: record.checkerId,
      checkerRole: record.checkerRole,
      checkerNote: record.checkerNote,
      checkedAt: record.checkedAt,
      executedAt: record.executedAt,
      executionResult: record.executionResult,
      createdAt: record.createdAt,
      summary: summarizeApproval(record),
    }));

    return successResponse({ approvals });
  } catch (error) {
    return handleApiError(error, 'Failed to list approvals');
  }
}
