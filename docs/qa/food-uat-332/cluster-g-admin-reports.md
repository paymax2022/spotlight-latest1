# Cluster G — Admin Portal, Reports, Reviews & Notifications

Run: 2026-10-20, `cd mobile-app/reactnative && npx playwright test tests/e2e/food-uat/cluster-g-admin-reports.spec.ts --project=desktop-chrome --workers=1`
Spec: `mobile-app/reactnative/tests/e2e/food-uat/cluster-g-admin-reports.spec.ts` (32 tests, one per case + 0271b). Product code untouched.

Method: backend admin API driven directly (`:8080/api/restaurant/admin/*`) with the `admin@spotlight.internal` super-admin from `scripts/dev/ensure-dev-login.sh`; a throwaway non-admin user (`uat-g-fixed@example.test`) proves RBAC; reviews/orders are seeded by SQL into an isolated `UAT-G *` restaurant (removed in `afterAll`). Admin UI login IS scriptable (username `admin` + dev password, no harness blocker); UI pages visited at `http://127.0.0.1:3001/admin/restaurant/...`.
Tests titled `[GAP]` assert what the workbook expects and are EXPECTED to fail today; each failure maps to a defect below.

Reading tip: Status "Fail" = feature exists, behaviour diverges. "Fail (gap)" = workbook capability has no implementation (route/UI) — logged as a feature-gap defect per README. Evidence cites the playwright assertion or code path.

