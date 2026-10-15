# Navigation Analytics Dashboard (SP5a) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** An admin navigation-analytics dashboard — one aggregate read endpoint over `navigation_events` (top screens, daily views, surface split, with range/surface/search filters) and a page under `/admin/analytics` that renders it with inline SVG + tables (no new chart dependency).

**Architecture:** One flag-gated Gin endpoint runs three parameterized `GROUP BY` queries and returns an explicit JSON payload (never the `Event` struct; no `user_id`). A client page fetches that single endpoint and re-fetches on filter change. Mirrors the SP4 admin-read placement and the SP4 service's 404-as-not-enabled pattern.

**Tech Stack:** Go 1.27 / Gin, pgx pool, Next.js App Router (frontend-admin), Vitest, `@/components/ui/vuexy` (Page/PageHeader/Card), existing `adminApiBase`/`readOrThrow`/`AdminUsersRequestError`.

**Spec:** `docs/superpowers/specs/2026-10-15-navigation-analytics-dashboard-design.md`

## Global Constraints

- Aggregation is on-the-fly parameterized SQL over `navigation_events`; **every** filter value is a bound parameter — no string interpolation (SQL-injection safe).
- Response carries only aggregate fields — **never `user_id`** (the `Event` struct has no JSON tags; build the payload explicitly, as SP4 does).
- Endpoint flag-gated by `cfg.FeatureNavTelemetryEnabled` (route unmounted → 404 when off), perm `audit.logs.view`, on the existing `navAdmin` (`/api/admin`) group.
- `range` ∈ {`7d`,`30d`,`90d`} default `30d`; `surface` ∈ {`all`,`mobile`,`web`} default `all`; invalid values **coerce to the default** (do not 400/500).
- `search` filters **topScreens only** (ILIKE, bound param). `surface` filter scopes topScreens + timeseries but NOT surfaceSplit (the split always returns both).
- **No new charting dependency** — inline SVG + tables + the vuexy card/Page components.
- Conventional Commits; PR < 400 lines where practical.

## Review Focus

- **Search param injection/odd input:** `search` containing `%`, `_`, or `'` must be a bound ILIKE parameter (escaped/parameterized), never interpolated — a `'`-bearing search must return results safely, not error or alter the query. → Task 1 test.
- **Invalid `range`/`surface`:** `range=evil`, `surface=xyz` coerce to defaults (`30d`/`all`), never 500 or reach SQL. → Task 1 handler test.
- **Privacy:** no `user_id` anywhere in the response payload. → Task 1 handler test.
- **Empty window:** no events in range → `{topScreens:[], timeseries:[], surfaceSplit:{mobile:0,web:0,total:0}}`, and the page shows an empty state rather than crashing on empty arrays / a zero-point SVG. → Task 1 + Task 2 tests.
- **404 vs 403 vs error on the page:** flag-off 404 → "not enabled" placeholder (distinct from a 403 permission placeholder and from a retryable error). → Task 2 tests.

---

## Task 1: Backend — aggregate read endpoint

**Files:**
- Modify: `backend/internal/telemetry/navigation/repo.go` (add `AggregateNavigation`) and `types.go` (add `AnalyticsFilter`, `NavAnalytics`, row types)
- Modify: `backend/internal/app/telemetry_admin.go` (add `AdminNavigationAnalyticsHandler`)
- Modify: `backend/internal/app/router.go` (add the route in the existing flag-gated `navAdmin` block near line 465)
- Test: `backend/internal/telemetry/navigation/analytics_live_test.go` (new), `backend/internal/app/telemetry_admin_test.go` (extend)

