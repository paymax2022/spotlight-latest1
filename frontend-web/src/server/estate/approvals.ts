// ESTD-D027 — BFF proxy for estate maker-checker approvals.
//
// The approval workflow (self-approval refusal, exactly-once execution, ledger
// posting for vendor payouts, audit) lives entirely in the Go estate service
// (backend/internal/estate/dual_control.go). These BFF routes only resolve the
// caller's estate, fail fast on the obvious (flag off, not an admin, missing
// Idempotency-Key, malformed id) and forward to Go, which re-checks everything.
import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { createAdminClient } from '@/lib/supabase/server';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { ApiError, errorResponse, handleApiError } from '@/src/lib/api/responses';
import { getResidentContext } from '@/src/server/estate/resident';

export const APPROVAL_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function proxyEstateApproval(
  request: Request,
  subPath: string,
  opts: { requireIdempotencyKey?: boolean } = {},
): Promise<Response> {
  if (!featureFlags.estateDualControl()) {
    return errorResponse('Estate dual-control approvals are not enabled.', 503);
  }
  try {
    const user = await requireRequestUser(request);
    if (opts.requireIdempotencyKey && !request.headers.get('Idempotency-Key')) {
      throw new ApiError('Idempotency-Key header is required.', 400);
    }
    const ctx = await getResidentContext(createAdminClient(), user.id);
    if (!ctx) throw new ApiError('Not a resident of any estate', 403);
    if (ctx.role !== 'estate_admin') throw new ApiError('Admin access required', 403);
    return proxyToGoBackend(request, `/api/finance/estate/${ctx.estateId}/admin/${subPath}`);
  } catch (error) {
    return handleApiError(error, 'Approval request failed');
  }
}
