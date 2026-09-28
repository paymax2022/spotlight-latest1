import { proxyToGoBackend } from '@/src/lib/go-backend';
import { handleApiError } from '@/src/lib/api/responses';

// Public, unauthenticated read of the same contest list the mobile app shows
// signed-in users (GET /api/v1/connect/contests -> connect_contests). Unlike
// app/api/v1/connect/[...path]/route.ts, this deliberately skips
// requireRequestUser: it exists so logged-out visitors on public web pages
// (e.g. /talent-vault) can render real contest data instead of none. The Go
// route it forwards to (backend/internal/connect/voting/handlers.go
// RegisterPublic) is the same handler as the member-only route and returns no
// PII or vote-eligibility data — only contest title/status/banner/counts.
export async function GET(request: Request) {
  try {
    return await proxyToGoBackend(request, '/api/v1/public/contests');
  } catch (err) {
    return handleApiError(err);
  }
}
