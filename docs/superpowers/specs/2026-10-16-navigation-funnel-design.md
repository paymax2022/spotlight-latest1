# Navigation Funnel (SP5b) design

**Date:** 2026-10-16
**Status:** Design (pre-implementation)
**Branch:** `feat/nav-telemetry-funnel`

## Purpose

Let admins define an ordered sequence of screens (a funnel) and see how many users
progress through each step and where they drop off. This is the conversion-analysis
surface of the navigation-telemetry program (SP1–SP5a merged).

Scope is the **defined funnel** with **session-gap** sequencing. The path/transition
explorer (pick a screen, see top next-screens) is explicitly **out of scope** — a
possible later piece.

## Chosen approach

Fetch only the funnel's step-events from `navigation_events` and compute the funnel in
Go (a pure, unit-tested function) — rejected: computing the ordered-step-within-gap
match in SQL window functions (correct but hairy and hard to test) and
precomputing/materializing (YAGNI for a low-QPS admin read over a 90-day-capped table).

## Sequencing semantics (the crux — pinned)

A user **reaches step k** if their events contain an ordered subsequence matching
`steps[0..k]` where **each consecutive matched step occurs within `gap` of the
previously matched step** (default gap 30 min). Computed per user by a greedy forward
scan over that user's step-events ordered by `occurred_at`:

```
p = 0                      // next step to match
depth = 0                  // deepest step reached (count)
lastMatchedAt = nil
for each event (ordered by occurred_at):
    if event.route == steps[p]:
        if p == 0 OR (event.occurred_at - lastMatchedAt) <= gap:
            lastMatchedAt = event.occurred_at
            p += 1
            depth = p
            if p == len(steps): break   // completed
    // events that don't match steps[p] are skipped (do not reset p)
users[k] = count of DISTINCT users whose depth >= k   // for k in 1..len(steps)
```

Pinned edge cases (each gets a test):
- **Gap break:** step `p` occurs but later than `gap` after the last match → it does
  NOT advance; the user waits for a later in-gap occurrence of `steps[p]`; if none,
  their depth stays at `p`.
- **Out-of-order / extra events:** events matching a later step before `steps[p]`, or
  routes not in the funnel, are skipped and never advance the pointer.
- **Repeated routes:** a route equal to `steps[p]` advances once; a repeat of an
  already-matched earlier step does not rewind.
- **First step has no gap constraint** (`p==0` always eligible).
- A user who never matches `steps[0]` has depth 0 and is counted in no step.
- `users[0]`-equivalent is `users` for step index 1 (reached step 1); the response
  array is 1 entry per defined step, each the distinct-user count reaching that step.

This greedy definition is intentionally simple and deterministic; it is NOT a global
optimum over all possible subsequences, and the spec accepts that (documented).

## Endpoint

`POST /api/admin/analytics/navigation/funnel` — flag-gated (`cfg.FeatureNavTelemetryEnabled
&& sharedPool != nil`) on the existing `navAdmin` (`/api/admin`) group, perm
`audit.logs.view`. POST (not GET) because the payload is an ordered list.

Request body:
```json
{ "steps": ["/home","/crypto","/crypto/buy"],
  "range": "30d", "surface": "all", "gapMinutes": 30 }
```
Validation (coerce/400 as noted):
- `steps`: required, **2–10** entries, each a non-empty route string ≤ 256 chars; fewer
  than 2 or more than 10 → `400`.
- `range` ∈ {7d,30d,90d} default 30d; `surface` ∈ {all,mobile,web} default all —
  invalid values coerce to default.
- `gapMinutes`: default 30, clamp to [1, 1440].

Response (`200`), built explicitly (no `user_id`):
```json
{ "range":"30d", "surface":"all", "gapMinutes":30,
  "steps": [ { "route":"/home", "users": 500 },
             { "route":"/crypto", "users": 220 },
             { "route":"/crypto/buy", "users": 90 } ] }
```
`users[k]` is the distinct-user count reaching step k; the client derives drop-off
(`1 - users[k]/users[k-1]`).

