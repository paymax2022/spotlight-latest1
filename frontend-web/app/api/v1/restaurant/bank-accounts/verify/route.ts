import { featureFlags } from '@/src/lib/feature-flags';
import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { errorResponse, handleApiError } from '@/src/lib/api/responses';

// Proxy: POST /api/v1/restaurant/bank-accounts/verify
//      → Go POST /api/finance/restaurant/bank-accounts/verify.
//
// The previous implementation was dead both ways: it read the `access_token`
// COOKIE (the Bearer header every sibling route and both clients send was
// ignored → 401) and forwarded to `${NEXT_PUBLIC_API_URL}/api/v1/restaurant/…`
// — an upstream prefix Go does not mount (its group lives under /api/finance),
// so even a request that carried a cookie-token 404'd upstream. Body passes
// through verbatim; Go binds/validates AddBankAccountRequest
// (bank_code, account_number, account_name, bank_name) itself.
export async function POST(request: Request) {
  if (!featureFlags.restaurant()) return errorResponse('Restaurant delivery is not available.', 503);
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/finance/restaurant/bank-accounts/verify', { method: 'POST' });
  } catch (err) { return handleApiError(err); }
}
