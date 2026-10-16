# Navigation Analytics Dashboard (SP5a) design

**Date:** 2026-10-15
**Status:** Design (pre-implementation)
**Branch:** `feat/nav-telemetry-analytics`

## Purpose

Give admins an aggregate view of navigation telemetry: which screens users visit
most, how usage trends over time, and the mobile/web split. This is the
product-analytics surface of the navigation-telemetry program (SP1 ingest/storage
#762, SP2 mobile #767, SP3 web #771, SP4 per-user panel #774 are merged).

Scope is **SP5a** — the three straightforward aggregate metrics + filters. **Funnels /
path sequences are explicitly deferred to SP5b** (a separate spec): they require
session-stitching and step-transition analysis, a materially different compute model.

## Scope

- **In (SP5a):** one aggregate read endpoint + a dashboard page with **top screens by
  views**, **views over time (daily)**, **per-surface split**, and the filters
  **time range (7/30/90d)**, **surface (all/mobile/web)**, **route search**.
- **Out (SP5b, later):** funnels / ordered path sequences / step drop-off.
- Aggregation is **on-the-fly parameterized SQL** — the table is capped at 90 days
  (SP1 retention) and this is a low-QPS admin dashboard, so materialized views /
  refresh infra are premature (YAGNI).
- **No new charting dependency** — frontend-admin has none; render with inline SVG +
  tables + the console's existing card/Button components.

## Endpoint

`GET /api/admin/analytics/navigation` — on the flag-gated `/api/admin` group
(mirrors SP4's placement: its own `/api/admin` group with `RequireAuthContext` then
`RequirePermission("audit.logs.view")`, registered only when
`cfg.FeatureNavTelemetryEnabled && sharedPool != nil`, so it is **404 when the flag
is off**).

Query params (all optional, validated server-side):
- `range` ∈ {`7d`,`30d`,`90d`}, default `30d` (anything else → 400 or coerce to
  default; pick coerce-to-default and document it).
- `surface` ∈ {`all`,`mobile`,`web`}, default `all`.
- `search` — a route substring (optional).

Response (`200`), built explicitly (never serialize the `Event` struct; no `user_id`):
```json
{
  "range": "30d",
  "surface": "all",
  "topScreens":   [ { "route": "/crypto/assets", "views": 1203, "users": 88 } ],
  "timeseries":   [ { "day": "2026-10-01", "mobile": 40, "web": 12, "total": 52 } ],
  "surfaceSplit": { "mobile": 900, "web": 303, "total": 1203 }
}
```

## Aggregation SQL (parameterized; over `navigation_events`)

Common window predicate: `occurred_at >= now() - $range::interval` (map `7d`→`'7 days'`
etc.). `surface` filter adds `AND surface = $surface` when not `all`. All values are
bound parameters — no string interpolation.

- **topScreens** (surface + search apply here):
  `SELECT route, COUNT(*) AS views, COUNT(DISTINCT user_id) AS users
   FROM navigation_events WHERE <window> [AND surface=$s] [AND route ILIKE $q]
   GROUP BY route ORDER BY views DESC, route ASC LIMIT 50`
  (`$q` = `'%'||search||'%'` as a bound param; a `route ASC` tie-break keeps ordering
  deterministic.)
- **timeseries** (surface applies; search does NOT):
  `SELECT date_trunc('day', occurred_at) AS day, surface, COUNT(*) AS n
   FROM navigation_events WHERE <window> [AND surface=$s]
   GROUP BY day, surface ORDER BY day` — pivot in Go to `{day,mobile,web,total}`
  per day (days with no rows are simply absent; the client renders gaps as zero).
- **surfaceSplit** (window only — the surface filter does NOT collapse it; it *is* the
  split):
  `SELECT surface, COUNT(*) FROM navigation_events WHERE <window> GROUP BY surface`
  → `{mobile, web, total}`.

New repo method on the `navigation` package:
`AggregateNavigation(ctx, f AnalyticsFilter) (*NavAnalytics, error)` where
`AnalyticsFilter{ Range string; Surface string; Search string }` and `NavAnalytics`
holds the three result blocks. Runs the three queries (own small structs).

## Backend placement

Handler in `backend/internal/app/telemetry_admin.go` (alongside SP4's handler); route
registered in the same flag-gated `/api/admin` block SP4 used, perm
`audit.logs.view`. Build the repo with `navigation.NewRepository(sharedPool)`.

## Dashboard page

New `frontend-admin/app/admin/analytics/navigation/page.tsx` (under the existing
`/admin/analytics` area). A client page with:
- **Controls:** range selector (7/30/90d), surface toggle (all/mobile/web), a
  debounced route-search input.
- **Widgets:**
  - **Top screens** — a table (route · views · distinct users), from `topScreens`.
  - **Views over time** — a lightweight **inline SVG** line/area (no dependency),
    from `timeseries` (total, with mobile/web optionally overlaid); x = day, y = count.
  - **Surface split** — stat cards (mobile / web / total) and/or a simple inline bar,
    from `surfaceSplit`.
- A filter change refetches the single endpoint and re-renders all three widgets.
- States (whole page): loading; loaded; empty (no events → "No navigation data yet");
  **404 → "Navigation telemetry not enabled"**; 403 → permission placeholder; other
  error → inline error + Retry. Match the console's existing Tailwind/card/Button
  conventions and the `/admin/analytics` page style.

Service: `getNavigationAnalytics({range,surface,search})` → the endpoint; **404 →
`{enabled:false}`** (not an error), other non-ok throws `AdminUsersRequestError`
(reuse `adminApiBase`/`readOrThrow` conventions).

Route guard: `/admin/analytics` is already under the admin route guard; no new client
flag.

## Testing

**Backend (`go test`):** repo `AggregateNavigation` (live-DB, `TEST_DATABASE_URL`-gated,
`t.Cleanup`): top-screens ordering + `views`/distinct-`users` counts; the `search`
filter narrows top-screens but not timeseries; the `surface` filter scopes
top-screens/timeseries but surfaceSplit still returns both; timeseries buckets by day;
the window excludes rows older than `range`. Handler: param defaults/validation
(`range`/`surface`), payload shape, **no `user_id` in the response**, sanitized 500.

**Frontend (Vitest):** the page renders the three widgets from mocked analytics data
(table rows, an SVG with the right number of points, the split cards); changing a
filter triggers a refetch with the new query; empty, 404-not-enabled, 403, and
error+Retry states.

## Open items for the implementation plan

- Exact `range → interval` mapping + whether an invalid `range` coerces to `30d` or
  400s (spec says coerce; confirm in plan).
- The SVG line/area rendering approach (viewBox scaling, axis labels) — keep minimal.
- Match the precise card/Button/table components the existing `/admin/analytics`
  page uses.