## Query + compute

Repo method (new, in the `navigation` package):
`FunnelStepEvents(ctx, steps []string, f AnalyticsFilter) ([]StepEvent, error)` where
`StepEvent{ UserID string; Route string; OccurredAt time.Time }`:
`SELECT user_id, route, occurred_at FROM navigation_events
 WHERE route = ANY($1) AND occurred_at >= now() - $2::interval [AND surface=$3]
 ORDER BY user_id, occurred_at` — all bound params (`$1` = steps array; `range`
mapped through the same whitelist as SP5a; `surface` whitelisted).

Pure compute function (new, testable, no DB): `ComputeFunnel(events []StepEvent, steps
[]string, gap time.Duration) []int64` returning the per-step distinct-user counts per
the algorithm above (events arrive grouped by user via the ORDER BY; the function
detects user boundaries by `UserID` change and resets per user).

The handler validates the body, calls `FunnelStepEvents` + `ComputeFunnel`, and builds
the explicit JSON.

## Backend placement

Handler in `backend/internal/app/telemetry_admin.go` (beside the SP4/SP5a handlers);
route in the flag-gated `navAdmin` block (`router.go`), perm `audit.logs.view`; repo
query + `ComputeFunnel` in the `navigation` package.

## UI — funnel builder page

New `frontend-admin/app/admin/analytics/navigation/funnel/page.tsx` (under the
analytics area), using the vuexy `Page/PageHeader/Card/Button/Input` components.
- **Step builder:** an ordered list of route inputs; add / remove / **reorder**
  (move up/down) controls; a `<datalist>` of recently-seen routes (optional
  convenience, sourced from the SP5a top-screens endpoint — or just free text). A
  **Run** button, disabled until ≥ 2 non-empty steps.
- **Controls:** range (7/30/90d), surface (all/mobile/web), gap minutes (default 30).
- **Result:** a step funnel — one bar per step sized to `users[k]`, labeled with the
  count and the drop-off % from the previous step (e.g. "220 · −56%"). Inline SVG/CSS,
  **no new dependency**.
- States: loading; loaded; empty (all zero / no data → "No funnel data"); **404 →
  "Navigation telemetry not enabled"**; 403 → permission placeholder; other error →
  inline error + Retry (re-runs with the current steps/filters).

Service: `getNavigationFunnel({steps,range,surface,gapMinutes})` → POST the endpoint;
**404 → `{enabled:false}`** (not an error); other non-ok throws `AdminUsersRequestError`
(reuse `adminApiBase`/`authHeaders`/`readOrThrow`).

## Testing

**Backend (`go test`):**
- `ComputeFunnel` unit tests (NO DB) — the crux: full in-order completion; a step past
  the gap breaks the chain (depth stops); out-of-order and non-funnel events skipped;
  repeated routes don't rewind; multiple users with different depths produce correct
  distinct-user counts; first-step-no-gap; a user missing step 0 counts nowhere; an
  empty event list → all zeros.
- Repo `FunnelStepEvents` (live-DB, `TEST_DATABASE_URL`-gated, `t.Cleanup`): returns
  only step-route rows within the window, ordered by user then time, surface filter
  applied.
- Handler: body validation (2–10 steps; <2 and >10 → 400), param coercion, response
  shape, **no `user_id`**, sanitized 500.

**Frontend (Vitest):** step builder add/remove/reorder updates the ordered list; Run
POSTs the steps in order with the filters; the funnel renders a bar per step with
counts + drop-off; 404-not-enabled, 403, empty, and error+Retry states; Run disabled
with < 2 steps.

## Open items for the implementation plan

- Exact `StepEvent`/response Go types and the handler's JSON keys.
- Whether the step datalist is wired to the SP5a top-screens endpoint or left as free
  text for v1 (lean to free text + optional datalist).
- The SVG/CSS funnel-bar rendering details (scale to `users[0]`; guard all-zero).
- `range → interval` mapping reused from SP5a (factor out if duplicated).
