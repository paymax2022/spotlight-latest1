import { proxyToGoBackend } from '@/src/lib/go-backend';

// GET /api/v1/modules/visibility — the module registry's answer for THIS
// environment, forwarded from Go.
//
// Both clients ask this question at launch: the mobile services grid
// (mobile-app/reactnative/src/features/modules/visibility.ts) and, from now on,
// the web's own gate. They call it against this host, not against Go, so the
// route has to exist here. Before it did, the call 404ed, both clients read
// "registry unreachable" and failed OPEN by design — so every module rendered,
// including ones no admin had ever published.
//
// Deliberately NOT behind a session and NOT behind a FEATURE_* flag: a route
// that reports what is enabled cannot itself require the thing it reports, and
// a first-launch install has no token yet. Go owns the answer and returns keys
// only, scoped to its own tier, so there is nothing here for an anonymous
// caller to learn about modules that exist but stay unpublished.
//
// No Cache-Control: a hidden module must stop rendering on the next read, not
// after a CDN has decided the old answer is stale.
export async function GET(request: Request) {
  return proxyToGoBackend(request, '/api/v1/modules/visibility');
}
