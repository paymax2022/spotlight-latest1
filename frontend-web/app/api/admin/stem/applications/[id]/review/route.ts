import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertStemScoreAdmin } from '@/src/server/stem/auth';
import { reviewApplication } from '@/src/server/stem/persistence';
import type { StemAdminApplicationReviewInput } from '@/src/features/stem/types';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function POST(
  request: Request,
  context: { params: { id: string } }
) {
  try {
    const identity = await assertStemScoreAdmin(request);
    const body = (await request.json()) as StemAdminApplicationReviewInput;

    if (!body.status) {
      return errorResponse('status is required', 400);
    }

    const application = await reviewApplication(context.params.id, {
      status: body.status,
      note: body.note,
      score: body.score,
      fraudFlags: body.fraudFlags,
      safetyFlags: body.safetyFlags,
    });
    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'stem_application_review',
      module: 'stem',
      entityType: 'application',
      entityId: context.params.id,
      reason: body.note || 'STEM application scoring/review',
      newValue: {
        status: body.status,
        score: body.score,
        fraudFlags: body.fraudFlags || [],
        safetyFlags: body.safetyFlags || [],
      },
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return successResponse({ success: true, application });
  } catch (error) {
    return handleApiError(error, 'Failed to review STEM application');
  }
}
