# PERFORMANCE — live stack load test results

Date: 2026-10-03. Tool: **k6 v2.3.0** (`/opt/homebrew/bin/k6`) — repo already has k6
harnesses (`tools/loadtest/{marketplace,transport_scheduled,integration}`, wired to
`make *-loadtest`); a fresh throwaway script was used for this sweep, nothing repo-side
was changed.

Stack: Go API :8080 (`spotlight-latest1-api-1`, `APP_ENV=development`), Next web :3000,
Kong/GoTrue :54321, Postgres :54322 (`supabase_db_spotlight`), Redis :6379.
Fixture: `qa-claude-test@spotlight.internal` (ES256 access token reused across runs —
see F2 for why login-per-run is unsafe).

**Local single-instance — all numbers indicative, not prod capacity.** This one box
carries k6, the API, Next, Kong, GoTrue, Postgres, Redis and Docker itself.

Method: constant-VU k6 runs, 30s per step, ≥10s cool-down between runs. Authed
requests send `Authorization: Bearer <token>`; all VUs share one identity (production
traffic is multi-identity — single-user RBAC/PostgREST rows are hotter-cache paths
here, so real-world authed capacity is probably LOWER, not higher).

## Results — latency per scenario (ms)

### S1 — Authed read: `GET /api/auth/me` (:8080)

| VU | reqs | req/s | p50 | p95 | p99* | max | err% (status) |
|----|------|-------|-----|-----|------|-----|----------------|
| 10 | 5,450 | 182 | 56 | 111 | — | 369 | **46.1%** (all 5xx) |
| 25 | 11,201 | 372 | 57 | 146 | — | 307 | **87.5%** |
| 50 | 9,153 | 250 | 121 | 395 | — | 10,005 (timeout) | **84.0%** |

\* k6 summary-export emits p50/p90/p95 only for the 30s runs; a 15s re-run of the
10-VU case on a rested GoTrue measured **0% errors, p50 63ms, p95 87ms, p99 110ms,
151 req/s** — saturation onset is stochastic around ~150–280 attempted req/s (see
bottleneck section; first-touch vs saturated state explains the 46%-vs-0% spread).

### S2 — Public read: `GET /api/v1/modules/visibility` (:8080)

Unauthenticated; handler runs 2 pgx queries per request (`VisibleKeys` +
`ComingSoonKeys` → `List`). `stem-*` lists were unusable for load —
`StemRateLimit` 429s after 10–60 req/min per IP (verified: 429s from req 11 on
`/api/v1/stem-contests`).

| VU | reqs | req/s | p50 | p95 | p99 | max | err% |
|----|------|-------|-----|-----|-----|-----|------|
| 10 | 88,329 | 2,944 | 3.0 | 6.3 | — | 36 | 0.00% |
| 25 | 92,995 | 3,099 | 7.7 | 11.9 | 14.0 | 33 | 0.00% |
| 50 | 96,056 | 3,201 | 15.2 | 20.4 | — | 35 | 0.00% |

### S3 — Money read: `GET /api/finance/wallet/balance` (:8080)

Ledger-projected read behind `RequireAuthContext` (same auth fan-out as S1).

| VU | reqs | req/s | p50 | p95 | p99 | max | err% (status) |
|----|------|-------|-----|-----|-----|-----|----------------|
| 10 | 6,418 | 214 | 35 | 94 | — | 253 | **54.2%** (all 5xx) |
| 25 | 11,206 | 373 | 55 | 153 | 608 | 404 | **87.6%** |
| 50 | 9,598 | 319 | 115 | 423 | — | 838 | **84.4%** |

(15s p99 run @25VU also produced one 10.2s client-side timeout.)

### S4 — Write path (bounded)

Two candidates, one accidental finding:

| Endpoint | VU | reqs | req/s | p50 | p95 | max | err% | notes |
|----------|----|------|-------|-----|-----|-----|------|-------|
| `POST /api/auth/logout` | 10 | 700,912 | **23,363** | 0.33 | 0.75 | 16 | 0.00% | **no-op** — see F3 |
| `PUT /api/finance/mobility/profile` (real authed upsert) | 10 | 6,700 | 223 | 32 | 86 | 127 | **56.0%** (all 5xx) | ~98 writes/s succeeded; **no duplication** (exactly 1 `mobility_profiles` row after the run — the upsert is idempotent) |

The 23.4k req/s no-op run is a useful ceiling reference: Gin itself is not the
bottleneck anywhere in this table.

### S5 — BFF hop via :3000

Two distinct paths exist on :3000 — they behave differently:

- **Catch-all proxy** (`app/api/{v1,finance}/[...path]/route.ts` →
  `proxyToGoBackend`): enforces `PROXY_RATE_LIMIT` = **600 req / 60s per client
  IP** (`frontend-web/src/lib/go-backend.ts:39-46`). Everything beyond that 429s
  BEFORE hitting Go.
