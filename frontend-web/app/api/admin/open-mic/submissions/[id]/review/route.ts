import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { OPEN_MIC_REVIEW_STATUSES } from '@/src/features/openmic/constants';
import { assertOpenMicScoreAdmin } from '@/src/server/openmic/auth';
import { reviewSubmission } from '@/src/server/openmic/persistence';
import type { OpenMicSubmissionReviewInput } from '@/src/features/openmic/types';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const identity = await assertOpenMicScoreAdmin(request);
    const body = (await request.json().catch(() => null)) as OpenMicSubmissionReviewInput;
    if (!body) return errorResponse('Invalid JSON body', 400);
    if (!body.status) return errorResponse('status is required', 400);
    // The union above is a compile-time promise only. Whatever reaches this
    // route is a string, and `competition_entries.status` is what the song
    // reader, the leaderboard and the eligibility gate all read — an unlisted
    // decision has to be refused here, not filed and discovered later.
    if (!(OPEN_MIC_REVIEW_STATUSES as readonly string[]).includes(String(body.status))) {
      return errorResponse(`Unknown review decision: ${String(body.status)}`, 400);
    }
    const submission = await reviewSubmission(params.id, body, identity.actorId);
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'open_mic_submission_review',
      module: 'open_mic',
      entityType: 'submission',
      entityId: params.id,
      reason: body.note || 'Submission review action',
      newValue: { status: body.status },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });
    return successResponse({ success: true, submission });
  } catch (error) {
    // A typo'd or already-deleted entry id is not a server fault. persistence
    // says so with 'Submission not found.'; a 500 there would read as "the
    // console broke" to an operator who simply clicked a stale row.
    if (error instanceof Error && error.message.toLowerCase().includes('submission not found')) {
      return errorResponse('Submission not found', 404);
    }
    return handleApiError(error, 'Failed to review open mic submission');
  }
}
