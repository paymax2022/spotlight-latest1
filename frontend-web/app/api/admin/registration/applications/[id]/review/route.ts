import { errorResponse, successResponse, handleApiError } from '@/src/lib/api/responses';
// ADMIN CONSOLIDATION, slice 5 (see docs/adr/ADR-047): registration/store is
// the in-memory version nothing real ever reads back — the applicant's actual
// application lives in Supabase (registration/supabase-store). This used to
// write an admin's approve/reject decision into the memory map only, so it
// looked successful but never touched the applicant's real record.
import { reviewRegistrationApplication } from '@/src/server/registration/supabase-store';
import type { RegistrationReviewInput } from '@/src/features/registration/types';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { addAuditEvent } from '@/src/server/admin/audit';

export async function POST(request: Request, ctx: { params: Promise<{ id: string }> }) {
  const params = await ctx.params;
  try {
    const identity = await assertAdminPermission(request, 'applications:review');
    const body = (await request.json()) as RegistrationReviewInput;
    if (!body?.status) {
      return errorResponse('status is required', 400);
    }

    const draft = await reviewRegistrationApplication(params.id, body);

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
