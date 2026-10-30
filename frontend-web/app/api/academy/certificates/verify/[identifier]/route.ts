// Public verification for a Spotlight Film Academy credential.
//
// No authentication: a verifier (employer, festival, agent) types the code
// printed on the certificate. The response carries only what the certificate
// itself displays — holder name, programme, completion date and status. It is
// deliberately rate-friendly and enumeration-resistant by construction: codes
// are 40 random bits rendered as a 20-character hex string.

import { errorResponse, successResponse } from '@/src/lib/api/responses';
import { createAdminClient } from '@/lib/supabase/server';
import { featureFlags } from '@/src/lib/feature-flags';
import { verifyCertificate } from '@/src/server/services/academy/topics';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ identifier: string }> },
) {
  try {
    if (!featureFlags.filmAcademyTopics()) {
      return errorResponse('Credential verification is not available yet', 503);
    }
    const { identifier } = await params;
    const result = await verifyCertificate(createAdminClient(), identifier);
    if (!result.found) {
      return errorResponse('No credential matches that verification code.', 404);
    }
    return successResponse({ success: true, verification: result });
  } catch (error) {
    console.error('[film/certificates] public verify failed', error);
    return errorResponse('Verification is temporarily unavailable.', 500);
  }
}
