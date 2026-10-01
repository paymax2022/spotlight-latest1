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
