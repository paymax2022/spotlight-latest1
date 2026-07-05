import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// GET /api/v1/crowdfunding/ledger/[id]
// → Go: GET /api/finance/crowdfunding/campaigns/:id/ledger
// [id] is the CAMPAIGN id. Returns the projected ledger feed ({ data: LedgerEntry[] }).
export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/campaigns/${params.id}/ledger`);
  } catch (err) { return handleApiError(err); }
}
