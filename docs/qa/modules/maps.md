# Module: Maps (MapService proxy)

**Risk tier:** 2 &nbsp;·&nbsp; **Money-path:** no (provider cost surface, not a ledger path) &nbsp;·&nbsp; **Feature flag:** `FEATURE_MAPS_ENABLED` (v2 chain gated additionally by `FEATURE_MAPS_V2_ENABLED`)
**Code:** `backend/internal/maps/` — `routes.go` (`Mount`/`Register`/`buildRegistry`/`NewServiceFromDeps`), `routes_v2.go`, `handler.go` (validation + endpoints), `ratelimit.go` (`PerUserRateLimit`), `guards.go` (license coherence), `provider_guard.go` (`Guard`: budget + circuit breaker), `orchestrator.go` (v2 resolution chain), `service_impl.go`, `provider_*.go` (google/here/geoapify/maptiler/osrm/mock/http). Wiring: `backend/internal/app/finance_routes.go` (~L124-167 build, ~L2624 `Mount`).
**Slug:** `MAPS` (uppercase, used in Case IDs)

## 1. Overview & scope

Maps is a **server-side proxy** over pluggable geo providers, mounted under
`/api/finance/maps`. Clients never call a provider directly — provider API keys stay
server-side, and every response carries the `provider` + `source` so the client knows which
basemap a result may render on. The whole group sits behind `mapsAuth()`
(`middleware.RequireAuthContext`), so **every** endpoint requires a valid token; identity
(`user_id`) comes only from the resolved token, never the body. Because each call can hit a
**paid** provider, the primary testing focus is the **per-user rate limiter**
(`maps.PerUserRateLimit`, default 120/min) and the **provider cost guard**
(`provider_guard.go`: per-provider daily budget + circuit breaker) that fronts the v2
resolution chain (`orchestrator.go`). No money moves through this module (money-invariants do
**not** apply); the cost surface is protected by rate limiting, budgets, and the license
guard instead.

Cross-cutting invariants are **not** repeated here: auth
(`../cross-cutting/authentication.md` — Bearer→Supabase, suspended/locked/deleted→403,
spoofed body `user_id` ignored), RBAC (`../cross-cutting/rbac-and-permissions.md` — 403
fail-closed / 401), flags + audit (`../cross-cutting/feature-flags-and-audit.md`). This module
has **no KYC/tier gate** — assert that explicitly rather than assuming one.

## 2. Services / endpoints in scope

All routes are grouped under `/api/finance/maps` with `mapsAuth()` → `MetricsMiddleware()` →
`PerUserRateLimit(redis, perMin)` applied in that order (metrics runs *before* the limiter so
429s are recorded).

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| Basemap config | `GET /api/finance/maps/basemap` | token (mapsAuth) | no |
| Autocomplete | `POST /api/finance/maps/autocomplete` | token | no |
| Forward geocode | `POST /api/finance/maps/geocode` | token | no |
| Reverse geocode | `POST /api/finance/maps/reverse` | token | no |
| External place search | `POST /api/finance/maps/places` | token | no |
| Route (directions) | `POST /api/finance/maps/route` | token | no |
| Distance matrix | `POST /api/finance/maps/matrix` | token | no |
| Map-match (snap trace) | `POST /api/finance/maps/match` | token | no |
| Near-me (PostGIS) | `POST /api/finance/maps/nearby` | token | no |
| Geofence check (PostGIS) | `POST /api/finance/maps/in-zone` | token | no |
| Upsert confirmed pin | `POST /api/finance/maps/locations` | token + `Idempotency-Key` (dedup) | no |
| Provider metrics | `GET /api/finance/maps/metrics` | token + **admin** (`requireAdmin`, fail-closed 403) | no |
| Per-provider usage | `GET /api/finance/maps/usage` | token + **admin** (`requireAdmin`, fail-closed 403) | no |

Behavioral notes to assert:
- **Coordinate validation** (`validateLatLng`): lat ∈ [-90,90], lng ∈ [-180,180]; NaN/Inf are
  rejected (they fail the bound comparisons); `(0,0)` "null island" is **allowed** (bounds-only,
  never a zero-reject). Failure → 400 `{"error": reason}` **before** any provider call.
- **Error → status mapping** (`status()`): `ErrEmptyQuery`→400, `ErrNoProvider`→503,
  `ErrLicenseCoherence`→409, otherwise 500.
- **NEEDS_PIN is a degrade, not a failure**: geocode/reverse ending in `ErrNeedsPin` return
  **HTTP 200** with `{"needs_pin": true, ...}` — clients branch on the flag, never on a 5xx.
