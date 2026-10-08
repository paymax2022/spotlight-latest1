# ADR-PR395 — JWT-local validation for authenticated requests (proposed)

- **Status:** Proposed — needs owner sign-off on revocation semantics
- **Context finding:** AUD-PERF-001 (failure-injection campaign, 2026-10-01)
- **Deciders:** backend platform + security reviewer

## Context

Every authenticated backend request currently calls GoTrue
(`GET /auth/v1/user`) to validate the bearer token. The 200-VU load ramp
showed ~7.2k upstream 500s — GoTrue/Kong saturates well before the API or
Postgres does, and every authed call pays that round-trip serially. GoTrue is
therefore the platform's capacity ceiling: scaling the API does nothing while
each request blocks on it.

The failure-injection campaign also confirmed the blast radius of this
coupling: transient GoTrue blips previously surfaced as mass 401s (fixed in
#367 — upstream failures now map to 503), but the per-request dependency
itself is untouched.

## Decision (proposed)

Validate Supabase HS256 JWTs **locally** in the Go middleware
(`RequireAuthContext` / `resolveVerifiedIdentity`): verify signature + `exp`
against the project's JWT secret, skip the GoTrue round-trip on the hot path.

## Consequences

**Positive**
- Removes the per-request upstream call: p95 auth overhead drops to ~µs; the
  200-VU ceiling moves to Postgres/the API itself.
- GoTrue outages stop degrading already-authenticated traffic entirely.

**Negative / open questions**
- **Revocation**: local validation cannot see logout, password change, or
  admin ban until `exp` lapses. Deciding the acceptable staleness window is
  the actual decision this ADR asks for. Options: (a) short token TTL +
  refresh, (b) async revocation check with a local denylist cache, (c) keep
  remote check only for money-path routes (tier/kyc writes), (d) hybrid —
  local verify + cached `platform_users.status` lookup.
- Key rotation: JWT secret rotation must be coordinated; read the key from
  env (`SUPABASE_JWT_SECRET`) rather than embedding it.
- `aud`/`role` claim handling must mirror Supabase's semantics exactly or
  anon/service-role tokens could be mis-scoped.

## Alternatives considered

- **Keep remote validation + cache the GoTrue response** (short TTL per
  token): cheaper change, keeps revocation ~TTL-accurate, but still leaves a
  hard dependency on GoTrue availability and adds a cache-invalidation path.
- **Move auth to a self-hosted boundary** (e.g. Kong plugin / auth service):
  larger migration; revisit if GoTrue limits persist after local validation.

## Recommendation

Option (d) hybrid: local JWT verify for all authed routes, plus the existing
`platform_users.status`/`failed_login_attempts` checks (already DB-local),
and keep remote GoTrue validation only where revocation must be immediate
(admin grant/revoke surfaces). Ship behind `FEATURE_JWT_LOCAL_VALIDATION`
so it can be toggled per environment.

## Evidence update — 2026-10-02

Re-measured after #417 (wallet read-path indexes + pool knobs): 200-VU local
run against `GET /api/finance/wallet/balance` still fails ~50% — but the body
is `{"error":"authentication service unavailable"}`, i.e. GoTrue saturation,
not the ledger. Isolated warm wallet read: ~216ms. The wallet p95 residual
recorded in the audit is therefore **the per-request GoTrue call**, which this
ADR removes. Recommendation: option (d) — local HS256 verify + short-cached
`platform_users.status` — keeps ban/lockout semantics within a ~60s window
while taking GoTrue off the hot path.

## Implementation — 2026-10-02

Implemented flag-gated on this branch:

- `AUTH_JWT_LOCAL_VERIFY=true` — local verify in `AuthUser` (`integrations/jwt_local.go`):
  ES256 via JWKS (`<supabase>/auth/v1/.well-known/jwks.json`, cached, refetch on
  unknown kid for rotation) and HS256 via `SUPABASE_JWT_SECRET` fallback. All
  local failures map to `ErrTokenInvalid` → 401; no transport ambiguity.
- `AUTH_IDENTITY_CACHE_TTL_SECONDS` — optional per-user TTL cache on the
  RBAC identity reads (`services.NewCachedRBACService`), the second upstream
  leg (PostgREST status/roles/perms) that saturates next. 0 = live lookups.
  Mutations through the service invalidate immediately; errors never cached.

Measured on the local stack (`GET /api/finance/wallet/balance`, 200 VU / 20s):

| Config | req/s | p95 | fail |
|---|---|---|---|
| Remote GoTrue (main) | 54 | 5.04s | 16.6% |
| Local JWT only | 575 | 1.19s | 57.7% (RBAC layer now the bottleneck) |
| Local JWT + 60s identity cache | 12,933 | 19.7ms | 0.00% |

Still gated on the revocation-window decision: enabling both flags gives every
GoTrue revocation up to token-TTL staleness and RBAC changes up to the cache
TTL. Defaults keep today's behavior exactly.
