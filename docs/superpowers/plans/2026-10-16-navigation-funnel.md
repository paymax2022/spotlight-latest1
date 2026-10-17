# Navigation Funnel (SP5b) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A defined-funnel analysis — an admin picks an ordered list of screen routes and sees how many users reach each step (within a session gap) and the drop-off, via a `POST` endpoint and a funnel-builder dashboard page.

**Architecture:** The endpoint fetches only the funnel's step-events from `navigation_events` and computes the funnel in a pure, unit-tested Go function (`ComputeFunnel`); the sequencing (ordered steps, each within `gap` of the previous match) lives in Go, not SQL. A client page builds the ordered steps + filters, POSTs them, and renders a step-bar funnel with drop-off (inline SVG, no new dependency). Mirrors SP4/SP5a placement and the 404-as-not-enabled service pattern.

**Tech Stack:** Go 1.27 / Gin, pgx pool, Next.js App Router (frontend-admin), Vitest, `@/components/ui/vuexy`, existing `adminApiBase`/`readOrThrow`/`AdminUsersRequestError`.

**Spec:** `docs/superpowers/specs/2026-10-16-navigation-funnel-design.md`

## Global Constraints

- Endpoint `POST /api/admin/analytics/navigation/funnel`, flag-gated (`cfg.FeatureNavTelemetryEnabled && sharedPool != nil`) on the existing `navAdmin` (`/api/admin`) group, perm `audit.logs.view` → 404 when off.
- All SQL filter values are bound parameters (`route = ANY($1)`, interval `$2`, surface `$3`) — no string interpolation.
- Response built explicitly — **never `user_id`** (the `Event`/row structs have no JSON tags; build `gin.H`).
- Validation: `steps` 2–10 non-empty route strings (≤256 chars) — `<2` or `>10` → `400`; `range`∈{7d,30d,90d} default 30d, `surface`∈{all,mobile,web} default all (invalid → coerce); `gapMinutes` default 30, clamp [1,1440].
- Sequencing semantics are the spec's greedy forward-scan (each matched step within `gap` of the previous match; first step ungated; non-matching events skipped without reset; `users[k]` = distinct users with depth ≥ k). Deterministic greedy, not a global optimum.
- No new charting dependency — inline SVG + tables + vuexy components.
- Conventional Commits; PR < 400 lines where practical.

## Review Focus

- **Gap-break sequencing:** a correct next-step route that arrives later than `gap` after the previous match must NOT advance the funnel — the user's depth stops. A naive "did both routes ever appear in order" count would over-report conversion. → Task 1 `ComputeFunnel` test.
- **Distinct-user counting:** the same user hitting step 2 twice counts once at step 2; a user reaching step 3 also counts in steps 1 and 2. → Task 1 test.
- **Steps-count validation:** `steps` with <2 or >10 entries → 400 (not a 500 or an empty/giant query). → Task 1 handler test.
- **Privacy:** no `user_id` anywhere in the funnel response. → Task 1 handler test.
- **404 vs 403 vs empty on the page:** flag-off 404 → "not enabled"; 403 → permission; all-zero result → empty — all distinct, none a crash. → Task 2 test.

---

## Task 1: Backend — funnel endpoint + ComputeFunnel

**Files:**
- Modify: `backend/internal/telemetry/navigation/repo.go` (add `FunnelStepEvents`), `types.go` (add `StepEvent`), and add `funnel.go` for `ComputeFunnel`
- Modify: `backend/internal/app/telemetry_admin.go` (add `AdminNavigationFunnelHandler`)
- Modify: `backend/internal/app/router.go` (add the route in the flag-gated `navAdmin` block, beside the SP5a analytics route)
- Test: `backend/internal/telemetry/navigation/funnel_test.go` (new, pure — the crux), `backend/internal/telemetry/navigation/funnel_live_test.go` (new, live-DB), `backend/internal/app/telemetry_admin_test.go` (extend)

**Interfaces:**
- Produces:
  - `type StepEvent struct { UserID string; Route string; OccurredAt time.Time }`
  - `func ComputeFunnel(events []StepEvent, steps []string, gap time.Duration) []int64` — pure; `events` grouped by user in `OccurredAt` order (user boundary = `UserID` change); returns a slice of length `len(steps)`, entry `k` = distinct users reaching step `k+1`.
  - `func (r *Repository) FunnelStepEvents(ctx context.Context, steps []string, f AnalyticsFilter) ([]StepEvent, error)` — the `route = ANY($1)` query ordered by `user_id, occurred_at` (`AnalyticsFilter{Range,Surface,Search}` from SP5a; `Search` unused here).
  - HTTP: `func AdminNavigationFunnelHandler(repo funnelRepo) gin.HandlerFunc` (one-method interface over `FunnelStepEvents`), route `POST /api/admin/analytics/navigation/funnel`.

- [ ] **Step 1: Write the failing `ComputeFunnel` tests** (pure, no DB) — assert the spec's semantics with explicit event lists + a `gap`:
  - full in-order completion within gap → `[nUsers@1, @2, @3]` all equal for one user → `[1,1,1]`;
  - step 2 occurs **after** gap from step 1 → depth stops at 1 → `[1,0,0]`;
  - out-of-order (step 2 before step 1) and non-funnel routes are skipped → correct depth;
  - repeated step route doesn't rewind/double-count;
  - two users with depths 3 and 1 → `[2,1,1]`;
  - a user missing step 0 → counted nowhere;
  - empty events → `[0,0,0]`;
  - first step has no gap constraint.