- **Rate limiter** (`PerUserRateLimit`): fixed-window per `user_id`; default 120/min; Redis
  `INCR`+`EXPIRE` (70s) when available, else in-memory. `n <= limit` allowed; over → **429**
  `{"error":"rate limit exceeded","code":"rate_limited"}`. Always sets `X-RateLimit-Limit` /
  `X-RateLimit-Remaining`. **Fails open** on a Redis error (never block users on infra). Empty
  `user_id` is not metered (auth rejects it upstream).

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Per-user rate limit under/at/over + per-user isolation + window reset | unit | `internal/maps/config_pluscode_test.go` (`TestMemLimiterFixedWindow`) | AUTOMATED (mem path only) |
| Redis-backed limiter across instances | int | — | TODO |
| Provider budget gate (cap exhausted → deny) | unit | `internal/maps/provider_guard_test.go` (`TestAllowDecisionBudget`, `TestEffectiveBudgetUsedRollover`) | AUTOMATED |
| Circuit breaker open/half-open/closed transitions | unit | `internal/maps/provider_guard_test.go` (`TestAllowDecisionCircuit`, `TestNextCircuitState`, `TestFoldHealth`) | AUTOMATED |
| Coverage-ordered fallback + confidence escalation | unit | `internal/maps/orchestrator_test.go` (`TestMS3_CoverageOrderAndConfidenceEscalation`) | AUTOMATED |
| Budget/circuit degrade → NEEDS_PIN | unit | `internal/maps/orchestrator_test.go` (`TestMS6_BudgetCircuitDegradesToNeedsPin`, `TestMS6_LowConfidenceNeedsPin`) | AUTOMATED |
| Gazetteer/cache/prediction deflect provider (zero cost) | unit | `internal/maps/orchestrator_test.go` (`TestMS2_GazetteerDeflectsProvider`, `TestMS2_CacheAndPredictionDeflect`) | AUTOMATED |
| License coherence (Google not cached / not rendered on OSM basemap) | unit | `internal/maps/maps_test.go` (`TestNoCacheGoogleGuard`, `TestLicenseCoherenceGuard`), `internal/maps/cache_v2_test.go` (`TestCacheV2_RefusesGoogle`/`RefusesHere`/`AcceptsOSM`/`AcceptsOwn`), `internal/maps/confidence_test.go` (`TestHereGoogleNeverCacheable`) | AUTOMATED |
| Geocode cache miss→hit / cap degradation | unit | `internal/maps/maps_test.go` (`TestGeocodeCacheMiss_ThenHit`, `TestCapToDegradationFallback`), `internal/maps/integration_test.go` (`TestIntegration_GeocodeCache`, `TestIntegration_UsageCap`) | AUTOMATED |
| Nearby / in-zone PostGIS shape | unit/int | `internal/maps/maps_test.go` (`TestFindNearbyOwn_PostGISShape`), `internal/maps/integration_test.go` (`TestIntegration_NearbyAndZone`) | AUTOMATED |
| Distance-matrix routing | unit | `internal/maps/maps_test.go` (`TestDistanceMatrixRouting`) | AUTOMATED |
| Coordinate bound validation (handler 400s) | con | — | TODO |
| HTTP status mapping (`status()`) + NEEDS_PIN 200 shape | con | — | TODO |
| 429 body/headers + metrics-before-limiter ordering | int | — | TODO |
| Auth required on every endpoint | authz | — (shared `../cross-cutting/authentication.md`) | PARTIAL |
| Admin-only metrics/usage fail-closed | authz | — | TODO |
| Flag off → routes not mounted (404) | sec | — | TODO |

## 4. Manual test cases

