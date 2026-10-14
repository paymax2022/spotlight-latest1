# Navigation Telemetry Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the backend foundation for navigation telemetry — a `navigation_events` table, an authenticated batch ingest endpoint, and a retention purge — behind a feature flag, serving both per-user timelines and aggregates later.

**Architecture:** One additive table written service-side via pgx. An authenticated Gin endpoint (`POST /api/v1/telemetry/navigation`) stamps the user id from the token, validates route-only (no PII) payloads, rate-limits per user, and appends. A boot-started background-ticker goroutine purges rows older than 90 days (the repo has no asynq/pg_cron scheduler; follow the existing `StartReconScheduler`/`StartTreasuryMonitor` ticker pattern). Everything is gated by `FEATURE_NAV_TELEMETRY_ENABLED`, off by default.

**Tech Stack:** Go 1.27 / Gin, pgx pool, Supabase/Postgres migrations, existing `middleware.PerUserRateLimit` (Redis), `middleware.RequireAuthContext`.

**Spec:** `docs/superpowers/specs/2026-10-14-navigation-telemetry-foundation-design.md`

## Global Constraints

- Privacy: store ONLY `user_id`, `surface`, `route` (route name/pattern), `occurred_at`, `created_at`. Never a query string, path value, or any PII.
- `user_id` always comes from the authenticated token, never the request body.
- Retention window: **90 days**, as a named constant.
- Batch cap: **50** events per request.
- Feature flag `FEATURE_NAV_TELEMETRY_ENABLED` (Go field `FeatureNavTelemetryEnabled`, via `getEnvBool(..., false)`), **off by default**; gates both the route registration and the purge ticker.
- Migration is additive-only; re-check the version stamp immediately before merge (cross-PR collision rule). No DROP, no narrowing.
- `navigation_events.user_id` is a plain `uuid` column with **no FK** to `auth.users`/`platform_users` (project convention). Service-role access only; do not FORCE RLS without a write policy.
- Conventional Commits; PR < 400 lines where practical.

## Review Focus

- **PII embedded in a path segment** (not just query string): `route = "users/<uuid>"`, `"profile/foo@bar.com"`, `"pay/50000"` must be rejected, not just `?a=b`. → Task 2 tests.
- **Body-supplied `user_id` spoofing**: a body with someone else's id must be ignored; the stored row carries the token's id. → Task 2 test.
- **Oversized/abusive payload**: a batch over 50 is `400`; the handler must also bound total body size so a giant request can't OOM. → Task 2 tests.
- **Clock-skew / backfill `occurred_at`**: far-future or far-past timestamps are dropped, not stored. → Task 2 test.
- **Purge under volume**: the delete is bounded-batch (no full-table lock) and removes only rows older than 90 days, never recent ones. → Task 1 + Task 3 tests.

---

## Task 1: Storage — migration + repository

**Files:**
- Create: `supabase/migrations/<stamp>_navigation_events.sql`
- Create: `backend/internal/telemetry/navigation/repo.go`
- Create: `backend/internal/telemetry/navigation/types.go`
- Test: `backend/internal/telemetry/navigation/repo_live_test.go`

**Interfaces:**
- Produces:
  - `type Event struct { UserID string; Surface string; Route string; OccurredAt time.Time }`
  - `type Repository struct { db *pgxpool.Pool }` + `func NewRepository(db *pgxpool.Pool) *Repository`
  - `func (r *Repository) Insert(ctx context.Context, events []Event) (int, error)` — bulk insert; returns rows written.
  - `func (r *Repository) PurgeOlderThan(ctx context.Context, cutoff time.Time, batch int) (int64, error)` — deletes in bounded batches of `batch`, looping until none remain; returns total deleted.