- [ ] **Step 2: Run to verify they fail** — `cd backend && go test ./internal/telemetry/navigation/ -run Funnel -v` → FAIL (undefined).
- [ ] **Step 3: Implement `StepEvent` + `ComputeFunnel`** per the spec's greedy forward-scan (reset state on `UserID` change; a `map[string]struct{}` or counter per step index for distinct users — since each user contributes once, increment counts for all `k <= depth` at the user boundary).
- [ ] **Step 4: Run to verify they pass** — same command → PASS.
- [ ] **Step 5: Write the failing live-DB repo test** (`TEST_DATABASE_URL`-gated, `t.Cleanup`, random users): seed step + non-step events across surfaces/times; `FunnelStepEvents(steps, {range,surface})` returns only step-route rows in the window, ordered by user then time, surface filter applied.
- [ ] **Step 6: Implement `FunnelStepEvents`** (bound-param query above; reuse SP5a's range→interval whitelist and surface whitelist). Run `-run Funnel` with `TEST_DATABASE_URL` → PASS.
- [ ] **Step 7: Write the failing handler test** (fake `funnelRepo`): a body with 1 step → 400; 11 steps → 400; valid body → 200 with `{range,surface,gapMinutes,steps:[{route,users}]}` and the raw body has **no `user_id`**; invalid `range`/`surface` coerce; `gapMinutes` out of range clamps; a repo error → sanitized 500.
- [ ] **Step 8: Implement `AdminNavigationFunnelHandler`** (bind+validate the body, coerce/clamp, call `FunnelStepEvents` then `ComputeFunnel`, build explicit `gin.H`) and register `navAdmin.POST("/analytics/navigation/funnel", middleware.RequirePermission(rbacService, "audit.logs.view"), AdminNavigationFunnelHandler(navigation.NewRepository(sharedPool)))` in the flag-gated block.
- [ ] **Step 9: Run both test files** — `go test ./internal/telemetry/navigation/ -run Funnel` and `go test ./internal/app/ -run NavigationFunnel` → PASS; then `go build ./... && go vet ./...`.
- [ ] **Step 10: Commit** — `feat(telemetry): navigation funnel endpoint + ComputeFunnel`.

---

## Task 2: Frontend — funnel builder dashboard

**Files:**
- Modify: `frontend-admin/src/services/analyticsService.ts` (add `getNavigationFunnel`)
- Create: `frontend-admin/app/admin/analytics/navigation/funnel/page.tsx`
- Test: `frontend-admin/app/admin/analytics/navigation/funnel/navigation-funnel.test.tsx` (new), extend `src/services/analyticsService.test.ts`

**Interfaces:**
- Consumes: Task 1's `POST /api/admin/analytics/navigation/funnel` → `{range,surface,gapMinutes,steps:[{route,users}]}`.
- Produces:
  - `getNavigationFunnel(args: { steps: string[]; range: string; surface: string; gapMinutes: number }): Promise<{ enabled: boolean; data: FunnelResult | null }>` — POST; **404 → `{enabled:false,data:null}`**; 200 → `{enabled:true,data}`; other non-ok throws `AdminUsersRequestError`.
  - `export default function NavigationFunnelPage()`.

- [ ] **Step 1: Write the failing service test** — mock `fetch`: asserts POST to `/admin/analytics/navigation/funnel` with a JSON body carrying `steps` (in order), `range`, `surface`, `gapMinutes`; 404 → `{enabled:false}` (no throw); 403 → throws `AdminUsersRequestError` `.status===403`; 200 → `{enabled:true,data}`.
- [ ] **Step 2: Write the failing page test** (RTL + mock the service): adding/removing/reordering step inputs updates the ordered list; Run is disabled with <2 steps and enabled at ≥2; clicking Run POSTs the steps in order; a returned funnel renders one bar per step with the user count and the drop-off % from the previous step; `enabled:false` → "Navigation telemetry not enabled"; 403 → permission placeholder; all-zero data → empty state; an error → inline error + Retry.
- [ ] **Step 3: Run to verify they fail** — `cd frontend-admin && npx vitest run app/admin/analytics/navigation/funnel src/services/analyticsService.test.ts` → FAIL.
- [ ] **Step 4: Implement** `getNavigationFunnel` and the page (vuexy `Page/PageHeader/Card/Button/Input`): an ordered step builder (add/remove/move-up-down; optional `<datalist>` of routes, else free text), range/surface/gap controls, a Run button gated on ≥2 non-empty steps; render the funnel as inline-SVG/CSS bars scaled to `data.steps[0].users` (guard all-zero → empty state), each labeled count + drop-off; own loading/loaded/empty/not-enabled(404)/403/error+Retry states.
- [ ] **Step 5: Run to verify they pass** — same vitest command → PASS; then `cd frontend-admin && npm run type-check` (use `--stack-size=10000` if tsc crashes with zero errors).
- [ ] **Step 6: Commit** — `feat(admin): navigation funnel builder dashboard`.

---

## Final verification (before PR)

- [ ] `cd backend && go build ./... && go vet ./...`; new Go tests pass (live-DB exercised with `TEST_DATABASE_URL`); `ComputeFunnel` tests green.
- [ ] `cd frontend-admin && npm run type-check` clean; `npx vitest run app/admin/analytics src/services` green.
- [ ] Confirm the route 404s with the flag off and the page shows "not enabled"; works with the flag on.
- [ ] Open PR to `main`. Request `security-reviewer` (admin read of behavioral data + raw SQL). Body links the spec + plan; note the path/transition explorer (model B) is a possible future piece.
