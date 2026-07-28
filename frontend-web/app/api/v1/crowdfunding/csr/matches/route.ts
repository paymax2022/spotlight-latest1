import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// GET /api/v1/crowdfunding/csr/matches — the sponsor's match offers.
export async function GET(request: Request) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/crowdfunding/csr/matches');
  } catch (err) { return handleApiError(err); }
}

// POST /api/v1/crowdfunding/csr/matches — set up a match (reserves budget;
// the Idempotency-Key header is forwarded by the proxy).
export async function POST(request: Request) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/crowdfunding/csr/matches');
  } catch (err) { return handleApiError(err); }
}