| ID | Title | Pri | Core/Cond | Scope | Status | Evidence | Defect |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RST-UAT-0253 | Submit verified post-delivery review | P1 | Core | In | Pass | Delivered own order -> 201; `restaurant_ratings` row stars/visible/order_id correct (`listing_review.go:177` gates customer+delivered) | |
| RST-UAT-0254 | Reject review before fulfilment | P0 | Core | In | Pass | pending order, someone else's order, missing order, stars=9 all >=400; row count unchanged | |
| RST-UAT-0255 | Prevent duplicate review stuffing | P1 | Core | In | Fail | UNIQUE(order_id,rater_id) holds (1 row) but the retry returns 201 with an id that is not in the DB; a changed rating is silently discarded (`ON CONFLICT DO NOTHING`, no update, no 409) | G-002 |
| RST-UAT-0256 | Moderate harmful content | P1 | Core | In | Fail (gap) | Auto-flag works ("scam" -> `flagged`) but `ModerateReview`/`ListReviews` are unrouted: POST/PATCH/GET admin review routes + public `/:id/reviews` all 404 | G-003 |
| RST-UAT-0257 | Calculate rating from eligible reviews | P1 | Core | In | Fail (minor) | 5,4,4 -> 4.3 (numeric(2,1) rounding); pending-order rating ignored; hidden review excluded -> 4.0. BUT a store with zero reviews reads 5.0 (DB default) vs the service's documented 0 = unrated | G-009 |
| RST-UAT-0258 | Notify owner of new paid order | P0 | Core | In | Blocked | Needs live paid order + push/in-app sink; code emits `EventOrderPlaced` to owner after commit (`service.go:1045`). No `notifications` table locally to assert on | |
| RST-UAT-0259 | Notify rider of assigned offer | P0 | Core | In | Blocked | `dispatch.go:126`, `delivery.go:669` notify offered rider; delivery not observable locally. Address masking for offered riders verified in 0264 | |
| RST-UAT-0260 | Notify customer of major states | P0 | Core | In | Blocked | Code notifies customer on confirmed/delivered/handoff/refund (`service.go:1290,1301`, `dispatch.go:212`, `disputes_service.go:321`); no customer notice for preparing/ready/picked_up | G-012 |
| RST-UAT-0261 | Deep links with login/role safety | P0 | Core | In | Pass | Unauthenticated `/admin/restaurant/payouts` -> `/admin/login?next=%2Fadmin%2Frestaurant%2Fpayouts`; non-admin API 403 (mobile deep-link side is Cluster H) | |
| RST-UAT-0262 | Handle notification provider outage | P0 | Core | In | Pass (partial) | `notify()` is panic-safe/best-effort, order commits first. But `finance_routes.go:1672` only wires the real notifier when `RedisURL` is set; otherwise `LogNotifier` => message lost, no outbox/retry | G-012 |
| RST-UAT-0263 | Avoid duplicate alerts on retry | P1 | Core | In | Blocked | `Notification` has no dedupe key; needs webhook replay + sink to prove | |
| RST-UAT-0264 | Mask sensitive rider-customer contact | P0 | Core | In | Pass | Stranger gets >=400 on another order's chat; offered riders see masked address (`delivery.go:797` `maskDeliveryAddress`, `maskPhone/maskEmail`) | |
| RST-UAT-0265 | Transactional alerts when marketing off | P1 | Core | In | N/A | No marketing/promotion preference in `backend/internal/restaurant` (grep marketing/opt-out = 0); all restaurant notifications are transactional | |
| RST-UAT-0266 | List and review provider applications | P0 | Core | In | Pass (API) / UI Blocked (admin login harness) | `GET /onboarding` + `?status=pending` filter, `documents` evidence present (API). UI half blocked by G-013; page "Restaurant Onboarding / KYC". Rider applications have no queue in this module (Cluster A) | |
| RST-UAT-0267 | Approval/rejection audit | P0 | Core | In | Fail | Reject without note -> 400 (good); approve flips `kyb_status`/`is_open`. No durable record of reviewer, time, old->new status or note (`audit_logs` 0 rows; `restaurant_kyb.reviewed_by` only exists if the owner submitted KYB; only a best-effort owner notification) | G-004 |
| RST-UAT-0268 | Configure fees and dispatch rules | P0 | Core | In | Fail | Per-restaurant override upsert versions (v1->v2) and global untouched, page "Delivery Fee Configuration" renders. Negative `base_fee_kobo` -> **500** (no validation, `handler.go` PutDeliveryConfig). No effective-from date, so not "future effective" | G-005 |
| RST-UAT-0269 | Pause restaurant or rider | P0 | Core | In | Fail (partial) | Restaurant: console approve opens, `PATCH availability {is_open:false}` closes, non-admin 403. Opening an unapproved store is refused (403). **No admin rider suspend/pause route** | G-010 |
| RST-UAT-0270 | Read order event history | P0 | Core | In | Fail (gap) | `GET /admin/orders/:id` and `/events` 404; no order event table (`order_events` absent); feed only lists orders | G-006 |
| RST-UAT-0271 | Control access to refunds | P0 | Core | In | Pass | Non-admin POST resolve -> 403, anonymous -> 401, non-admin list -> 403 (RBAC fail-closed, direct API). Read-only *support* role not seeded locally — only admin vs plain-user tested | |
| RST-UAT-0271b | Admin dispute queue loads | P0 | Core | In | Fail | `GET /admin/disputes` -> 500 `operator does not exist: text = uuid`: `disputes.id` is uuid, `restaurant_dispute_refunds.dispute_id` is text (`disputes_service.go:455`). The "Refunds & Disputes" page can never list tickets | G-001 |
| RST-UAT-0272 | Search by order/payment/provider ID | P1 | Core | In | Pass (API) / UI Blocked (admin login harness) | `?q=<order id prefix>` and `restaurant_id=` filters find seeded orders; feed does not search payment/settlement/provider references (q = id prefix / restaurant name / address) | G-008 |
| RST-UAT-0273 | Export scoped reports | P0 | Core | In | Fail (gap) | No export/CSV route in admin restaurant surface (4 probes 404) | G-007 |
| RST-UAT-0274 | Two-person approval for high-risk actions | P0 | Cond | In | Conditional — Deferred (gap) | `payouts/:id/process`, `withdrawals/:id/paid` and dispute resolve are single-actor; no maker-checker anywhere in `backend/internal/restaurant` | G-011 |
| RST-UAT-0275 | Review restaurant sales dashboard | P0 | Core | In | Fail | Feed totals reconcile to seeded orders (`gross_delivered_kobo`=300000, status counts correct) but is order-table derived, not ledger-derived, and `from`/`to` are ignored (2099 range returns all rows) | G-008 |
| RST-UAT-0276 | Review rider income dashboard | P0 | Core | In | Partial | `GET /earnings` is caller-scoped, no day/zone filter (`handler_delivery.go:217`); rider ledger tie-out belongs to Cluster E/F | G-008 |
| RST-UAT-0277 | Platform GMV and net revenue | P0 | Core | In | Fail (gap) | No finance/GMV/net-revenue endpoint or admin page (4 probes 404; `/admin/restaurant` shows KPI tiles for orders only) | G-007 |
| RST-UAT-0278 | Export settled transaction report | P0 | Core | In | Fail (gap) | No payouts/withdrawals/settlements export (4 probes 404) | G-007 |
| RST-UAT-0279 | Timezone-correct daily cutoff | P0 | Core | In | Fail (gap) | `EarningsStatement` (payout.go:~600) has no HTTP route and buckets by UTC (`$3::timestamptz + interval '1 day'`); no Africa/Lagos handling in admin reporting | G-008 |
| RST-UAT-0312 | Audit merchant approval decision | P0 | Core | In | Fail | After console approve, searching `audit_logs` by applicant id returns 0 events | G-004 |
| RST-UAT-0313 | Audit privileged wallet adjustment | P0 | Core | In | N/A (this cluster) | Food admin has no manual wallet adjustment (`/admin/wallet/adjust` 404); ledger immutability is covered by backend ledger suites | |
| RST-UAT-0314 | Trace order across services | P0 | Core | In | Fail (gap) | No order trace route; no shared event chain surfaced to admin | G-006 |
| RST-UAT-0315 | Record rejection without secrets | P1 | Core | In | Pass (partial) | Wrong password -> 401 without echoing it; unauthorized approve -> 403 with no token in body. Whether a masked security event is retained could not be confirmed (no restaurant audit sink) | |

