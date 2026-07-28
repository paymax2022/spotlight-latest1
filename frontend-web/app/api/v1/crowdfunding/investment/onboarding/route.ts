import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// POST /api/v1/crowdfunding/investment/onboarding — advance one onboarding gate
// (kyc | education | quiz | riskProfile).
export async function POST(request: Request) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/crowdfunding/investment/onboarding');
  } catch (err) { return handleApiError(err); }
}
