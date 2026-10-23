# W10-VERIFICATION — Module 12 Food sign-off evidence (Wave 10)

Date: 2026-10-21. Author: W10-VERIFY. Product code changed: none. Test files changed: none.

Tested commits: Gap 1 full run at `cc2341ad0` (origin/main). Gap 2 matrix at `c198fe33f` (branch HEAD, adds the hours routes), with
the identical 35 pre-hours rows also re-verified at `cc2341ad0`. Gap 3 at `cc2341ad0` web bundle. All work ran in throwaway detached
worktrees under `/private/tmp`, because the shared branch worktree had other agents' uncommitted edits in flight
(a mid-edit `s.IsOpenNow undefined` build break was observed in it); verifying there would have measured their half-finished edits.

## Headline (read this first)

| Gap | Verdict |
|---|---|
| 1. `go test -race` full suite | Verdict: PASS-WITH-KNOWN-RESIDUAL (260 ok / 1 FAIL = the known ledger residual, unchanged; no new regression) |
| 2. Admin RBAC curl matrix | Verdict: PASS on RBAC (41/41 routes: 401 / 403 / gate-passed) **but only after a 2-line local patch, because the shipped backend cannot boot (see B1)** |
| 3. Metro live-UI drive | Verdict: PARTIAL. ModifierSheet driven live: PASS. Pickup / scheduled / dine-in intake: NOT drivable (UI not wired, see B3) and quote rejects it (see B2) |

### New findings that bear on the sign-off decision

**B1 — BLOCKER: the Go server panics at startup when `FEATURE_RESTAURANT_ENABLED=true`.**
`backend/internal/app/finance_routes.go:2007` (line 2005 at `cc2341ad0`) registers
`restAdmin.POST("/orders/:orderId/unlock-codes", ...)` while the same group already has `/orders/:id/assign`, `/orders/:id/dispatch`,
`/orders/:id/trace`. Gin forbids two different wildcard names at one path position:

```
panic: ':orderId' in new path '/api/restaurant/admin/orders/:orderId/unlock-codes' conflicts with existing
wildcard ':id' in existing prefix '/api/restaurant/admin/orders/:id'
  finance_routes.go:2005  <- app.NewRouterWithContext  router.go:550  <- main.go:47
```

Introduced by FOOD-UAT-E-008 in #849 (`f0fbc5f87`). Present in `cc2341ad0` and `c198fe33f`. The process exits before binding a port,
so every module (not just Food) is down on any environment deployed from main with the restaurant flag on. Why nothing caught it:
`go test ./...` has no test that builds the full router with the restaurant block enabled, and the dev container on `:8080`
(image built 2026-10-18, pre-Phase-5) answers 404 on every Phase-5 admin route, so it looked healthy.
Fix (not applied, out of scope): rename the route to `/orders/:id/unlock-codes` and read `c.Param("id")` in
`AdminUnlockOrderCodes` (`delivery.go:1360`). That is exactly the patch I applied in my throwaway tree to get a bootable server.
**Module 12 should not be signed off until this is fixed on main and a boot smoke test is added to CI.**

**B2 — `POST /api/finance/restaurant/orders/quote` ignores `order_type`.** `previewCartRequest.toPlaceOrder()`
(`handler_promo.go:39`) does not copy `OrderType`/`TableNumber`, so a pickup or dine-in quote is priced as delivery and returns
`400 restaurant: delivery latitude and longitude are required`. Reproduced with `pickup_scheduled`, `dine_in` and a bogus type
(all 400 with the same coordinates message). `PlaceOrder` itself is correct (handler.go skips the pin check for non-delivery).

**B3 — The mobile checkout has no way to choose Pickup, Scheduled pickup or Dine-in.** `app/food/checkout.tsx` only offers a
delivery address; `grep orderType|pickup|dine_in` in it returns nothing. `PickupSchedulePicker` is exported from
`src/features/food/components/index.ts` but imported by no screen. `api.ts:313` can send `order_type`, but nothing sets it, so the
app always places delivery orders.

Lesser: unlock-codes returns 200 for a non-existent order id (idempotent no-op, no 404); the Gap 3 spec file still has a test named
"no modifier/note/promo UI" that passes while the modifier UI now exists (stale assertion title/intent).

---

## Gap 1 — go test -race full suite

Command (no `make test-fresh` target exists; this is the Makefile `test` recipe with the live-DB env set explicitly):

```
cd backend && RAILS_MODE=fake TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
  DATABASE_URL=<same> go test ./... -race -p 1 -count=1 -timeout 60m
```

