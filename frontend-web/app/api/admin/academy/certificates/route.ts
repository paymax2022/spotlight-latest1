// Admin: issue or revoke a TMFA programme credential.
//
// Issuance is not a manual override — the service re-derives eligibility from
// the mastery ledger on every call and refuses a certificate the learner has not
// earned. Revocation is always audited and keeps the credential resolvable in
// the public registry, so a verifier sees "revoked" rather than a dead code.

import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { assertAdminPermission } from '@/src/server/admin/auth';
import { featureFlags } from '@/src/lib/feature-flags';
import { createAdminClient } from '@/lib/supabase/server';
import { issueCertificate, revokeCertificate } from '@/src/server/services/academy/topics';
import { topicErrorResponse } from '@/src/server/services/academy/topics/http';

interface CertificateActionBody {
  action?: string;
  enrollmentId?: string;
  certificateId?: string;
  reason?: string;
}

export async function POST(request: Request) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Credential administration is not available yet', 503);
    }
    const actor = await assertAdminPermission(request, 'scores:manage');
    const body = (await request.json().catch(() => ({}))) as CertificateActionBody;
    const supabase = createAdminClient();

    if (body.action === 'issue') {
      const enrollmentId = String(body.enrollmentId ?? '').trim();
      if (!enrollmentId) return errorResponse('enrollmentId is required.', 400);
      const result = await issueCertificate(supabase, {
        enrollmentId,
        actorId: actor.actorId,
        actorRole: actor.role,
      });
      return successResponse({ success: true, ...result });
    }

    if (body.action === 'revoke') {
      const certificateId = String(body.certificateId ?? '').trim();
      if (!certificateId) return errorResponse('certificateId is required.', 400);
      const certificate = await revokeCertificate(supabase, {
        certificateId,
        actorId: actor.actorId,
        actorRole: actor.role,
        reason: String(body.reason ?? ''),
      });
      return successResponse({ success: true, certificate });
    }

    return errorResponse('action must be "issue" or "revoke".', 400);
  } catch (error) {
    return topicErrorResponse(error, 'Failed to update the credential');
  }
}
