# Carried-over audit findings — re-verification results

Date: 2026-10-30. Verifier: re-verification subagent (read-mostly; no source
changes). Scope: the carried-over findings from `docs/full_audit.md` listed in
the re-verify brief.

Live stack exercised: Go api :8080 (`/readyz` 200, `/api/v1/public/health`
200), web :3000 (200), admin :3001 (307→login), Supabase :54321/:54322.

Method note: where a live fault-injection was unsafe (e.g. breaking the
`platform_users` lookup mid-stack), verification is code-level plus the repo's
own failing-path unit tests, run green during this pass.

## Verdicts

| ID | Finding | Verdict | Severity recommendation |
|----|---------|---------|-------------------------|
| AUD-BE-002 | Auth middleware fails open on `GetUserStatus` error | **FIXED** | close at P1-resolved |
| AUD-BE-008 | asynq notification queue has producers, no consumer | **FIXED** | close; residual local-dev gap is P3 |
| AUD-FE-006 | `handleApiError` swallows errors at ~1,068 sites | **FIXED** | close |
| AUD-FE-001 | Production EAS profile missing `EXPO_PUBLIC_*` env | **FIXED** | close (dashboard override unverifiable but no longer needed) |
| AUD-TEST-003 | No required CI checks on `main` | **FIXED (repo-level) / UNVERIFIABLE (GitHub-side)** | downgrade to P2 — mechanism + trigger coverage done; only the admin-console apply is unverifiable |
| AUD-SEC-001 / AUD-BE-004 | Spoofable, per-instance rate limiting | **PARTIALLY-FIXED** | downgrade to P2 — spoofability closed at both layers; per-instance residual on IP-keyed limiters remains |
| AUD-INFRA-002 | Expo dev server as production start command | **FIXED** | close |
| AUD-INFRA-003 | Fragmented deployment targets | **PARTIALLY-FIXED** | keep P2 — authority doc exists, but `render.yaml` `spotlight-backend` still has `autoDeploy: true` (two live writers for the backend) |
| AUD-INFRA-005 | Migration pipeline dormant; manual `db push` is the real path | **CONFIRMED-STILL-OPEN (by design)** | keep P2 — operator decision, not code |
| AUD-INFRA-006 | Worker/cron binaries deployed nowhere | **FIXED (manifest)** | close at manifest level; "actually running in prod" needs Render dashboard — mark UNVERIFIABLE for that sub-claim |

---

## AUD-BE-002 — auth fail-open — FIXED

Both status-check paths now fail closed; there is no second path that still
fails open. Only two production call sites of `rbac.GetUserStatus` exist:

1. `backend/internal/middleware/authz.go:153-159` — `resolveVerifiedIdentity`
   (backs `RequireAdminConsoleRole` and `RequireVerifiedIdentity`):
   `serr != nil` → **403 `could not verify account status`** (AUTH-012 comment
   at :147-152 documents the prior swallow).
2. `backend/internal/middleware/auth_context.go:75,100-103` — `requireAuth`,
   the shared body of **both** `RequireAuthContext` and
   `RequireAuthContextWithSessions`: `serr != nil` →
   **503 `account status check unavailable`**; `suspended|locked|deleted` →
   403. The session-revocation check (`sessErr`) also fails closed at :109-112.

Supporting contract: `repositories/rbac_supabase_repository.go:53-65` returns
`("pending", err)` on REST error vs `("pending", nil)` on missing row;
`services/rbac_cache.go:57-75` propagates the error and never caches it, and
`SuspendUser`/`LockUser`/`AssignRoleToUser`/`RemoveRoleFromUser`/
`UpdateAdminUser` all `invalidate(userID)` (rbac_cache.go:120-172). Cache is
opt-in (`AUTH_IDENTITY_CACHE_TTL_SECONDS`, default **0** = off,
config.go:658; wired router.go:98-100).

Tests run: `go test ./internal/middleware/ -count=1` → **ok** (includes
`admin_console_rbac_failclosed_test.go:175+`, `admin_verified_identity_test.go`,
`auth_context_test.go` error cases).