**Interfaces:**
- Produces:
  - `type AnalyticsFilter struct { Range string; Surface string; Search string }`
  - `type TopScreen struct { Route string; Views int64; Users int64 }`
  - `type DayBucket struct { Day string; Mobile int64; Web int64; Total int64 }` (Day = `YYYY-MM-DD`)
  - `type SurfaceSplit struct { Mobile int64; Web int64; Total int64 }`
  - `type NavAnalytics struct { TopScreens []TopScreen; Timeseries []DayBucket; SurfaceSplit SurfaceSplit }`
  - `func (r *Repository) AggregateNavigation(ctx context.Context, f AnalyticsFilter) (*NavAnalytics, error)`
  - HTTP: `func AdminNavigationAnalyticsHandler(repo navAggregator) gin.HandlerFunc` where `navAggregator` is a one-method interface over `AggregateNavigation` (mirrors SP4's `navLister`). Route `GET /api/admin/analytics/navigation`.

- [ ] **Step 1: Write the failing live-DB repo test** (`TEST_DATABASE_URL`-gated, `t.Cleanup`, random user ids): seed events across two routes, two surfaces, and two days within and one outside a 7d window; assert `AggregateNavigation({range:"7d",surface:"all",search:""})` → topScreens ordered by views desc with correct `Views` and distinct `Users`; the out-of-window row is excluded; timeseries has a bucket per day with mobile/web/total; surfaceSplit totals both surfaces. Add cases: `surface:"mobile"` scopes topScreens+timeseries but surfaceSplit still returns both; `search:"cry"` narrows topScreens only; a `search` containing `'` and `%` returns safely (no error).
- [ ] **Step 2: Run to verify it fails** — `cd backend && go test ./internal/telemetry/navigation/ -run Analytics -v` → FAIL (method undefined); skips cleanly without `TEST_DATABASE_URL`.
- [ ] **Step 3: Implement the types + `AggregateNavigation`** — three parameterized queries per the spec's SQL (window `occurred_at >= now() - $1::interval` with `$1` mapped from range; `surface=$n` when not `all`; `route ILIKE $n` with the pattern as a bound param; `date_trunc('day',occurred_at)` pivoted in Go to `DayBucket`). Return the assembled `NavAnalytics`.
- [ ] **Step 4: Write the failing handler test** (extend `telemetry_admin_test.go`, fake `navAggregator`): default params when absent (`30d`/`all`); `range=bogus`/`surface=bogus` coerce to defaults (assert the filter the fake receives); the response JSON has `range,surface,topScreens,timeseries,surfaceSplit` and contains **no `user_id`** (assert the raw body has no `user_id`); an aggregator error → sanitized 500.
- [ ] **Step 5: Run to verify it fails** — `cd backend && go test ./internal/app/ -run NavigationAnalytics -v` → FAIL.
- [ ] **Step 6: Implement `AdminNavigationAnalyticsHandler`** (read `range`/`surface`/`search` via `c.Query`, coerce invalid range/surface to defaults, call `repo.AggregateNavigation`, build the explicit `gin.H` payload) and register the route in `router.go`'s flag-gated `navAdmin` block: `navAdmin.GET("/analytics/navigation", middleware.RequirePermission(rbacService, "audit.logs.view"), AdminNavigationAnalyticsHandler(navigation.NewRepository(sharedPool)))`.
- [ ] **Step 7: Run to verify both pass** — the two `go test` commands above → PASS (live-DB exercised with `TEST_DATABASE_URL`); then `go build ./... && go vet ./...`.
- [ ] **Step 8: Commit** — `feat(telemetry): admin navigation analytics aggregate endpoint`.

---

## Task 2: Frontend — analytics dashboard page

**Files:**
- Modify: `frontend-admin/src/services/analyticsService.ts` (add `getNavigationAnalytics`) — or a new `navAnalyticsService.ts` if that file's shape doesn't fit; reuse `adminApiBase`/`authHeaders`/`readOrThrow`/`AdminUsersRequestError` from `usersService.ts`.
- Create: `frontend-admin/app/admin/analytics/navigation/page.tsx`
- Create (optional): a small `frontend-admin/app/admin/analytics/navigation/Sparkline.tsx` for the inline-SVG series
- Test: `frontend-admin/app/admin/analytics/navigation/navigation-analytics.test.tsx` (new)

**Interfaces:**
- Consumes: Task 1's `GET /api/admin/analytics/navigation?range&surface&search` → `{range,surface,topScreens:[{route,views,users}],timeseries:[{day,mobile,web,total}],surfaceSplit:{mobile,web,total}}`.
- Produces:
  - `getNavigationAnalytics(args: { range: string; surface: string; search: string }): Promise<{ enabled: boolean; data: NavAnalytics | null }>` — GET the endpoint; **404 → `{enabled:false, data:null}`**; 200 → `{enabled:true, data}`; other non-ok throws `AdminUsersRequestError`.
  - `export default function NavigationAnalyticsPage()`.

- [ ] **Step 1: Write the failing service test** — mock `fetch`: asserts the URL carries `range`/`surface`/`search` query params and the `/admin/analytics/navigation` path; a 404 resolves `{enabled:false}` (does not throw); a 403 throws `AdminUsersRequestError` with `.status===403`; a 200 returns `{enabled:true, data}`.
- [ ] **Step 2: Write the failing page test** (RTL + mock the service): loaded data renders the top-screens table rows (route + views + users), a surface-split showing mobile/web/total, and an SVG for the series (assert an `<svg>`/points exist); changing the range control refetches with the new `range`; the empty payload renders an empty state; `enabled:false` → "Navigation telemetry not enabled"; a 403 → permission placeholder; an error → inline error + Retry that refetches.
- [ ] **Step 3: Run to verify they fail** — `cd frontend-admin && npx vitest run app/admin/analytics/navigation/navigation-analytics.test.tsx src/services/analyticsService.test.ts` → FAIL.
- [ ] **Step 4: Implement** `getNavigationAnalytics` and the page: a client component using `@/components/ui/vuexy` (Page/PageHeader/Card) with the range selector, surface toggle, debounced search; three widgets (top-screens table, inline-SVG `Sparkline` of `timeseries.total`, surface-split cards); own loading/loaded/empty/not-enabled(404)/403/error+Retry states; a filter change refetches the one endpoint. Keep the SVG minimal (viewBox-scaled polyline; guard the zero/one-point case so it never divides by zero).
- [ ] **Step 5: Run to verify they pass** — same vitest command → PASS; then `cd frontend-admin && npm run type-check` (use `--stack-size=10000` if tsc crashes with zero errors).
- [ ] **Step 6: Commit** — `feat(admin): navigation analytics dashboard page`.

---

## Final verification (before PR)

- [ ] `cd backend && go build ./... && go vet ./...`; new Go tests pass (live-DB exercised with `TEST_DATABASE_URL`).
- [ ] `cd frontend-admin && npm run type-check` clean; `npx vitest run app/admin/analytics src/services` green.
- [ ] Confirm the route 404s with the flag off and the page shows "not enabled"; works with the flag on.
- [ ] Open PR to `main`. Request `security-reviewer` (admin read of user-behavior data + raw SQL aggregation). Body links the spec + plan; note funnels are deferred to SP5b.