Preconditions common to happy-path cases: `FEATURE_MAPS_ENABLED=true`, a wired `mapSvc`,
authenticated `qa-user-a` token, rate limit not yet reached.

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `MAPS-INT-001` | Forward geocode happy path | P1 | flag on | `POST /geocode` | `{"address":"12 Awolowo Rd, Ikoyi","surface":"checkout"}` | 200 `GeoResult` with `provider`+`source`; lat/lng populated |
| `MAPS-INT-002` | Reverse geocode happy path | P1 | flag on | `POST /reverse` | `{"lat":6.4541,"lng":3.4316}` | 200 `GeoResult`; source coherent with surface |
| `MAPS-INT-003` | Route happy path | P1 | flag on | `POST /route` | `{"origin":{"lat":6.5,"lng":3.3},"dest":{"lat":6.6,"lng":3.4},"profile":"driving"}` | 200 route with distance/ETA |
| `MAPS-INT-004` | Places search happy path | P2 | flag on | `POST /places` | `{"query":"pharmacy","near":{"lat":6.45,"lng":3.43}}` | 200 `{"places":[...]}` |
| `MAPS-INT-005` | NEEDS_PIN degrade returns 200 | P1 | v2 on; force all providers below `PinFloor` | `POST /geocode` low-confidence | `{"address":"zzz nowhere"}` | **200** `{"needs_pin":true,"message":...}` — never 4xx/5xx |
| `MAPS-CON-001` | Reverse rejects out-of-range lat | P1 | flag on | `POST /reverse` | `{"lat":95,"lng":3.4}` | 400 `{"error":"lat must be between -90 and 90"}`; no provider call |
| `MAPS-CON-002` | Reverse rejects out-of-range lng | P1 | flag on | `POST /reverse` | `{"lat":6.4,"lng":200}` | 400 `{"error":"lng must be between -180 and 180"}` |
| `MAPS-CON-003` | NaN/Inf coordinate rejected | P1 | flag on | `POST /route` with non-finite origin | `{"origin":{"lat":NaN,"lng":3.3},"dest":{...}}` | 400 (`validateLatLng` bound check fails for NaN); no provider call |
| `MAPS-CON-004` | `(0,0)` null island allowed | P2 | flag on | `POST /reverse` | `{"lat":0,"lng":0}` | Not 400 for bounds — request proceeds to resolution |
| `MAPS-CON-005` | Empty geocode query → 400 | P1 | flag on | `POST /geocode` | `{"address":""}` | 400 (`ErrEmptyQuery` → `status()`); no charge recorded |
| `MAPS-CON-006` | Matrix requires non-empty origins/dests | P2 | flag on | `POST /matrix` | `{"origins":[],"dests":[{...}]}` | 400 `{"error":"origins and dests must be non-empty"}` |
| `MAPS-CON-007` | Nearby rejects negative radius | P2 | flag on | `POST /nearby` | `{"point":{"lat":6.4,"lng":3.4},"radius_m":-5}` | 400 `{"error":"radius_m must be non-negative"}` |
| `MAPS-CON-008` | Locations upsert idempotent on repeat key | P2 | flag on | `POST /locations` twice, same `Idempotency-Key` | valid pin, `entity_id`,`entity_type` | 1st: 200 `{"ok":true,"plus_code":...}`; 2nd: 200 `{"ok":true,"deduplicated":true}` (no second write) |
| `MAPS-INT-006` | Rate limit — under limit allowed | P0 | limit `L=120`; user has made `L-1` calls | `POST /geocode` (call #L) | valid | 200; `X-RateLimit-Remaining: 0` |
| `MAPS-INT-007` | Rate limit — at boundary still allowed | P0 | limit `L`; exactly `L` calls total | `POST /geocode` (call #L) | valid | 200 (`n <= limit`); header limit = `L` |
| `MAPS-INT-008` | Rate limit — over limit → 429 | P0 | limit `L`; already at `L` | `POST /geocode` (call #L+1) | valid | **429** `{"error":"rate limit exceeded","code":"rate_limited"}`; `X-RateLimit-Remaining: 0` |
| `MAPS-INT-009` | Per-user isolation | P0 | `qa-user-a` at limit, `qa-user-b` fresh | A hits 429, then B `POST /geocode` | same endpoint | B gets 200 — A hitting the cap does not block B (key is per `user_id`) |
| `MAPS-INT-010` | Window reset restores quota | P1 | user at limit; advance past the 1-min window | `POST /geocode` after window flip | valid | 200 — counter reset for the new minute bucket |
| `MAPS-INT-011` | Limiter fails open on Redis error | P1 | force Redis `INCR` error | `POST /geocode` while over notional limit | valid | Request allowed (200) — infra failure never blocks users (`redisAllow` returns ok=true) |
| `MAPS-INT-012` | Provider fallback on primary failure | P1 | v2 on; primary geocoder errors, next in coverage order healthy | `POST /geocode` | valid address | 200 from the fallback provider; escalation recorded; response `provider` = fallback |
| `MAPS-INT-013` | Budget-exhausted provider skipped | P1 | v2 on; primary daily budget cap reached | `POST /geocode` | valid | Guard denies the capped provider; resolution uses next allowed provider or degrades to NEEDS_PIN (200) — never 500 |
| `MAPS-INT-014` | Open breaker skips provider until cooldown | P1 | v2 on; primary breaker `open`, cooldown not elapsed | `POST /geocode` | valid | Capped provider not called; next provider serves; after cooldown a single half-open probe is allowed |
| `MAPS-AUTHZ-001` | Unauthenticated rejected | P0 | no token | `POST /geocode` | valid body | 401 (mapsAuth `RequireAuthContext`); no provider call (`../cross-cutting/authentication.md`) |
| `MAPS-AUTHZ-002` | Suspended account blocked | P0 | `qa-suspended`, valid token | `POST /geocode` | valid | 403 account restricted (AUTH-SEC-001); no charge |
| `MAPS-AUTHZ-003` | Metrics admin-only fail-closed | P0 | non-admin `qa-user-a` | `GET /metrics` | — | 403 `{"error":"admin only"}` (`requireAdmin`; also 403 when auth context missing) |
| `MAPS-AUTHZ-004` | Usage admin-only fail-closed | P1 | non-admin | `GET /usage` | — | 403 `{"error":"admin only"}` |
| `MAPS-SEC-001` | Flag off → routes not mounted | P0 | `FEATURE_MAPS_ENABLED=false` | `POST /geocode` | valid | 404 — `mapSvc` nil so `Mount` never runs; never 500 (`FLAG-SEC-001`) |
| `MAPS-SEC-002` | License coherence: Google point not on OSM basemap | P1 | Google-sourced result, OpenStack basemap surface | resolve then render | Google `source` | 409 `ErrLicenseCoherence` (server refuses to emit mismatched stack; `TestLicenseCoherenceGuard`) |
| `MAPS-SEC-003` | Google/HERE result never cached | P1 | v2 on; Google/HERE wins resolution | `POST /geocode` then inspect cache | Google/HERE source | No cache row written (`guardCacheWrite` refuses non-OSM; `TestNoCacheGoogleGuard`, `TestMS7_GoogleResultNotCached`) |

## 5. State-machine transitions

Not a request-level FSM. The only stateful lifecycle is the **provider circuit breaker**
(`provider_guard.go`): `closed → open` (error-rate > 0.50 or p95 > 8000ms with ≥5 samples),
`open → half_open` (after 60s cooldown, on the next `Allow`), `half_open → closed` (probe ok),
`half_open → open` (probe fails). These transitions are pure and already covered by
`TestNextCircuitState` / `TestAllowDecisionCircuit`; behaviorally exercised end-to-end in
`MAPS-INT-014`.

## 6. Security & abuse cases

- **Rate-limit bypass / exhaustion** — MAPS-INT-006..011; per-user key prevents one user
  exhausting another's quota, and the limiter fails open only on infra error (documented
  trade-off: a Redis outage temporarily removes the cost cap — flag in report).
- **Cost-surface abuse via provider budget** — MAPS-INT-013/014; budget + breaker cap paid
  calls per provider per UTC day.
- **License/compliance** — MAPS-SEC-002/003; Google/HERE results must never be cached nor
  rendered on an OSM basemap.
- **Auth & privilege** — MAPS-AUTHZ-001..004; every endpoint requires a token; metrics/usage
  are admin-only and fail closed (403 even when the auth context is absent). Note the
  in-handler `requireAdmin` is defence-in-depth; the route owner *should also* wrap
  `GET /metrics` + `/usage` with `RequirePermission(rbac, "maps:metrics:read")` at the router
  edge (see handler.go note) — flag this gap in the report.
- **Fail-closed on flag off** — MAPS-SEC-001.
- **Input hardening** — MAPS-CON-001..007; all coordinate inputs bound-checked before any
  provider call; NaN/Inf rejected. No SQL string interpolation on the PostGIS paths (pgx
  parameterised).

## 7. Automated specs to add

- `internal/maps/handler_test.go` — httptest table over every endpoint: coordinate 400s
  (out-of-range lat/lng, NaN, negative radius, empty matrix/trace), `(0,0)` allowed, empty
  geocode → 400, NEEDS_PIN → 200 shape, `status()` mapping (503 on `ErrNoProvider`, 409 on
  `ErrLicenseCoherence`). Use a fake `Service` seam; table-driven Go.
- `internal/maps/ratelimit_redis_test.go` — miniredis-backed `redisAllow`: under/at/over
  boundary → 429 body + `X-RateLimit-*` headers, per-user key isolation, minute-bucket reset,
  and fail-open on a forced Redis error. Complements the existing mem-path
  `TestMemLimiterFixedWindow`.
- `internal/maps/mount_flag_test.go` — assert `Register` with `Enabled:false` (and with a nil
  DB) returns nil and mounts no `/api/finance/maps/*` routes (404), per `FLAG-SEC-001`.
- `internal/maps/admin_authz_test.go` — `requireAdmin` returns 403 for a non-admin and for a
  missing auth context; 200 for an admin role slug.

## 8. Coverage target & exit criteria

Tier-2 module: aim ≥ 70% on `handler.go` validation/status logic, `ratelimit.go`, and the pure
`provider_guard.go`/`orchestrator.go` decision helpers (the latter two are already
well-covered). **Exit criteria (must be green before release):** MAPS-INT-006, MAPS-INT-007,
MAPS-INT-008, MAPS-INT-009 (rate-limit under/at/over + isolation), MAPS-AUTHZ-001,
MAPS-AUTHZ-003, and MAPS-SEC-001 (flag off → 404). Any red among these is a do-not-ship blocker.
</content>
</invoke>