Admin console UI: only the unauthenticated redirect (0261) could be driven. Login submit is blocked (G-013), so the UI half of 0266/0268/0269/0271b/0272 is **Blocked (admin login harness)**; those cases were judged from the backend API the pages call. Pages reviewed in source only: all of onboarding, delivery-fee, [id], disputes, root, unclaimed, dispatch, taxonomy, withdrawals, payouts, moderation.

## Totals
32 playwright tests (31 workbook IDs + 0271b), final run: 17 green, 15 red. Every red is an expected-defect assertion (G-001..G-011), not harness noise.
Case outcomes (31 workbook IDs): Pass 7 (0253, 0254, 0261, 0264, 0271, 0262 partial, 0315 partial) | Pass-API/UI-blocked 2 (0266, 0272) | Fail 9 (0255, 0257, 0267, 0268, 0269, 0271b, 0275, 0312, 0276 partial) | Fail (gap) 9 (0256, 0270, 0273, 0277, 0278, 0279, 0314 + 0260/0275 sub-gaps) | Blocked 4 (0258, 0259, 0260, 0263) | N/A 2 (0265, 0313) | Conditional-Deferred 1 (0274).
Defects by severity: Major 7 (G-001, G-003, G-004, G-006, G-007, G-010, G-013) | Minor 5 (G-002, G-005, G-008, G-009, G-012) | Conditional 1 (G-011).

## Defects

Severity: Major = broken/missing capability with ops or compliance impact; Minor = contained.