Residual (minor): with the identity cache enabled, an account suspended via
direct SQL (not the service layer) could be served a cached "active" for up to
TTL. Default off; service-path suspensions invalidate.

A fix would have touched: nothing further needed.

## AUD-BE-008 — notification queue consumer — FIXED

- `backend/cmd/notification-worker/main.go:19-45` — real consumer:
  `queue.NewServer(cfg.RedisURL, 10)` + `asynq.NewServeMux()` +
  `notifications.Workers(mux, …)` (push/email/sms), SIGTERM drain via
  `srv.Shutdown()`.
- `Dockerfile:18,28` — binary built and copied into the runtime image.
- `render.yaml:68-100` — **`spotlight-notification-worker` Render worker
  service** with `REDIS_URL` (fromService `spotlight-redis`) and all provider
  creds (`RESEND_*`, `TERMII_*`, `EXPO_PUSH_TOKEN`).
- In-process path checked: `router.go:676-696` `startInProcessWorkers` runs
  **only** the marketplace indexer under `RUN_WORKERS_INPROCESS`;
  `cmd/server/main.go` wires **no** asynq consumer. The Render worker is the
  sole notification consumer — deliberate (render.yaml:32-33 sets
  `RUN_WORKERS_INPROCESS=false` on the web service).
- Producers confirmed earlier: `finance_routes.go`, `health_triage_routes.go`
  enqueue via `queue.NewClient`; handlers at `internal/notifications/service.go`.

Residual: `docker-compose.yml` has **no** notification-worker service — a
plain local `compose up` enqueues notifications that never drain (marketplace
workers are profile-gated; notification worker is absent entirely). P3
local-dev gap; a fix would add a compose service reusing the backend image
with `command: ["/app/notification-worker"]` + `REDIS_URL`.

## AUD-FE-006 — handleApiError swallow — FIXED

`frontend-web/src/lib/api/responses.ts:41-63`:

- Unexpected errors hit `console.error('[api] Unhandled route error:', error)`
  (line 56) **and** guarded `Sentry.captureException(error)` (lines 57-61;
  reporting can never break the response path).
- `ApiError` / `UNAUTHORIZED` / `FORBIDDEN` return early with their real status
  and no logging — correct: those are expected statuses, not swallowed faults.
- Sentry is actually initialized: `frontend-web/sentry.server.config.ts`
  (`enabled: Boolean(dsn)` — inert until `SENTRY_DSN` is set),
  `sentry.client.config.ts`, `sentry.edge.config.ts`, `withSentryConfig` in
  `next.config.mjs`, `@sentry/nextjs ^11.1.0` in package.json. Server-side
  `console.error` fires regardless of DSN.
- Call-site count: **1,080** (1,078 in `app/`, 2 in `src/lib/`) — consistent
  with the original ~1,068.
- Tests: `frontend-web/tests/unit/api/responses.spec.ts` — 7/7 green this pass
  (pins `captureException` called for unknown errors, not called for
  ApiError/401/403 paths).

Residual: if `SENTRY_DSN` is unset in prod, reporting reduces to console logs
(operator concern, not code). The generic 500 message returned to clients is
unchanged by design.

## AUD-FE-001 — production EAS env — FIXED

`mobile-app/reactnative/eas.json` `build.production.env` now carries:
`EXPO_PUBLIC_APP_ENV=production`, `EXPO_PUBLIC_SENTRY_ENVIRONMENT=production`,
`EXPO_PUBLIC_API_BASE_URL=https://www.spotlightng.com`,
`EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`,
`EXPO_PUBLIC_CLOUDINARY_CLOUD_NAME` (+ matching values on `preview`, `staging`,
`staging-aab`).

Additionally `src/lib/apiBaseUrl.ts:13-27` (`resolveApiBaseUrl`, AUD-FE-001
header comment) makes an unset var **loud** (`console.error`) in non-dev builds
instead of silently baking `localhost:3000`. 11 consumers in `src/` go through
the shared axios baseURL.

