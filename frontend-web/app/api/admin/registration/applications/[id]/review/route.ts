import { errorResponse, successResponse, handleApiError } from '@/src/lib/api/responses';
import { reviewRegistrationApplication } from '@/src/server/registration/store';
import type { RegistrationReviewInput } from '@/src/features/registration/types';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function POST(request: Request, { params }: { params: { id: string } }) {
  try {
    const identity = assertAdminPermission(request, 'applications:review');
    const body = (await request.json()) as RegistrationReviewInput;
    if (!body?.status) {
      return errorResponse('status is required', 400);
    }

    const draft = reviewRegistrationApplication(params.id, body);

    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'registration_application_review',
      module: 'applications',
      entityType: 'registration_application',
      entityId: params.id,
      newValue: { status: body.status },
      reason: body.note || 'Admin review action',
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return successResponse({ success: true, draft });
  } catch (error) {
    return handleApiError(error, 'Failed to review registration application');
  }
}
