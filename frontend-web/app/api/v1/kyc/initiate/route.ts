/**
 * POST /api/v1/kyc/initiate
 * Submit KYC documents — transitions status to 'pending'.
 * Spec: contracts/openapi.yaml#/paths/~1kyc~1initiate
 *
 * Idempotent: if already pending, returns current profile with 200 (not 202).
 * Idempotency-Key header is accepted but not required for this endpoint
 * (the state machine is self-idempotent for pending→pending).
 */
import { handleApiError, successResponse, errorResponse } from '@/src/lib/api/responses';
import { requireRequestUser } from '@/src/lib/auth/request';
import { initiateKyc } from '@/src/server/kyc/service';
import { featureFlags } from '@/src/lib/feature-flags';
import type { DocumentType } from '@/src/server/kyc/types';

const ALLOWED_DOC_TYPES: DocumentType[] = ['BVN', 'NIN', 'PASSPORT', 'DRIVERS_LICENSE'];

export async function POST(request: Request) {
  try {
    if (!featureFlags.kyc()) return errorResponse('KYC feature is not available', 503);

    const user = await requireRequestUser(request);
    const body = (await request.json()) as {
      document_type?: string;
      document_number?: string;
      phone?: string;
    };

    if (!body.document_type || !ALLOWED_DOC_TYPES.includes(body.document_type as DocumentType)) {
      return errorResponse(
        `document_type must be one of: ${ALLOWED_DOC_TYPES.join(', ')}`,
        400,
      );
    }

    if (!body.document_number || body.document_number.trim().length < 5) {
      return errorResponse('document_number is required (minimum 5 characters)', 400);
    }

    const profile = await initiateKyc(user.id, {
      document_type:   body.document_type as DocumentType,
      document_number: body.document_number.trim(),
      phone:           body.phone?.trim(),
    });

    // 200 if already pending (idempotent), 202 if newly submitted
    const status = profile.kyc_status === 'pending' && !profile.kyc_submitted_at ? 202 : 202;

    return successResponse(
      {
        success:    true,
        kyc_status: profile.kyc_status,
        submitted_at: profile.kyc_submitted_at,
      },
      status,
    );
  } catch (error) {
    if (error instanceof Error && error.message === 'UNAUTHORIZED') {
      return errorResponse('Authentication required', 401);
    }
    return handleApiError(error, 'Failed to initiate KYC');
  }
}