`-p 1` per the Makefile comment (live-DB suites share one Postgres). Wall time about 2h on a loaded machine. Raw log kept at
`/private/tmp/claude-501/w10/full-race.log` (not committed). Run SHA `cc2341ad0`.

| Result | Count |
|---|---|
| Packages total | 306 |
| `ok` | 258 (260 after the two re-runs below) |
| `no test files` | 45 |
| `FAIL` (first pass) | 3 |
| `FAIL` (after triage) | 1 (known residual) |

Food-relevant packages, all `ok`: `internal/restaurant` (210 s), `internal/restaurant/paystackcheckout`, `internal/restaurant/taxonomy`,
`tests/restaurantpayout`. Re-run at branch HEAD `c198fe33f` (adds hours + `food_uat_w10_live_db_test.go`; with the 2-line B1 patch applied
so the app package compiles the same router): `internal/restaurant` (186 s), `paystackcheckout`, `taxonomy`, `internal/app`,
`tests/restaurantpayout` all `ok` under `-race`.

The three first-pass failures:

1. `tests/ledger` `TestLiveDB_LedgerGlobalConservation` — `global ledger residual = -192797418 kobo over 80515 entries`.
   Identical to the known pre-existing residual (-192,797,418). Unchanged, so not a regression. It is not food-originated; it is a
   standing local-DB condition. Verdict: KNOWN, UNCHANGED.
2. `internal/health/lab` `TestLiveDB_CreateOrder_PostHoldFailureRefundsUnboundHold` and
3. `internal/health/vet` `TestLiveDB_Book_PostHoldFailureUnwindsSlotAndHold` — both: `create inject trigger: trigger
   "trg_lab_fail_order_insert" / "trg_vet_fail_pay" already exists (SQLSTATE 42710)`. Stale failure-injection triggers left on the shared
   dev DB by an earlier interrupted run (the DB is not "fresh"). I dropped those two triggers (test debris only) and re-ran both
   packages: `ok` (16 s, 11 s). Verdict: ENVIRONMENTAL, NOT A REGRESSION.

Not seen: any `signal: terminated` (the `-p 1` run avoids the shared-DB parallel kill). No data race reported in any package.
Caveat for the sign-off reader: this DB was not reset (`make migrate-reset` was not run, to avoid wiping other sessions' fixtures on the
shared local Supabase), so "fresh DB" is not literally satisfied. Verdict: PASS-WITH-KNOWN-RESIDUAL.

---

## Gap 2 — admin RBAC curl matrix

Setup. The dev backend on `:8080` is a Docker image from 2026-10-18; probing it returned 404 on `refund-tiers`, `consents`, `permits`,
`commission`, `reports/gmv`, `orders/:id/trace` (pre-Phase-5, not testable). Per repo guidance (do not hot-patch shared processes) I built
`cmd/server` from a detached worktree and ran it on `:8181` against the local DB with only local credentials (no live provider keys).
Building the unmodified tree fails at boot with B1, so the throwaway tree carries the 2-line B1 rename; nothing else differs from the branch.

Accounts (local Supabase only): `ensure-dev-login.sh` reported that neither documented fixture exists in this DB, so I created
`w10-admin@spotlight.internal` with `scripts/dev/create-admin.sh` (super-admin) and `w10-customer@spotlight.internal` via GoTrue signup
(no roles). Password is the documented `DEV_LOGIN_PASSWORD` value. JWTs from the GoTrue password grant.

Method per route: no header, customer JWT, admin JWT. Mutating routes sent `{}` bodies and an all-zero-ish dummy UUID so nothing real
is mutated; for those the admin cell is a handler-level 400/404/422, which proves the request cleared auth + RBAC and was rejected
by validation, not by the gate. A 401/403 in the admin column would be a fail. Pass rule: no-auth 401, customer 403, admin not 401/403/5xx.