Note: `EXPO_PUBLIC_API_BASE_URL` in eas.json is the bare apex (calls route
through the frontend-web Next proxy per module comments), while
`render.yaml:284-288` points the Expo **web** build at the backend URL +
`/api/v1` — different surfaces, both deliberate. EAS dashboard vars could
still override; no longer needed for correctness.

## AUD-TEST-003 — required checks on `main` — FIXED (repo) / UNVERIFIABLE (GitHub)

- `ci.yml:43-49` — triggers now cover `push`/`pull_request` on
  `[develop, staging, prod, main]`; the header (lines 32-40) explicitly cites
  AUD-TEST-003 and explains why `pull_request` carries no paths-ignore
  (required checks must always report).
- `.github/required-checks.txt` — **9 required check-run names** documented for
  develop AND main: `backend (go build + vet) / verify`,
  `frontend-admin (type-check) / typecheck`,
  `frontend-web (regression + money + contract + tsc + lint) / verify`,
  `hygiene (client secrets + live-DB test gate + migration versions)`,
  `migrations (additive-only guard) / guard`, `mobile (whole-app tsc) /
  typecheck`, `openapi (validate all contracts) / validate`,
  `which modules changed`, `workflows (actionlint)`.
- `scripts/ci/apply-branch-protection.sh` — applies the list via the GitHub
  API (needs admin token); `scripts/ci/test-changed-modules.py` asserts every
  required name still exists in ci.yml so a rename fails CI loudly.
- Also present: `ci-optimized.yml` (main-only belt lane), `integration-verify.yml`
  (push:main + PRs), `security.yml`, per-module reusable lanes.

UNVERIFIABLE part: whether those 9 contexts are actually marked required on
`main` in GitHub branch protection — needs repo-admin API access. The repo-side
mechanism (triggers + documented check names + apply script + drift test) is
complete; suggest re-scoring P1→P2 with the residual noted as operator action.

## AUD-SEC-001 / AUD-BE-004 — rate limiting — PARTIALLY-FIXED

**Spoofable IP keying: closed at both layers.**

- Backend: `router.go:49-55` calls `r.SetTrustedProxies(proxies)` parsed by
  `middleware.ParseTrustedProxies` (middleware.go:139-156) from
  `TRUSTED_PROXY_CIDRS` (config.go:661; default = GCP external-LB ranges;
  `none`/empty → forwarded headers ignored, `ClientIP` = RemoteAddr —
  fail-closed). All `ClientIP()` consumers (AuthRateLimiter, StemRateLimit,
  audit, suspicious-login) inherit this. Live `.env` sets
  `TRUSTED_PROXY_CIDRS=none`. `proxies_test.go` pins parsing.
- Frontend BFF: root `middleware.ts:44-64,68-79` rewrites `x-forwarded-for` /
  `x-real-ip` to `getRequestIp()` for every `/api/*` request —
  `src/lib/rate-limit/client-ip.ts:31-50` takes the **rightmost-N-hops**
  entry (`RATE_LIMIT_TRUSTED_PROXY_HOPS`, default 1), sanitizes, and groups
  forged short chains into a shared `0.0.0.0` bucket rather than trusting them.
  ~45 legacy handlers that read raw XFF get the normalized value without being
  edited (protected-file safe).

**Distributed backing: partial.**

- `middleware.PerUserRateLimit` (per_user_rate_limit.go:31-77) is
  **Redis-backed** (INCR+EXPIRE per-minute bucket) when `REDIS_URL` is set —
  prod wires it (`render.yaml` fromService) — with in-memory fallback keyed on
  user_id, not IP. Mounted on vote-bridge debit/reverse
  (finance_routes.go:2529,2534) and maps (finance_routes.go:3292).
  `redisAllow` fails open on Redis error (line 70-72) — deliberate.
- OTP/signup paths use `otp.NewPostgresLimiter(pool)` — Postgres fixed-window,
  atomic, **shared across replicas** (otp_routes.go:114-118), IP pepper-hashed.
