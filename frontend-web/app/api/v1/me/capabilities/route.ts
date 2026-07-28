import { requireRequestUser } from '@/src/lib/auth/request';
import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Proxy: /api/v1/me/capabilities → Go /api/v1/me/capabilities.
// Surfaces the caller's "one identity, many capabilities" snapshot (customer +
// approved merchant profiles + active onboarding applications). Authed — the Go
// backend maps the bearer token to the user id and scopes the read.
export async function GET(request: Request) {
  try {
    await requireRequestUser(request);
    return proxyToGoBackend(request, '/api/v1/me/capabilities');
  } catch (err) {
    return handleApiError(err);
  }
}