### FOOD-UAT-G-001 — Admin food-dispute queue always 500s (Major)
- Repro: login as admin; `GET /api/restaurant/admin/disputes?limit=5` -> `{"error":"internal server error"}`; backend log `ERROR: operator does not exist: text = uuid (SQLSTATE 42883)`.
- Cause: `AdminListFoodDisputes` joins `restaurant_dispute_refunds r ON r.dispute_id = d.id`; `disputes.id` is uuid, `dispute_id` is text. Fix: `r.dispute_id = d.id::text`.
- Impact: `/admin/restaurant/disputes` cannot list tickets, so refunds cannot be worked from the queue.

### FOOD-UAT-G-002 — Review retry returns a fabricated id and drops the update (Minor)
- Repro: rate a delivered order twice (`POST /api/finance/restaurant/orders/:id/rate`). 2nd call -> 201 with a new `id`; DB still holds the first row/stars. Same pattern as the previously fixed ratings-conflict bug.
- Expected: return the stored row (200/409) or apply a defined update rule.

### FOOD-UAT-G-003 — No route to moderate or list reviews (Major, feature gap)
- `Service.ModerateReview` and `ListReviews` (`listing_review.go`) are not registered in `finance_routes.go`. Flagged reviews can never be hidden by an admin and no public review list exists. Add admin `POST /reviews/:id/moderate` (RBAC + audit) and public list.

### FOOD-UAT-G-004 — Merchant approve/reject leaves no audit record (Major)
- Repro: `POST /api/restaurant/admin/onboarding/:id/approve` then query `audit_logs` (resource_id = restaurant id) = 0 rows; reject `note` is not persisted. Only `restaurant_kyb.reviewed_by/decided_at` when the owner filed KYB. Violates CLAUDE.md "emit an audit event". Also affects payouts/withdrawals (`payout.go:416`, `withdrawal.go:314` use the notifier sink, not `audit_logs`).

### FOOD-UAT-G-005 — Delivery-fee config accepts invalid values (500) (Minor)
- `PUT /api/restaurant/admin/delivery-config` with `base_fee_kobo:-5` -> 500. Needs server-side validation returning 4xx; also consider an effective-from date.

### FOOD-UAT-G-006 — No order event history / cross-service trace for admins (Major, feature gap)
- `GET /admin/orders/:id`, `/events`, `/trace` all 404; no `order_events` table.

### FOOD-UAT-G-007 — No exports, GMV/net-revenue dashboard (Major, feature gap)
- No CSV/export of orders, refunds, payouts, withdrawals, settlements; no finance/GMV endpoint or page (0273/0277/0278).

### FOOD-UAT-G-008 — Admin reporting lacks date range, ledger tie-out, Lagos cutoff, payment-ID search (Minor)
- `/admin/orders` ignores `from`/`to`; gross is summed from `orders.total_kobo`, not the ledger; `EarningsStatement` is unrouted and UTC-bucketed; `q` cannot find payment/settlement/provider refs.

### FOOD-UAT-G-009 — Zero-review store advertises 5.0 stars (Minor)
- `restaurants.rating` DB default is 5.0 while `recomputeRestaurantRating` documents 0 = unrated. A brand-new store shows a perfect score until its first review.

### FOOD-UAT-G-010 — No admin rider suspend/pause (Major, feature gap)
- Only `GET /admin/riders` exists. Restaurants can be force-closed; riders cannot be paused from the Food console.

### FOOD-UAT-G-011 — No two-person approval (Conditional, Deferred)
- Payout process, withdrawal paid/failed and dispute refund are single-actor with no maker-checker.

### FOOD-UAT-G-012 — Notification delivery gaps (Minor)
- Without `RedisURL` the module silently uses `LogNotifier` (messages dropped, no outbox); customer is not notified for preparing/ready/picked_up.

