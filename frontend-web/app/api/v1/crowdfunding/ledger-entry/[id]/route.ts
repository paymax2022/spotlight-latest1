import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// GET /api/v1/crowdfunding/ledger-entry/[id]
// → Go: GET /api/finance/crowdfunding/ledger/:id
// [id] is the LEDGER ENTRY id. Returns a single projected LedgerEntry object.
export async function GET(request: Request, { params }: { params: { id: string } }) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, `/api/finance/crowdfunding/ledger/${params.id}`);
  } catch (err) { return handleApiError(err); }
}
