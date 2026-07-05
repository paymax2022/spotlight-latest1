import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// GET /api/v1/crowdfunding/settings/notifications — notification preferences.
export async function GET(request: Request) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/crowdfunding/settings/notifications');
  } catch (err) { return handleApiError(err); }
}

// PUT /api/v1/crowdfunding/settings/notifications — upsert notification preferences.
export async function PUT(request: Request) {
  if (!featureFlags.crowdfunding()) return errorResponse('Crowdfunding is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/crowdfunding/settings/notifications');
  } catch (err) { return handleApiError(err); }
}