- **`app/api/auth/me/route.ts`**: NOT a proxy — does its own GoTrue
  `admin.auth.getUser(token)` + PostgREST `user_profiles` read per request.

| Run | VU | reqs | req/s | p50 | p95 | max | err% (status) |
|-----|----|------|-------|-----|-----|-----|----------------|
| `GET :3000/api/finance/wallet/balance` | 10 | 5,900 | 196 | 44 | 99 | 228 | **85.0%** — all **429** |
| same | 25 | 9,058 | 301 | 77 | 128 | 331 | **95.4%** — 429 |
| same | 50 | 9,665 | 321 | 144 | 220 | 1,206 | **95.7%** — 429 |
| `GET :3000/api/v1/modules/visibility` | 25 | 8,970 | 298 | 77 | 126 | 395 | **90.1%** — 429 |
| `GET :3000/api/auth/me` (Next's own) | 25 | 4,690 | 156 | 157 | 257 | 509 | **37.2%** — all **401** |

**Clean proxy-tax A/B** (5 VU × 1s pacing ≈ 4.7 req/s, under the limiter, 0% err):
direct Go avg **73ms** / p95 **93ms** vs via :3000 avg **92ms** / p95 **120ms** →
**BFF tax ≈ +19ms avg / +27ms p95**. Note the proxy passes the rate limit even when
the limiter window is partially spent — under burst the effective ceiling is ~10
sustained req/s per client IP.

### S6 — Observation: container resources mid-load

| Container | CPU (idle) | CPU (authed 25–50VU) | CPU (public 50VU) | Mem |
|-----------|-----------|--------------------|-------------------|-----|
| `spotlight-latest1-api-1` | ~0% | **15–24%** | ~24% | ~55MB |
| `supabase_db_spotlight` | ~1% | **262–442%** | ~300% | ~290MB |
| `supabase_auth_spotlight` (GoTrue) | ~0% | **80–273%** | ~1% | ~40MB |
| `supabase_rest_spotlight` (PostgREST) | ~0% | 15–18% | — | ~110MB |
| `supabase_kong_spotlight` | ~0% | 19–22% | — | ~175MB |

`pg_stat_activity` during peak authed load: **~45–50 total connections, only 1–3
`active`**, rest idle. Postgres is not query-bound — it's **connection-churn-bound**
(handshake/auth/teardown per inbound connection is what burns the 400%+ CPU).

## Bottleneck attribution — confirmed and refined

The failing hop is the **per-request GoTrue `GET /auth/v1/user` round trip**
(`RequireAuthContext`, `backend/internal/middleware/auth_context.go:41`), NOT the
app and NOT Postgres query capacity:

- Hitting GoTrue directly (`:54321/auth/v1/user` + apikey, no Go in path) @25VU:
  **49.4% errors** — `500 unexpected_failure`.
- GoTrue container log under load, repeatedly:
  `failed to connect to host=supabase_db_spotlight ... dial tcp 192.168.97.4:5432:
  connect: cannot assign requested address` → **client-side ephemeral-port
  exhaustion in the auth container**. GoTrue opens a fresh DB connection per
  `/user` call; at ~275 attempted req/s the container can't assign source ports
  (TIME_WAIT accumulation). That is the mechanical cause of the collapse — the DB
  stays at 1–3 active queries the whole time.
- Public endpoints prove the app+pgx path is fine: **3,200 req/s, 0% err, p95
  20ms** vs **~50–98 successful req/s ceiling** on any authed route. That's a
  ~30–60× capacity gap introduced purely by the auth fan-out.
- S1 vs S3 are statistically identical (same middleware), confirming the
  wallet/balance handler itself adds nothing measurable — auth dominates.

### vs. AUD-PERF-001 / ADR-PR395 prior claims

| Prior claim | This run |
|---|---|
| "~50% 503 at 200VU, Postgres fine" | **Confirmed, and worse than stated**: 46–56% 5xx at just **10 VU** sustained, 84–88% at 25–50VU. Postgres indeed fine (1–3 active conns). |
| Remote-GoTrue baseline: 54 req/s, p95 5.04s, 16.6% fail @200VU/20s | Consistent order: sustained good-throughput ceiling measured ≈ **46–98 req/s**; failure onset is stochastic ~150–280 attempted req/s (port exhaustion timing). |
| Fix exists, flag-gated: `AUTH_JWT_LOCAL_VERIFY` + `AUTH_IDENTITY_CACHE_TTL_SECONDS` (local JWT + RBAC cache) | **Both OFF in the running container** (env inspected) — everything above is the baseline remote-fan-out path the flags were built to remove. Prior local measurement: local JWT + cache → ~12,933 req/s, 0% fail on this exact endpoint family. |

## Findings

### F1 — HIGH — Authed-request capacity ceiling ≈ 50–100 good req/s (AUD-PERF-001 live)

Every authed request = 1× GoTrue `/auth/v1/user` + 3× concurrent PostgREST RBAC
reads (status/roles/perms). GoTrue's per-request DB connect exhausts ephemeral
ports in its container first (~275 attempted req/s), then everything behind the
middleware returns 503. 25 VU of sustained authed traffic is enough to collapse the
stack on this box. **Mitigation already exists**: `AUTH_JWT_LOCAL_VERIFY` (ES256
JWKS verify in-process) + `AUTH_IDENTITY_CACHE_TTL_SECONDS` — both built, both off.
Enabling them locally is a one-env-var A/B away from re-measuring; recommend
staging validation + ratifying the ADR-PR395 revocation-staleness trade-off.

### F2 — HIGH (security/availability) — Transient GoTrue errors burn the login lockout budget

`auth_service.go` `LoginUser`: any `resp.StatusCode >= 400` from GoTrue
`/auth/v1/token` except `email_not_confirmed` falls into `bumpFailedLogin` +
generic "invalid credentials" (`backend/internal/services/auth_service.go:367-389`).
During this test, 5 setup logins raced a saturated/recovering GoTrue → each
transient 5xx counted as a credential strike → **account auto-locked for 30 min
mid-suite** (`login_activity` shows 14 `invalid_credentials` rows all from
transient upstream failure, `platform_users` locked at 5). Any GoTrue blip during
real user logins can lock accounts out for doing nothing wrong — a mild
availability-DoS amplifier on top of F1. The code comments already acknowledge the
class of bug (the `email_not_confirmed` carve-out) but only fixed the one case.
Fix: only bump on definitive `invalid_grant`/`invalid_credentials` error codes;
map other ≥400 to the 503 "service unavailable" path, same doctrine as
AUD-AUTH-001 on the read side.

### F3 — MED — `POST /api/auth/logout` is mounted unauthenticated and never audits

`apiAuth.POST("/logout", ...)` sits on the unauthenticated group
(`router.go:148`); the handler's audit call is gated on
`GetAuthenticatedUser`, which is never populated → **0 audit rows for 700,912
logout calls** (verified in `audit_logs`). The endpoint is a pure 200 no-op; the
logout audit trail is dead code. If session revocation is ever wired here, the
mount must move under `apiAuthProtected` or it will revoke nothing and log nothing.

### F4 — MED — BFF adds a second auth fan-out and its own failure/limits profile

- `app/api/auth/me/route.ts` does its own `admin.auth.getUser()` + PostgREST
  profile read per request → **37% 401 at 25VU**, and it folds upstream GoTrue
  failure into `401 Unauthorized` — the same status-confusion class as F2 (a
  GoTrue blip signs users out client-side rather than telling them to retry).
- `proxyToGoBackend` rate-limits every proxied call to 600/60s per client IP.
  At ≥10 sustained req/s per client the limiter 429s **before** Go — it dominates
  any burst measurement through :3000 (85–96% 429s above). Side effect worth
  noting: it incidentally shields the Go backend from saturation.

### F5 — LOW — BFF proxy tax is modest

+19ms avg / +27ms p95 at ~4.7 req/s clean A/B. Acceptable for a dev gateway; the
rate limit and the double auth fan-out matter more than the hop cost itself.

### F6 — INFO — Connection churn, not queries, is what saturates Postgres' container

`pg_stat_activity` stayed ~45–50 conns / 1–3 active while `supabase_db_spotlight`
burned 260–442% CPU: open/auth/close churn per inbound connection (GoTrue + API
PostgREST calls). Some of this is Docker-desktop networking overhead — flag it as
a local-stack artifact, but the shape (churn ≫ work) is real.

## Reproduce

Harness used: `/tmp/perf/load.js` (session-temporary — recreate from this doc if
needed). Equivalent one-liner per cell:

```sh
TOKEN=$(curl -s -X POST localhost:8080/api/auth/login -H 'Content-Type: application/json' \
  -d '{"identifier":"qa-claude-test@spotlight.internal","password":"LocalDevAdmin123!"}' \
  | jq -r .session.access_token)
k6 run -e VUS=25 -e DURATION=30s <script>   # GET <path> with Bearer
```

**Caution**: do NOT have each k6 run re-login under load — a saturated GoTrue turns
setup logins into lockout strikes (F2). Issue one token, pass it in, reuse it.
If the fixture does get locked, `scripts/dev/ensure-dev-login.sh` restores it
(verified working after this run's lockout).
