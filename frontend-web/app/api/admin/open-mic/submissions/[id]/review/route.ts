import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicScoreAdmin } from '@/src/server/openmic/auth';
import { reviewSubmission } from '@/src/server/openmic/persistence';
import type { OpenMicSubmissionReviewInput } from '@/src/features/openmic/types';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  try {
    const identity = await assertOpenMicScoreAdmin(request);
    const body = (await request.json()) as OpenMicSubmissionReviewInput;
    if (!body.status) return errorResponse('status is required', 400);
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
    return handleApiError(error, 'Failed to review open mic submission');
  }
}
