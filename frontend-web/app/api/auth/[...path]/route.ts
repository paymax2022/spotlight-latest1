import { proxyToGoBackend } from '@/src/lib/go-backend';

/**
 * Catch-all proxy: /api/auth/<...> → Go /api/auth/<...>.
 *
 * WHY THIS EXISTS
 * The Go backend mounts its Bearer-token auth rail at /api/auth/* — including
 * contract-documented paths the BFF's named handlers do not cover:
 *   POST   /api/auth/otp/request            (contracts/openapi.yaml)
 *   POST   /api/auth/otp/verify             (contracts/openapi.yaml)
 *   GET    /api/auth/sessions               (contracts/openapi.yaml)
 *   DELETE /api/auth/sessions/{id}          (contracts/openapi.yaml)
 *   POST   /api/auth/sessions/revoke-all    (contracts/openapi.yaml)
 *   POST   /api/auth/change-password        (router.go apiAuthProtected)
 *   POST   /api/auth/complete-profile       (router.go apiAuthProtected)
 *   POST   /api/auth/request-password-reset (router.go apiAuth)
 * Until now the BFF proxied only /api/v1/* and /api/finance/*, so every one of
 * those returned Next's 404 through prod ingress — mobile's production base URL
 * (EXPO_PUBLIC_API_BASE_URL=https://www.spotlightng.com in eas.json) is THIS
 * origin, so a Bearer client following the Go contract had no path in.
 *
 * Specific routes still win: Next matches a concrete segment before a
 * catch-all, so every existing handler (login, register, me, logout,
 * verify-otp, resend-otp, otp-verify, forgot-password, reset-password,
 * recovery-session) keeps serving its own path. The facade stays authoritative
 * where it exists — it adds purpose-shaping, the Supabase fallback while
 * FEATURE_OTP_EMAIL_ENABLED is off, and the dual session/tokens response
 * shape. This catch-all only picks up what nothing else claims, the same role
 * app/api/v1/[...path]/route.ts plays for the v1 surface.
 *
 * NOT SHADOWED, BY DESIGN — the same-named Go routes that stay unreachable
 * here because a BFF handler already owns the path:
 *   /api/auth/login, /register  → BFF handlers that themselves delegate to Go
 *   /api/auth/me, /logout       → Bearer-capable BFF handlers (service-role
 *                                 GoTrue validation + global signOut). Go's
 *                                 RequireAuthContext variants differ (roles
 *                                 lookup, session-hardening revocation) —
 *                                 unifying the two is a real decision, not a
 *                                 pass-through (DECISION-NEEDED, see the
 *                                 production sweep report).
 *   /api/auth/reset-password    → BFF facade owns the path; it already calls
 *                                 Go's same-named endpoint upstream.
 * There is NO Go /api/auth/refresh — token refresh runs through Supabase
 * GoTrue directly (mobile setSession/auto-refresh), so nothing is missing.
 */

export const dynamic = 'force-dynamic';

async function forward(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  const { path } = await ctx.params;
  return proxyToGoBackend(request, `/api/auth/${path.join('/')}`);
}

export const GET = forward;
export const POST = forward;
export const PUT = forward;
export const PATCH = forward;
export const DELETE = forward;