### FOOD-UAT-G-013 — Admin console login form never hydrates on :3001 (Major, environment/harness)
- Repro: open `http://127.0.0.1:3001/admin/login`, fill `admin` + dev password, click Sign in. The click performs a native GET submit and the page reloads to `/admin/login?`; the `<form>` carries no React props after 8s with all `_next/static` assets 200; console shows repeated `WebSocket ... /_next/hmr ... ERR_INVALID_HTTP_RESPONSE`. Backend login itself works (`POST /api/auth/login` 200). Likely the running admin dev server/HMR proxy; confirm with a fresh `npm run dev` before treating as a product bug.
- Note: the page also does a native GET submit if clicked pre-hydration, which would put typed credentials in the URL query on a slow load — consider `method="post"` on the form.

## Test-data side effects (disclosure)
While probing manually (before the spec existed) a super-admin call approved seeded restaurant `a7da21ac-...` (restored: `is_open=false, kyb_status=NULL`) and a `PATCH availability {is_open:false}` was sent to seeded restaurant `88c613ab-9dfc-49cf-a4b7-1a51f23310b2` ("Test Kitchen Update"); its prior `is_open` value was not recorded (flag for the orchestrator). A test user `uat-g-fixed@example.test` (email confirmed via local DB) is left behind for reuse.

## Phase 5 Wave 1 verify — FOOD-UAT-G-013

Verifier: V5. Zero product-code changes.

**Server state (pid 4904)**
- `ps`: `next-server (v16` (Next 16.4.0, Turbopack), started `Tue Oct 20 17:59:25 2026`; cwd `/Users/paymax/Desktop/wordpress/spotlight/new/frontend-admin` (main checkout, not this worktree).
- `curl -sI http://127.0.0.1:3001/admin/login`: `200`, `Cache-Control: no-store`. All 18 `_next/static` chunks referenced by the page return 200. Server is not stale or serving old assets.

**Before-restart trace (127.0.0.1, 1280x800 viewport; pane's default 0x0 viewport excluded)**
- `http://127.0.0.1:3001/admin/login`: `<form>` has no `__react*` props after 3s (not hydrated). Console: repeated `WebSocket connection to 'ws://127.0.0.1:3001/_next/hmr' failed`.
- Filled `admin@spotlight.internal` / dev password, clicked Sign in: the page navigated natively (JS context destroyed, no fetch/XHR) and stayed on `/admin/login`. G-013 reproduced.

**Discriminating test (same server, same pid, no restart)**
- `http://localhost:3001/admin/login`: form hydrated (`__react*` keys present).
- Same submit there: `POST http://127.0.0.1:54321/auth/v1/token?grant_type=password`, then `POST /api/admin/session`, then `/api/admin-proxy/.../menu-counts`, `/overview`. Page marker survived (SPA, no reload). Landed on `http://localhost:3001/admin`. Login works.

**Root cause**
- Next 16 dev runs `blockCrossSiteDEV(req, res, config.allowedDevOrigins, hostname)` on `/_next/*` dev traffic and the HMR websocket (`next/dist/server/lib/router-server.js`, lines ~389 and ~741). `frontend-admin/next.config.mjs` has no `allowedDevOrigins`, and the default allows `localhost` only, not `127.0.0.1`. Opened via `127.0.0.1`, the dev client/HMR channel is blocked and React never hydrates. The form then falls back to native GET submit. This is the same failure as the original `ERR_INVALID_HTTP_RESPONSE` on `/_next/hmr`.
- Not staleness: the identical running server hydrates on `localhost` and fails on `127.0.0.1`. A restart was not performed, because the host toggle already isolates the cause and pid 4904 is a shared main-checkout server.

**Verdict: ENV ONLY — not a stale dev server and not a product/runtime bug. It is a dev-host mismatch.**
- Dev-only; production builds are unaffected.
- Workaround: use `http://localhost:3001/admin`.
- Optional hardening (no change made here): add `allowedDevOrigins: ['127.0.0.1']` to `frontend-admin/next.config.mjs`.
- Optional hardening: add `method="post"` on the login form so credentials never reach the URL pre-hydration. This is a real, minor credential-in-URL leak risk that G-013's note already raised.
- Other Cluster G specs that visit `http://127.0.0.1:3001/admin/...` should switch to `localhost`.
