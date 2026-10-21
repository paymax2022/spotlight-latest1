# Cluster events-a — UAT modules 8.1–8.7 (EVT-UAT-001..098)

**Cases:** 98 · **Pass:** 40 · **Fail:** 30 · **Blocked:** 9 · **N/A:** 12 · **Needs-manual/Partial-other:** 7
(see rtm-events-a.csv for per-row verdicts)

## Module map — where events-ticketing actually lives

| Layer | Path | Notes |
|---|---|---|
| Go domain module | `backend/internal/top5events/` (~10.8k LOC) | Canonical ticketing + cashless event wallet. Mounted at `/api/finance/events` (member, auth-only) and `/api/events/admin` (RBAC `events.*`). Flag-gated: `FEATURE_EVENTS_ENABLED` + sub-flags `EDIT_LIFECYCLE`, `TICKETING_DEPTH`, `TEAM_ROLES`, `COMPS` (`internal/app/top5_routes.go:205`, `finance_routes.go:632`). |
| Legacy events pkg | `backend/internal/events/` | Intentionally UNWIRED (brownfield rule) — `finance_routes.go:1172`. |
| BFF | `frontend-web/app/api/v1/events/**` | Proxies to Go `/api/finance/events/**`, flag `featureFlags.events()`. `frontend-web/app/api/admin/events` is an in-memory stub — NOT this module. |
| Mobile | `mobile-app/reactnative/app/events/**`, `src/features/events/` | Discovery, detail, checkout, my-tickets, organiser dashboard, steward scan, event wallet, comps/promos/team. |
| Admin console | `frontend-admin/app/admin/events/**` → Go `/api/events/admin/*` | dashboard/approval/tickets/settlement/vendors/cashless/fraud. |
| Schema | `supabase/migrations/20260726000200_events.sql` + `2027103*` series | events, event_ticket_tiers, event_orders, event_tickets, event_promo_codes/redemptions, event_wallets(+ledger), event_vendors/float/charges, event_stewards, event_team_members. |
| Shared platform | auth (`services/auth_service.go`, `handlers/auth_handler.go`), `internal/otp`, sessions, onboarding (`internal/onboarding`, `onb_*` tables), RBAC | 8.1 + upgrade pipeline live here. |

## Test environment used