- [ ] **Step 1: Write the migration.** `CREATE TABLE public.navigation_events (id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, user_id uuid NOT NULL, surface text NOT NULL CHECK (surface IN ('mobile','web')), route text NOT NULL CHECK (char_length(route) <= 256), occurred_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now());` plus indexes `(user_id, occurred_at DESC)`, `(route, occurred_at)`, `(occurred_at)`. Grant service-role access per the repo's convention for service-only tables (match a recent additive service-only table migration; do not FORCE RLS without a write policy). Pick the stamp as the current max + the project's increment.
- [ ] **Step 2: Write the failing live-DB test** (`//go:build` / `TEST_DATABASE_URL` gate like other `*_live_test.go`; `t.Cleanup` to delete seeded rows): insert a 2-event batch for a random user id → `Insert` returns 2 and both rows are readable by `user_id` ordered by `occurred_at`; seed one row `occurred_at = now()-100d` and one `now()-1d`, call `PurgeOlderThan(now()-90d, 10000)` → returns 1 and only the recent row remains.
- [ ] **Step 3: Run to verify it fails** — `cd backend && go test ./internal/telemetry/navigation/ -run Live -v` → FAIL (package/methods undefined). Skips cleanly without `TEST_DATABASE_URL`.
- [ ] **Step 4: Implement `types.go` + `repo.go`** with the signatures above. `Insert` uses a single multi-row INSERT (or `pgx.Batch`). `PurgeOlderThan` loops `DELETE FROM navigation_events WHERE ctid IN (SELECT ctid FROM navigation_events WHERE occurred_at < $1 LIMIT $2)` until 0 rows, summing the count.
- [ ] **Step 5: Run to verify it passes** — same command with `TEST_DATABASE_URL` set → PASS; then `go build ./...`.
- [ ] **Step 6: Commit** — `feat(telemetry): navigation_events table + repository (insert, purge)`.

---

## Task 2: Ingest endpoint + validation + flag + rate limit

**Files:**
- Modify: `backend/internal/config/config.go` (add `FeatureNavTelemetryEnabled` + env wire)
- Create: `backend/internal/telemetry/navigation/handler.go`
- Create: `backend/internal/telemetry/navigation/validate.go`
- Modify: `backend/internal/app/<a routes file>.go` (register the route; e.g. a new `telemetry_routes.go` called from the app wiring)
- Test: `backend/internal/telemetry/navigation/validate_test.go`, `backend/internal/telemetry/navigation/handler_test.go`