| Route | Permission | No-auth | Customer-JWT | Admin-JWT | Expected | Verdict |
|---|---|---|---|---|---|---|
| `GET /api/restaurant/admin/refund-tiers` | `restaurant.admin.disputes` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `PUT /api/restaurant/admin/refund-tiers` | `restaurant.refund.large` | 401 | 403 | 422 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `GET /api/restaurant/admin/consents` | `restaurant.admin.onboarding` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `GET /api/restaurant/admin/permits` | `restaurant.admin.onboarding` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `PUT /api/restaurant/admin/restaurants/:id/permit` | `restaurant.admin.onboarding` | 401 | 403 | 400 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/permits/backfill-null` | `restaurant.admin.onboarding` | 401 | 403 | 400 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `GET /api/restaurant/admin/commission` | `restaurant.admin.commission` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `PUT /api/restaurant/admin/commission` | `restaurant.admin.commission` | 401 | 403 | 400 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `DELETE /api/restaurant/admin/commission/:id` | `restaurant.admin.commission` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/payouts/:id/endorse` | `restaurant.admin.payout_approve` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/payouts/:id/approve` | `restaurant.admin.payout_approve` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `GET /api/restaurant/admin/payouts/:id/approvals` | `restaurant.admin.payouts` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `GET /api/restaurant/admin/:id/zones` | `restaurant.admin.onboarding` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `POST /api/restaurant/admin/:id/zones` | `restaurant.admin.onboarding` | 401 | 403 | 400 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `DELETE /api/restaurant/admin/:id/zones/:id2` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `GET /api/restaurant/admin/menu-items/:id/modifier-groups` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/menu-items/:id/modifier-groups` | `restaurant.admin.onboarding` | 401 | 403 | 400 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `PATCH /api/restaurant/admin/modifier-groups/:id` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `DELETE /api/restaurant/admin/modifier-groups/:id` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/modifier-groups/:id/options` | `restaurant.admin.onboarding` | 401 | 403 | 400 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `PATCH /api/restaurant/admin/modifier-groups/:id/options/:id2` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `DELETE /api/restaurant/admin/modifier-groups/:id/options/:id2` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `GET /api/restaurant/admin/orders/:id/trace` | `restaurant.admin.trace` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/orders/:id/unlock-codes` | `restaurant.admin.unlock_order_code` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `GET /api/restaurant/admin/reports/gmv` | `restaurant.admin.reports` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `GET /api/restaurant/admin/reports/net-revenue` | `restaurant.admin.reports` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `GET /api/restaurant/admin/reports/cohorts` | `restaurant.admin.reports` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `GET /api/restaurant/admin/reports/export` | `restaurant.admin.reports` | 401 | 403 | 400 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `GET /api/restaurant/admin/reviews` | `restaurant.admin.reviews` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `POST /api/restaurant/admin/reviews/:id/hide` | `restaurant.admin.reviews` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/reviews/:id/restore` | `restaurant.admin.reviews` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/reviews/:id/flag` | `restaurant.admin.reviews` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `GET /api/restaurant/admin/listings/pending` | `restaurant.admin.onboarding` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `POST /api/restaurant/admin/listings/:id/decision` | `restaurant.admin.onboarding` | 401 | 403 | 400 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `GET /api/restaurant/admin/restaurants/unclaimed` | `restaurant.admin.onboarding` | 401 | 403 | 200 | 401 / 403 / 2xx | Verdict: PASS |
| `GET /api/restaurant/admin/:id/hours` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `PUT /api/restaurant/admin/:id/hours` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/:id/hours/closures` | `restaurant.admin.onboarding` | 401 | 403 | 400 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `DELETE /api/restaurant/admin/:id/hours/closures/2030-01-01` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `POST /api/restaurant/admin/:id/hours/pause` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |
| `DELETE /api/restaurant/admin/:id/hours/pause` | `restaurant.admin.onboarding` | 401 | 403 | 404 | 401 / 403 / gate passed (handler 4xx on dummy id/empty body) | Verdict: PASS |

Coverage map to the requested files: commission (3), refund tiers (2), payout endorse/approve (+approvals), permit PUT + backfill,
consents, zones (3), modifier groups + options CRUD (7), order trace, reports gmv/net-revenue/cohorts/export, permits list,
listing review + moderation (reviews, listings pending/decision, unclaimed), unlock-codes, and W10-BUILD hours (6 admin routes).
Not probed: owner-facing hours routes (`/api/finance/restaurant/:id/hours*`) are ownership-gated, not RBAC-gated, so they are
outside this matrix. The task named `handler_admin_hours.go`; it did not exist at `cc2341ad0` and was probed at `c198fe33f` only.

Totals: 41 routes x 3 cases = 123 probes. 41 PASS, 0 FAIL. Overall Verdict: PASS (RBAC), contingent on B1.

---

## Gap 3 — Metro live-UI drive

The previously reported blocker (live cloud Supabase rejecting the harness' seeded fake session) did not reproduce against the
local stack: a real GoTrue password login works end to end. I ran Metro from a clean worktree on `:8184` (not the shared `:8083`, which
serves a different branch from the main checkout) with `EXPO_PUBLIC_FOOD_USE_MOCK=false`, `EXPO_PUBLIC_RESTAURANT_USE_MOCK=false`,
`EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:8181` (the Gap 2 backend), local Supabase URL/anon key. A symlinked `node_modules` breaks
Metro (bundle path resolves outside the root, 404), so a clonefile copy was used. Screenshots are kept at
`/private/tmp/claude-501/w10/shots/` (not committed).

Seed: the only restaurants with menu items had no modifier groups. Using the Gap 2 admin routes (which doubles as a live check of
them) I created group "Spice level" (required, pick 1) with options Mild (+0) and Hot (+50000 kobo) on item "Jollof" of
`1d40a0ce-...` ("RUAT-F Kitchen", APPROVED, open), plus a "Mains" category; the item-to-category link had to be set with one SQL
`UPDATE` because the admin PATCH body ignored `category_id` (returned `category_id: ""`).

Drive (Playwright script, ad hoc, not added to the repo):

1. Real login as `w10-customer@spotlight.internal` via the login form: POST `/api/auth/login` ok, lands on `/home`. Verdict: PASS.
2. `/food` hub renders live data (`GET /api/finance/restaurant`, restaurants listed, cart `GET /api/v1/food/cart`). Verdict: PASS.
3. Open the restaurant; menu shows Mains / Jollof / N4,500.00 with `modifier_groups` embedded in `GET /api/finance/restaurant/:id`
   (confirmed by curl). Verdict: PASS.
4. Add pack, tap "Add Jollof": **ModifierSheet opens against live data**: "Spice level, Required, Pick 1, Mild, Hot +N500.00,
   Add to cart N4,500.00". Select Hot, Add to cart: cart line "Jollof (Hot)", total N5,000.00 (base + live delta). Verdict: PASS.
5. View cart opens `/food/checkout` with the modifier line and N5,000.00. Checkout shows only "Delivery address", promo, summary,
   "Pay & place order". There is no Delivery / Pickup / Dine-in control and no scheduled-slot picker. Verdict: FAIL (B3, UI not wired).
6. Because the UI cannot select it, the pickup path was exercised at the API with the same customer JWT (`POST
   /api/finance/restaurant/:id/orders`, `order_type=pickup_scheduled`, `scheduled_for` +3h, Hot modifier id):
   - body without `modifier_ids`: `400 invalid modifier selection: group "Spice level" requires at least 1 selection(s)` (live
     modifier enforcement). Verdict: PASS.
   - with `modifier_ids`: `403 order escrow tier gate: wallet disabled for tier 0 — complete KYC`. The backend parsed
     `pickup_scheduled`, passed order-type and slot validation, and stopped at the money gate. Verdict: PASS (fail-closed).
   - `dine_in` with `scheduled_for`: `400 scheduled_for is only valid for pickup_scheduled`. Verdict: PASS.
   - `bogus_type`: `400 unknown order_type`. Verdict: PASS.
   - `POST /orders/quote` with any order type: `400 delivery latitude and longitude are required`. Verdict: FAIL (B2).
7. A persisted `order_type=pickup_scheduled` order row was NOT obtained. The test customer is Tier 0 with an empty wallet and I
   did not fabricate ledger funds or a KYC tier (money iron rules). To close this, run it with a funded Tier 1+ fixture.
   Verdict: NOT CLOSED (needs a funded KYC'd account).

Existing harness, run as instructed (`E2E_BASE_URL=http://127.0.0.1:8184 FOOD_LIVE=1 ... cluster-c-discovery-cart.spec.ts -g live
--project=desktop-chrome`): `FOOD_LIVE` is not read by any spec; the `LIVE UI` describe (4 tests: hub, search/filter, add/remove/restore,
empty checkout) passed 4/4 twice. One run of the whole file showed 33 passed, 1 failed (`RST-UAT-0104L`, hub render, ~19 s, timing
under load) and 1 skipped (rider-pair test, by design); the same test passed on both isolated reruns. Verdict: PASS, one flake noted.
Those specs do not open a modifier sheet or pickup flow, hence the manual drive above.

Overall Gap 3 Verdict: PARTIAL. Modifier sheet live: closed. Pickup / scheduled / dine-in intake: cannot be closed from the UI until B3 is fixed;
API path validated up to the tier gate; quote path broken (B2).

---

## Local state left behind (shared dev DB, all additive)

- Auth users `w10-admin@spotlight.internal` (super-admin) and `w10-customer@spotlight.internal` (email confirmed by SQL).
- Seed on restaurant `1d40a0ce-8785-49dc-9b57-8de0bff61416`: category "Mains", item "Jollof" linked to it, modifier group "Spice level" with 2 options.
- Two stale test triggers dropped (`trg_lab_fail_order_insert`, `trg_vet_fail_pay`).
- Throwaway servers (`:8181`, `:8184`) and worktrees were stopped and removed. The `:8080` container and `:8083` Metro were not touched.