- Still **per-instance in-memory**: `AuthRateLimiter` (login/register/reset,
  router.go:143-144) and `StemRateLimit` (all stem groups) — bounded maps with
  sweep+evict (middleware.go:209-347, 349-448; caps 100k keys), but each
  replica gets its own budget → effective limit = configured × instance count
  (Render web `maxInstances: 3`). Same for the BFF `checkRateLimit` Map
  (`src/lib/voting/rate-limit.ts` — MAX_BUCKETS 20k, per Next.js process).

**Live probe:** `POST :8080/api/auth/login` ×13 → 401s with
`X-RateLimit-Limit: 1000`, `X-RateLimit-Remaining: 987` decrementing correctly
(local `.env` overrides `AUTH_RATE_LIMIT_PER_MIN=1000`; code default is
10/min, config.go:906). Limiter functioning; header contract verified.

What a full fix would touch: swap `AuthRateLimiter`/`StemRateLimit` stores for
the existing `platformRedis` INCR+EXPIRE pattern (or Postgres limiter) and
inject `sharedRedis` (router.go:483-490) into the unauthenticated groups.

## AUD-INFRA-002/003/005/006 — deploy fragmentation et al.

- **INFRA-002 — FIXED.** `render.yaml:261-292`: `spotlight-mobile` is now
  `runtime: static`, `buildCommand: npm install && npx expo export
  --platform web`, `staticPublishPath: dist`. Mobile `Dockerfile` builds the
  export and serves it via `serve -s public -l 8083` as non-root.
  `package.json` `"start": "expo start --port 8083"` remains — dev script
  only, not a deploy path.
- **INFRA-003 — PARTIALLY-FIXED.** `docs/devops/deployment-matrix.md` declares
  the authoritative path per service per environment plus a
  "non-authoritative/legacy" table. **But** `render.yaml:5-21` still defines
  `spotlight-backend` web with `autoDeploy: true` — two armed writers for the
  backend (`deploy.yml` Cloud Run + Render blueprint) on every push, exactly
  the race the matrix warns about. `ADR-PR421-deployment-authority.md` is still
  **Status: Proposed — needs owner ratification**, and its quarantine step
  (remove `autoDeploy`, then delete non-authoritative configs) is unexecuted.
  Legacy files all still present: `backend/railway.json`,
  `frontend-web/railway.json`, `frontend-admin/railway.json`, `*/app.yaml`,
  `deploy-gcp.sh`, `deploy-render.sh`, `deploy-mobile.sh`,
  `infra/terraform/`, `mobile-app/reactnative/vercel.json`,
  `frontend-web/server.js`, `deploy-cpanel.yml` (now gated on
  `vars.CPANEL_DEPLOY_ENABLED == 'true'` — an improvement).
- **INFRA-005 — CONFIRMED-STILL-OPEN (by design).** `db-migrate.yml` remains
  dormant pending `DB_MIGRATE_ENABLED=true` + Supabase secrets; its header
  warns against enabling until the reconciliation runbook brings the remote to
  `pending: 0`. Production schema application is still manual `supabase db
  push`. Mitigations in place: `integration-verify.yml` migrate-up/reset on
  push:main, `_reusable-migration-guard.yml` additive-only guard,
  `check-migration-versions.sh` in the required `hygiene` lane.
- **INFRA-006 — FIXED at manifest level.** `render.yaml` declares four worker
  services: `spotlight-notification-worker` (:68-100),
  `spotlight-marketplace-cron` (:113-133), `spotlight-marketplace-indexer`
  (:138-164, idles until `ES_URL`), `spotlight-transport-scheduler` (:169-197,
  idles until flag on). `cmd/fxsmoke`/`voting-test-server` intentionally
  excluded. Whether the Render services actually run in prod is not
  repo-verifiable.

Live bonus check: `:8080/readyz` returns 200 — the AUD-INFRA-007 probe
contract (deploy.yml/terraform `/healthz`+`/readyz`) is now backed by a real
route in this build.