**Interfaces:**
- Consumes: `Repository.Insert` (Task 1); `middleware.RequireAuthContext(supabase, rbac)`; `middleware.PerUserRateLimit(redis *platformRedis.Client, prefix string, perMinute int) gin.HandlerFunc`; `ginutil.UserID(c)` (or the project's token-user accessor).
- Produces:
  - `func CleanRoute(raw string) (string, bool)` in `validate.go` — returns the accepted route and `ok=false` if it must be rejected (contains `?`, `=`, `&`, or a path segment that is all-digits, a uuid, or contains `@`; or length > 256).
  - `func (h *Handler) Ingest(c *gin.Context)` — `POST /api/v1/telemetry/navigation`.
  - `func RegisterRoutes(r *gin.Engine, cfg config.Config, repo *Repository, authMW, limitMW gin.HandlerFunc)` — registers the route only when `cfg.FeatureNavTelemetryEnabled`.

- [ ] **Step 1: Write failing `CleanRoute` tests** — accepts `"crypto/assets"`, `"wallet"`; rejects `"pay?amount=500"`, `"users/3f2504e0-4f89-11d3-9a0c-0305e82c3301"`, `"profile/foo@bar.com"`, `"orders/12345"`, and a 300-char string. Assert the exact (route, ok) results.
- [ ] **Step 2: Write failing handler tests** (gin test context with a faked auth user + a fake/real repo): (a) body `{events:[{surface:"mobile",route:"home",occurred_at:<now>}]}` with a DIFFERENT `user_id` in the body → stored event's UserID equals the TOKEN user, not the body; (b) 51-event batch → `400`; (c) event with `surface:"desktop"` → dropped, `accepted` excludes it; (d) event whose route fails `CleanRoute` → dropped; (e) `occurred_at` = now+48h and now-120d → dropped; (f) a valid batch → `202` with `{accepted: n}` matching stored count.
- [ ] **Step 3: Run to verify they fail** — `cd backend && go test ./internal/telemetry/navigation/ -run 'Clean|Ingest' -v` → FAIL.
- [ ] **Step 4: Implement** `config.go` flag (`FeatureNavTelemetryEnabled: getEnvBool("FEATURE_NAV_TELEMETRY_ENABLED", false)`), `CleanRoute`, `Ingest` (parse batch, cap 50, bound body size via `c.Request.Body = http.MaxBytesReader(...)`, stamp `UserID` from the token, validate each event, drop invalid, `repo.Insert` the survivors, respond `202 {accepted}`), and `RegisterRoutes` (flag-gated; apply `RequireAuthContext` then `PerUserRateLimit(redis, "navtel", 120)` to the route). Wire `RegisterRoutes` into the app bootstrap next to the other `/api/v1` registrations.
- [ ] **Step 5: Run to verify they pass** — same command → PASS; `go build ./... && go vet ./...`.
- [ ] **Step 6: Commit** — `feat(telemetry): authenticated navigation ingest endpoint (flag-gated, PII-safe, rate-limited)`.

---

## Task 3: Retention purge ticker

**Files:**
- Create: `backend/internal/telemetry/navigation/purge.go`
- Modify: the app bootstrap (start the ticker next to the other background schedulers)
- Test: `backend/internal/telemetry/navigation/purge_test.go`

**Interfaces:**
- Consumes: `Repository.PurgeOlderThan` (Task 1); `cfg.FeatureNavTelemetryEnabled`.
- Produces:
  - `const RetentionDays = 90`
  - `func StartPurgeScheduler(ctx context.Context, repo *Repository, interval time.Duration)` — a goroutine that ticks every `interval` (daily in prod) and calls `repo.PurgeOlderThan(ctx, time.Now().Add(-RetentionDays*24*time.Hour), 10000)`; logs the deleted count; stops on `ctx.Done()`. Follows the repo's existing `StartReconScheduler`/`StartTreasuryMonitor` background-ticker pattern (there is no asynq/pg_cron scheduler).
  - `func purgeOnce(ctx context.Context, repo purger, now time.Time) (int64, error)` — the single-tick body (extracted so it's testable with an injected clock); `purger` is a one-method interface over `PurgeOlderThan`.

- [ ] **Step 1: Write the failing test** — a fake `purger` records the `cutoff` it was called with; `purgeOnce(ctx, fake, fixedNow)` calls the repo exactly once with `cutoff == fixedNow.Add(-90*24h)` (assert the window is 90 days, not off-by-one) and returns the fake's count.
- [ ] **Step 2: Run to verify it fails** — `cd backend && go test ./internal/telemetry/navigation/ -run Purge -v` → FAIL.
- [ ] **Step 3: Implement** `purge.go` with `RetentionDays`, `purgeOnce`, and `StartPurgeScheduler` (ticker loop calling `purgeOnce`), and start it from the app bootstrap **only when `cfg.FeatureNavTelemetryEnabled`**. A purge running on multiple instances is harmless (idempotent DELETE of old rows) — note that in a comment.
- [ ] **Step 4: Run to verify it passes** — same command → PASS; `go build ./...`.
- [ ] **Step 5: Commit** — `feat(telemetry): 90-day navigation retention purge ticker (flag-gated)`.

---

## Final verification (before PR)

- [ ] `cd backend && go build ./... && go vet ./...`; the new package tests pass (live-DB tests exercised with `TEST_DATABASE_URL`).
- [ ] Migration replays cleanly (`supabase db reset` locally, or the `migrations`/`hygiene` CI lanes) and the stamp is re-checked against `origin/main` immediately before merge.
- [ ] Confirm the route 404s with the flag off and works with it on (manual or an integration check).
- [ ] Open PR to `main`. Request `security-reviewer` (new authenticated write endpoint handling user-behavior data). Body links the spec and this plan. Note this is SP1 of the navigation-telemetry program; SP2 (mobile), SP3 (web), SP4 (admin panel), SP5 (dashboards) follow as separate specs.
