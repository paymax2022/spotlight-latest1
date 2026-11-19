import { errorResponse, handleApiError, successResponse } from '@/src/lib/api/responses';
import { assertOpenMicAdmin } from '@/src/server/openmic/auth';
import { addAuditEvent } from '@/src/server/admin/audit';
import {
  applyOpenMicApplicantStatus,
  defaultOpenMicApplicantActionSources,
  editOpenMicApplicantContact,
  isAllowedOpenMicAction,
  type OpenMicApplicantContactPatch,
} from '@/src/server/registration-v2/open-mic-applicant-actions';

/**
 * Open Mic applicant management — the write half of the Applications tab.
 *
 * ADMIN CONSOLIDATION follow-up to the read adapter in
 * src/server/registration-v2/open-mic-applicants.ts: that merge answered
 * "who applied", which left the console able to show an applicant and unable to
 * do anything about them. The decisions existed only on /admin/registration.
 *
 * Both verbs scope the request to the contest in the URL before writing, and
 * the status change goes through the same store function /admin/registration
 * uses, so there is one writer of registrations.status and one promotion path
 * into the contestants roster. No legacy module is edited; see the service
 * header for the plane rules.
 */

/** POST — one applicant decision: approve/shortlist/waitlist/reject/disqualify/request_information/withdraw. */
export async function POST(request: Request, context: { params: Promise<{ id: string; applicationId: string }> }) {
  const { id: contestId, applicationId } = await context.params;
  try {
    const identity = await assertOpenMicAdmin(request);
    const body = (await request.json().catch(() => null)) as { action?: unknown; note?: unknown } | null;
    if (!body) return errorResponse('Invalid JSON body', 400);
    if (!isAllowedOpenMicAction(body.action)) {
      return errorResponse('An unsupported applicant action was requested.', 400);
    }

    const note = typeof body.note === 'string' ? body.note : undefined;
    const result = await applyOpenMicApplicantStatus(
      { contestId, applicationId, action: body.action, note },
      defaultOpenMicApplicantActionSources,
    );

    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: `open_mic_applicant_${body.action}`,
      module: 'open_mic',
      entityType: 'registration_application',
      entityId: applicationId,
      newValue: result,
      reason: note || `Open Mic applicant ${body.action}`,
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return successResponse({ success: true, ...result });
  } catch (error) {
    return handleApiError(error, 'Failed to update the Open Mic applicant');
  }
}

/** PATCH — correct a typo in the contact details the reviewer needs to reach the applicant. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string; applicationId: string }> }) {
  const { id: contestId, applicationId } = await context.params;
  try {
    const identity = await assertOpenMicAdmin(request);
    const body = (await request.json().catch(() => null)) as OpenMicApplicantContactPatch | null;
    if (!body) return errorResponse('Invalid JSON body', 400);

    await editOpenMicApplicantContact(
      { contestId, applicationId, patch: body },
      defaultOpenMicApplicantActionSources,
    );

    addAuditEvent({
      adminUser: identity.actorId || 'admin',
      role: identity.role,
      action: 'open_mic_applicant_contact_edit',
      module: 'open_mic',
      entityType: 'registration_application',
      entityId: applicationId,
      // The reason names the fields, not their contents: an audit log is not a
      // copy of an applicant's contact record.
      reason: `Edited ${Object.keys(body).join(', ')}`,
      ipAddress: request.headers.get('x-forwarded-for') || undefined,
    });

    return successResponse({ success: true });
  } catch (error) {
    return handleApiError(error, 'Failed to update the applicant contact details');
  }
}