Local Supabase (OrbStack) at :54321/:54322 was up; no project backend was running on :8080 (that port is another project's gateway). I booted this worktree's backend at **:8463** with `FEATURE_EVENTS_*` flags on, repaired `admin@spotlight.internal` via `ensure-dev-login.sh`, created two GoTrue users (`evta-user1/2@test.local`), set `user_profiles.kyc_tier=3` and posted a balanced synthetic ledger credit (1,000,000 kobo provider_clearing→user_wallet) so the purchase path could execute for real. All findings below are from live calls against this worktree's code + the live-DB `go test` suite.

## Per-module findings

### 8.1 Customer account & identity (12) — all shared-platform paths
Register (verified-contact gate), login, generic-credential 401s, logout token revocation all **verified live**. Password reset is route-complete but `otp_email` is flag-disabled in this env (503, uniform response — enumeration-safe). OTP throttle/lockout policy exist in code; full legs need an issued OTP. Account closure has no events-aware retention policy.

### 8.2 Customer → organiser upgrade (16) — feature absent
There is **no events merchant type** in the platform onboarding pipeline (`onb_merchant_type` has health/food/marketplace only) and `CreateEvent` takes any authenticated `user_id` — verified live: a plain customer created a DRAFT event. The module models organiser as "whoever owns the event row". Every case in 8.2 fails against the spec's apply→review→approve model. **EVTA-D001 (S1, shared_platform=yes)**: needs an `events` onboarding module/merchant type + role grant, then a gate on organiser writes.

### 8.3 RBAC & tenant isolation (18) — strong on object-level authZ
Verified live: customer→admin 403, cross-organiser PATCH/submit/attendees/CSV 403, foreign ticket-token 403, organiser token on admin approve/suspend/settle 403, scoped `organiser/mine` + `my/tickets`. Steward/organiser scan authZ proven by live-DB tests. Failures: **EVTA-D002** (organiser controls `fee_bps` — contract-listed, needs contract decision), EVT-029/031 collapse into EVTA-D001 (no organiser role to deny), EVT-043/084 recorded (no dual control / no optimistic concurrency).

### 8.4 Event discovery & search (14)
Was: only `category/state/limit/offset`. **Fixed this lane:** added `q` (title+venue ILIKE, parameterised), `from`/`to` RFC3339 window, `sort=date_asc|date_desc|price_asc|price_desc` — all verified live. Sold-out flag + `min_price_kobo` work; free-tier purchase skips the debit path entirely (verified live). Gaps: no city column (venue free-text approximation via `q`), no organiser-name search (no organiser entity), no map-link UI, no refund/disclosure fields on detail.

### 8.5 Organiser profile & compliance (9) — entirely absent
No organiser profile/page/slug/payout-account/compliance entity exists. All 9 cases fail — **EVTA-D009**.

### 8.6 Event configuration & publishing (17)
Lifecycle DRAFT→SUBMITTED→APPROVED→LIVE→CLOSED + SUSPENDED/PAUSED/CANCELLED enforced server-side and verified live (golive-before-approval → 400). **Fixed this lane:** `CreateEvent` now validates title (2–200), `ends_at>starts_at`, and rejects past starts; `GoLive` refuses an already-ended event — all 400s with field errors (EVTA-D006). Edit-after-sale locks date/time/venue (live 409); no hard delete — `cancel` refunds every ticket idempotently. Gaps: golive doesn't require ≥1 active tier; no PATCH conflict control (EVTA-D011); no virtual/hybrid/unlisted/image-set model (EVTA-D012); moderation has no reject-rationale field.

### 8.7 Venues, seating & capacities (12)
GA capacity is enforced atomically per tier (live: cap=1 admits exactly one purchase). **But there is no aggregate venue capacity** — tiers can over-allocate with no ceiling: **EVTA-D008**, pending SQL filed under `migrations-events-a/`. All seat-map cases are N/A — no seat model exists (EVTA-D010). Venue is free-text only (no geo/tz) — EVT-097 partial, EVT-098 passes via the post-sale hard lock.

## Cross-cutting defects found while mapping (outside 8.1–8.7 case coverage)

- **EVTA-D003 (S1, fixed):** `purchaseTickets` sent `promo_code`/`quantity` (both dropped server-side) and unwrapped a single `Ticket` as `PurchaseResult` — `res.tickets.length` would crash the success screen; promos never applied. Now loops N idempotent purchases and reports real tickets/total.
- **EVTA-D004 (S2, fixed):** `giftTicket` sent `cashtag`; contract requires `recipient` — every gift 400'd. Verified the corrected field works live (ticket TRANSFERRED, new credential minted).
- **EVTA-D005 (S2, fixed):** `GetEvent` omitted `tiers`; mobile detail screen dereferences `e.tiers.filter` — would TypeError in live mode. `GET /events/:id` now returns `tiers[]`.
- Scan returned `not_yet_valid` on a fresh token — investigated, **not a defect**: credential `valid_from` = event start; gate correctly refuses early entry.

## Defect summary

| ID | Sev | Status | Cases |
|---|---|---|---|
| EVTA-D001 | S1 | recorded, shared_platform | 8.2 all + 029/031/042/079 |
| EVTA-D002 | S2 | recorded, shared_platform (contract) | 037 |
| EVTA-D003 | S1 | **fixed** | checkout (impacts 8.9 promo cases) |
| EVTA-D004 | S2 | **fixed** | gift (impacts 8.10 transfer cases) |
| EVTA-D005 | S2 | **fixed** | 053/054/077 |
| EVTA-D006 | S3 | **fixed** | 073/074/075 |
| EVTA-D007 | S2 | **fixed** | 048/049/050 |
| EVTA-D008 | S2 | recorded (+pending SQL) | 087/088 |
| EVTA-D009 | S2 | recorded, shared_platform | 8.5 all |
| EVTA-D010 | S2 | recorded | 059, 089–097 |
| EVTA-D011 | S3 | recorded | 043/084 |
| EVTA-D012 | S3 | recorded | 071/072/085/086 |

## Files changed (uat/events-a)

- `backend/internal/top5events/model.go` — `Event.Tiers`, `EventListFilter{Q,From,To,Sort}`
- `backend/internal/top5events/service.go` — `validateEventInput`, `GoLive` ended-event guard, `GetEvent` attaches tiers, `ListEvents` q/from/to/sort
- `backend/internal/top5events/handler.go` — parse q/from/to/sort
- `backend/internal/top5events/discovery_validation_live_db_test.go` — 4 new live-DB tests (all PASS)
- `mobile-app/reactnative/src/features/events/api.ts` — purchase field/shape fix, gift `recipient` fix
- `docs/qa/events-uat-299/{cluster-events-a.md,rtm-events-a.csv,defects-events-a.csv,exec-events-a.csv}` + `migrations-events-a/*.pending.sql`

## Blockers / notes for orchestrator

- No second device / OTP gateway legs: 8.1 OTP and multi-device cases stay BLOCKED (platform lane).
- `frontend-web/app/api/admin/events` is an in-memory stub unrelated to this module — left untouched.
- events-b/events-c lanes share `top5events/`; my diffs touch `model.go`, `service.go`, `handler.go` — all additive.
- Shared dev DB contains other lanes' fixtures (e.g. UAT-C events) — assertions were written to tolerate them.
