# Cluster D — Checkout, Payment/Webhook/Recovery, Restaurant Order Lifecycle, Kitchen Execution

UAT source lines 2057–2480 → **34 cases** (RST-UAT-0135 … 0168; the README's "~55" was an estimate). Modules: Checkout and Creation (8), Payment/Webhook/Recovery (11), Restaurant Order Lifecycle (9), Kitchen Execution (6).

Spec: `mobile-app/reactnative/tests/e2e/food-uat/cluster-d-checkout-payment.spec.ts` — **36 Playwright tests, 36 green** (2 UI + 34 backend). Green means "the observed behaviour matches the assertion written", and several assertions deliberately **pin a defect** (e.g. 0157, 0160, 0163, 0166) — the Status column below is the verdict, not the Playwright colour.

## Outcome

| Pass | Fail | Deferred (flag OFF) | Blocked | N/A | Total |
| --- | --- | --- | --- | --- | --- |
| 18 | 7 | 5 | 1 | 3 | 34 |

Defects: **3 Blocker** (D-001, D-002, D-005), **3 Major** (D-003, D-004, D-006), **2 Minor/Major gaps** (D-007 pickup mode N/A, D-008 ETA revision). Money-path divergences are Blocker per the cluster rule.

## Environment findings that shaped the evidence

1. **The long-lived Metro on `:8083` is not a local-stack server.** Its `.env` points `EXPO_PUBLIC_API_BASE_URL` at `frontend-web-staging-ec46.up.railway.app`, `EXPO_PUBLIC_SUPABASE_URL` at the cloud project and `EXPO_PUBLIC_FOOD_USE_MOCK=false`. Driving it with the harness's fake session would send test traffic to cloud staging, so it was **not used**. A throwaway mock-mode Metro was started on `:8093` from the main checkout (env overrides: local Supabase, `FOOD_USE_MOCK=true`) and stopped afterwards.
2. **Seeded-session UI harness bounces to `/login`** (AuthGate rejects the fake session) — the pre-existing `tests/e2e/modules/food.spec.ts` fails identically, so this is environmental, not a Cluster D regression. UI cases therefore fall back to source assertions on `app/food/checkout.tsx` when the bounce occurs and record a `blocked` annotation.
3. **Local data:** 0 KYB-approved restaurants, 0 rows in `orders`, `qa-claude-test` wallet balance 0 kobo, `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` OFF (card routes `…/orders/paystack/initiate|status` return the router's 404 — unmounted, by design when flag-gated). A live place-order → pay → lifecycle run cannot be seeded without hand-crediting a wallet (forbidden by the ledger rules), so live end-to-end money cases are proven with the existing Go live-DB suites (run against `:54322` by the spec itself via `go test`) plus HTTP-level negatives against `:8080`.
4. 13 `restaurant_order_paystack_intents` rows sit in `processing` with no order. All have `foodorder-repo-claim-*` references = residue of `TestLiveDB_ClaimForProcessing_*`; **not** a production signal (but see D-005 for the real gap).
5. `GET /api/webhooks/paystack` is the Next route (`frontend-web`, not running on :3000 here); the Go receiver is `POST /api/webhooks/paystack/go`. The spec targets the Go receiver.

## Prior sign-off invariants (positive coverage)

| Invariant | Covered by | Result |
| --- | --- | --- |
| **FOOD-009** payout batch must not double-pay settled orders | RST-UAT-0146 → `TestLiveDB_PayoutRunExcludesSettlementAlreadyPaidDirectlyAtDelivery` | Holds |
| **ADR-041** card tops up wallet then spends (single capture) | RST-UAT-0151 (restaurant card rail is *external-funded escrow*, not wallet top-up; idempotent reference + claim proven). Wallet top-up webhook leg keys `paystack:topup:<ref>` | Holds for the restaurant rail; wallet-topup leg out of this cluster's code path |
| **FOOD-003/010** only KYB-approved restaurants take paid orders | RST-UAT-0154 → `TestLiveDB_SetAvailability_RequiresApprovedKYBToOpen`; local DB has 0 approved restaurants so nothing can open | Holds |

## Results

| ID | Title | Pri | Core/Cond | Scope | Status | Evidence | Defect |
| --- | --- | --- | --- | --- | --- | --- | --- |
| RST-UAT-0135 | Create delivery order end-to-end | P0 | Core | In Scope | **Pass (partial)** | Unauthenticated POST `…/:id/orders` → 401; `TestPlaceOrderRequest_HasNoClientSettableExternalSwitch` (server-side totals, no client switch). Full E2E to awaiting-payment Blocked by data (see env #3) | — |
| RST-UAT-0136 | Create pickup order | P0 | Core | **N/A** | N/A | `PlaceOrderRequest` (`backend/internal/restaurant/model.go`) has `delivery_address` `binding:"required"` and no fulfilment-mode field; `checkout.tsx` disables CTA without an address and has no pickup branch. Live: body without address → 400. (Pickup journey is also covered by Cluster E.) | D-007 (gap) |
| RST-UAT-0137 | Block empty cart checkout | P0 | Core | In Scope | **Pass** | UI: "Your cart is empty", zero POSTs to `/orders`; API: `items:[]` → 400, no `orders` row for customer | — |
| RST-UAT-0138 | Require selected delivery address | P0 | Core | In Scope | **Pass** | CTA `disabled={!address.trim()…}` + `onPlace` early return; API missing address → 400, no row | — |
| RST-UAT-0139 | Honor item notes and options in order snapshot | P0 | Core | In Scope | **Fail** | Backend snapshots modifiers + sanitised note (`TestLiveDB_OrderModifiersPricedAndSnapshotted`, `…SelectionIsValidated` pass). The RN client never sends `special_instructions` or modifiers (no hit in `app/food`, `src/features/food`); `placeOrder` payload in `api.ts` has neither | D-004 |
| RST-UAT-0140 | Prevent duplicate order on repeated tap | P0 | Core | In Scope | **Pass** | Missing `Idempotency-Key` → 400 "idempotency"; `TestLiveDB_OrderRequiresIdempotencyKey`, `…IdempotencyKeyIsCustomerScoped`, `…PromoIdempotentReplay`, `TestLiveDB_PutIntent_IdempotentOnKey`, `TestInitiateCheckout_ReplayReusesFrozenAmount`; UI guard `placeOrder.isPending` + fresh key per attempt | — |
| RST-UAT-0141 | Reject changed stock or operating hours | P0 | Core | In Scope | **Pass (partial)** | Unknown/closed store → 4xx, no order; stale-quote card path refunds (`…AmountMismatchRefundsAndMarks`, `…PlacementFailureRefundsAndMarksOrderFailed`). Live "store closes mid-checkout" not seedable | — |
| RST-UAT-0142 | Handle abandoned checkout | P0 | Core | In Scope | **Pass (partial)** | Pending intent places nothing until verified (`TestCheckStatus_PendingWhenNotYetPaid`, `…NotSuccessfulMovesNothing`); wallet rail has no unpaid state. Intent TTL/reaper absent → D-005 | D-005 |
| RST-UAT-0143 | Process successful online payment | P0 | Core | Conditional-Deferred | **Deferred** | Card rail flag OFF locally (initiate/status routes unmounted → 404). `TestOnChargeSuccess_PlacesOrderAndConfirms` green | — |
| RST-UAT-0144 | Show declined payment without order release | P0 | Core | Conditional-Deferred | **Deferred** | `TestOnChargeSuccess_NotSuccessfulMovesNothing` | — |
| RST-UAT-0145 | Recover gateway timeout with later success | P0 | Core | Conditional-Deferred | **Deferred** | `TestCheckStatus_SelfHealsPendingIntent`, `…VerifyTransientErrorStaysPending` | D-005 (processing strand) |
| RST-UAT-0146 | Ignore duplicate success webhook | P0 | Core | In Scope | **Pass** | Signed `charge.success` ×3 → 200 ×3, identical body, 0 intents/orders created; `TestOnChargeSuccess_ConcurrentDeliveriesActOnce`, `TestLiveDB_ClaimForProcessing_AtomicUnderConcurrency`; **FOOD-009** payout test green | — |
| RST-UAT-0147 | Reject forged or invalidly signed webhook | P0 | Core | In Scope | **Pass** | Bad sig / no sig / amount altered after signing / reference altered / wrong secret → **401** ×5; no rows | — |
| RST-UAT-0148 | Validate gateway amount and currency | P0 | Core | In Scope | **Pass (partial)** | Verified amount ≠ frozen quote → full Paystack refund + `amount_mismatch`/`refunded` (`TestOnChargeSuccess_AmountMismatchRefundsAndMarks`, `…FailedRefundLeavesHonestStatus`, `TestLiveDB_PlaceOrderPaystackFunded_AmountMismatchRejects`). **Currency is never compared** in `OnChargeSuccess` (only `AmountKobo`) — see note under D-005 | D-005 note |
| RST-UAT-0149 | Handle out-of-order callbacks | P0 | Core | In Scope | **Pass** | `charge.failed` is ignored by `PaystackHandler.Handle`; success→failed→success sequence leaves no state; terminal intents are never re-processed | — |
| RST-UAT-0150 | Reconcile late transfer receipt | P0 | Core | Conditional-Deferred | **Deferred** | Status self-heal + refund-on-placement-failure proven in unit; flag OFF locally | D-005 |
| RST-UAT-0151 | Safely retry failed payment | P0 | Core | Conditional-Deferred | **Deferred** | Reference derived from Idempotency-Key, `ON CONFLICT DO NOTHING`; `TestLiveDB_CancelOrder_PaystackFundedUsesExternalRefunder` / `…NoRefunderWiredFailsClosed` | — |
| RST-UAT-0152 | Deliver receipt and verify reference | P1 | Core | In Scope | **Blocked** | `GET /orders?role=customer` → 200 `{"orders":null}`; no orders to compare customer vs merchant vs admin | — |
| RST-UAT-0153 | Handle cash-on-delivery mode per policy | P0 | Cond | **N/A** | N/A | No COD/cash symbol in `model.go`, `checkout.tsx` or `service.go` (grep empty); payment sheet offers wallet or card/transfer only | — |
| RST-UAT-0154 | Receive paid order instantly | P0 | Core | In Scope | **Pass (partial)** | **FOOD-003/010**: `TestLiveDB_SetAvailability_RequiresApprovedKYBToOpen`; 0 approved restaurants locally. Push/sound/once-only queue visibility Blocked (no order) | — |
| RST-UAT-0155 | Accept order within window | P0 | Core | In Scope | **Pass (partial)** | `pending→confirmed` owner-only (`TestAuthorizeStatusChange`, `TestCanTransition`); parallel-accept caveat → D-001 | D-001 |
| RST-UAT-0156 | Reject order with reason | P0 | Core | In Scope | **Fail** | `Service.RejectOrder(…, reason)` + `rejected` state exist and are tested, but **no handler/route calls it** (grep over `internal/app`, `handler*.go` empty); `PATCH …/status {rejected}` is refused by `authorizeStatusChange`. Merchant "Reject order" button calls `DELETE` cancel with **no reason** | D-003 |
| RST-UAT-0157 | Expire unaccepted order | P0 | Core | In Scope | **Fail** | `SweepUnacceptedOrders` (auto-cancel + refund after `accept_sla_minutes`) has **no production caller** — no ticker, route or cron (grep: only tests). Unaccepted paid orders stay `pending` with funds in escrow until the customer self-cancels | D-002 |
| RST-UAT-0158 | Block unauthorized status skip | P0 | Core | In Scope | **Pass** | `ready/delivered/picked_up/preparing` on unknown order → ≥400; unauth → 401; FSM tests incl. expanded states | — |
| RST-UAT-0159 | Advance ordered preparation states | P0 | Core | In Scope | **Pass** | `orderTransitions` table; `TestCanTransition` | — |
| RST-UAT-0160 | Prevent duplicate accept requests | P0 | Core | In Scope | **Fail** | `transitionInternal` reads status then `UPDATE orders SET status=$1 WHERE id=$2` — no `AND status=<from>`, no `FOR UPDATE` (contrast `cancelAndRefund`, which locks). Parallel accepts all succeed and repeat events/notifications/dispatch; accept-vs-cancel can overwrite a refunded `cancelled` order back to `preparing` | D-001 |
| RST-UAT-0161 | Do not edit paid order contents silently | P0 | Core | In Scope | **Pass** | `PATCH/PUT …/orders/:id[/items]` → 404/405 — no mutation surface exists | — |
| RST-UAT-0162 | Protect order contact details after completion | P0 | Core | In Scope | **Pass (partial)** | Foreign order id → 403/404; `role=restaurant` as non-owner → empty; unauth → 401; `TestAuthorizeCancel`, `TestClassifyOrderActor`. Cross-user read of a *real* order not seedable (0 orders). Retention policy not found in code | — |
| RST-UAT-0163 | Print or display complete kitchen ticket | P0 | Core | In Scope | **Fail** | Merchant order screen (`app/food/restaurant/order/[orderId].tsx`) renders qty/name/price only: no notes, no modifiers, `numberOfLines={1}` clips names | D-004 |
| RST-UAT-0164 | Update prep and readiness statuses | P0 | Core | In Scope | **Pass (partial)** | Transitions record `restaurant_order_status_events` (`TestLiveDB_OrderFSMExpansion`, `…ConfirmPickupRequiresPickupCode`). Only the owner can drive them — kitchen staff cannot | D-006 |
| RST-UAT-0165 | Handle printer outage | P1 | Cond | **N/A** | N/A | No printer/ESC-POS/reprint symbol in `backend/internal/restaurant` or `app/food` (grep empty) | — |
| RST-UAT-0166 | Respect safe allergen display | P0 | Core | In Scope | **Fail** | Allergen note cannot be entered by the customer app and is not rendered by the merchant screen (D-004). Server keeps/sanitises it (`sanitizeInstructions`, length-capped) | D-004 |
| RST-UAT-0167 | Prevent kitchen from issuing settlement | P0 | Core | In Scope | **Pass** | `POST /bank-accounts` unauth → 401; non-owner → ≥400; `PATCH …/bank-accounts/:id/default` non-owner → ≥400. Staff-role matrix is unenforced (D-006) so denial currently relies on owner-only checks | D-006 (note) |
| RST-UAT-0168 | Handle edited fulfillment timing | P1 | Core | In Scope | **Fail** | Prep bounds (5–180, steps of 5) and ETA fold-in tested; but `eta_minutes` is written only at placement — no code revises it on an open order, so edited prep time never propagates | D-008 |

## Defects

All drafted for orchestrator roll-up; none were filed in the tracker. "Verified" states how the defect was established.

### FOOD-UAT-D-001 — Blocker — Order status transition is not compare-and-set (RST-UAT-0160, 0155)
- **Where:** `backend/internal/restaurant/service.go` `transitionInternal` (~L1228–1250).
- **Repro (static + spec RST-UAT-0160 pins the source):** (1) place an order, (2) fire N parallel `PATCH /api/finance/restaurant/:id/orders/:orderId/status {"status":"confirmed"}` from the owner token, (3) every call passes `canTransition(pending, confirmed)` because each read the same row, each runs `UPDATE orders SET status=$1 WHERE id=$2`, `recordOrderEvent` and notifications. For `ready` the auto-dispatch runs once per caller (duplicate rider offers).
- **Money impact:** `cancelAndRefund` locks the row (`FOR UPDATE`, L1528) but `transitionInternal` does not, so `PATCH confirmed→preparing` racing `DELETE` cancel can read `confirmed`, lose the lock race, then overwrite the already-refunded `cancelled` row with `preparing` — customer refunded **and** kitchen cooks.
- **Expected:** `UPDATE … WHERE id=$2 AND status=$from` (+ rows-affected check) or `SELECT … FOR UPDATE` in a tx; losers get 409.
- **Verified:** code reading + spec assertion; **not exercised live** (no KYB-approved restaurant / funded wallet locally). Needs a live-DB concurrency test in remediation.

### FOOD-UAT-D-002 — Blocker — Accept-SLA auto-cancel/refund never runs (RST-UAT-0157)
- **Where:** `restaurant.Service.SweepUnacceptedOrders` (`hours.go` L349). Doc says "run periodically by an ops job".
- **Repro:** `grep -rn "SweepUnacceptedOrders(" backend` → only the definition and tests. No ticker in `internal/app`, no admin route (only `activate-scheduled` exists).
- **Impact:** a paid, escrowed order the restaurant ignores stays `pending` indefinitely; funds sit in escrow. Mitigation: customer can still self-cancel. `accept_sla_minutes` is a settable but inert setting.
- **Expected:** scheduled sweep (single-flight, idempotent via `cancelAndRefund`) or an admin-triggered route plus cron.

### FOOD-UAT-D-003 — Major — Reject-with-reason is unreachable (RST-UAT-0156)
- `Service.RejectOrder(ctx, orderID, actorID, reason)` → `refundAndClose(…, OrderRejected, reason)` has no caller outside tests; `UpdateStatus` forbids `rejected`. The merchant app's "Reject order" sends `DELETE …/orders/:id` (state `cancelled`, no reason, no customer-visible reason).
- **Expected:** `POST …/orders/:orderId/reject {reason}` wired to `RejectOrder`; app shows configured reasons.

### FOOD-UAT-D-004 — Major (food-safety) — Order notes, modifiers and allergens do not reach the kitchen (RST-UAT-0139, 0163, 0166)
- Backend accepts and snapshots `special_instructions` and modifier selections. The customer app has **no** note/modifier input (no `instruction`/`modifier` in `app/food`, `src/features/food` except a comment in `normalize.ts` saying modifiers are always 0) and the merchant order screen renders neither, with item names clipped to one line.
- A nut-allergy instruction cannot be sent from the shipped client and would not be shown if sent via API.
- Also: merchant item rows are keyed by `itemId` — two variants of one item collide.

### FOOD-UAT-D-005 — Blocker (when `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` is ON) — A crash after the claim strands a collected charge
- `OnChargeSuccess` returns early for any intent whose status is not `pending`. `ClaimForProcessing` flips `pending→processing` *before* refund/place-order; if the process dies between the claim and `MarkStatus`, the intent is `processing` forever: webhook redelivery and status polls both short-circuit, there is no reaper for `processing` (or for `pending` past a TTL), and the customer has paid with no order and no refund. (The 13 `processing` rows locally are test residue; the gap is in the code.)
- Related hardening in the same function: gateway **currency** is never compared (only `AmountKobo`); a non-NGN charge of the same numeric amount would pass.
- **Expected:** reconciler sweeping `processing`/`pending` intents (the transport engine has `StartReconciler`; restaurant has none), plus currency check.

### FOOD-UAT-D-006 — Major — Kitchen/Cashier/Manager staff roles are not enforced on orders (RST-UAT-0164, 0167)
- `staff_roles.go` defines `KITCHEN`, `CASHIER`, `MANAGER` and a permission matrix (`orders.progress`, `orders.accept`), but `RoleCan`/`Can` have no call site outside tests. `authorizeStatusChange` / `classifyOrderActor` recognise only the restaurant's `owner_id`, so an invited kitchen user gets 403 on `confirmed/preparing/ready`.
- Consequence: the "kitchen role created by approved restaurant owner" precondition for Kitchen Execution cannot be satisfied through the API.

### FOOD-UAT-D-007 — Major (feature gap, N/A) — No pickup/collection order mode (RST-UAT-0136)
- `PlaceOrderRequest` requires `delivery_address`; no fulfilment-mode field; checkout has no pickup path. Logged as a gap; Cluster E owns the Pickup Journey.

### FOOD-UAT-D-008 — Minor — Edited prep time does not reach open orders (RST-UAT-0168)
- `eta_minutes` is set once at placement. No update path, no customer notice.

### Environment notes (not product defects)
- `:8083` Metro targets cloud staging with `FOOD_USE_MOCK=false`; do not drive it with fake sessions. Use a mock-mode Metro (`:8093` recipe in the spec header).
- `loginAs` default hits `/home` and expects "Explore Services"; the seeded session bounces to `/login` on a mock-mode Metro. Baseline `modules/food.spec.ts` fails the same way.
- Local container has `FEATURE_RESTAURANT_PAYSTACK_CHECKOUT_ENABLED` OFF; enable it (and seed an approved restaurant + funded wallet through the ledger) to run the Deferred/Blocked cases live.
- The worktree has no `node_modules`; `mobile-app/reactnative/node_modules` is a symlink to the main checkout's (gitignored).

## How to re-run
```
# mock-mode Metro (once), from the main checkout:
cd mobile-app/reactnative && EXPO_PUBLIC_API_BASE_URL=http://127.0.0.1:3000 EXPO_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321 \
  EXPO_PUBLIC_FOOD_USE_MOCK=true npx expo start --web --port 8093
E2E_BASE_URL=http://127.0.0.1:8093 npx playwright test tests/e2e/food-uat/cluster-d-checkout-payment.spec.ts \
  --project=mobile-chrome --workers=1 --reporter=list      # ~9 min; the Go suites dominate
```

## Phase 5 Wave 1 verify — FOOD-UAT-D-001

**Verdict: CONFIRMED (promote to Blocker).** Money impact is real: an order can end `preparing` with its escrow already `refunded`.

### Code path
- Route: `PATCH .../orders/:orderId/status` -> `Handler.UpdateStatus` (handler.go:209) -> `Service.UpdateStatus` (service.go:1205).
- `UpdateStatus` authorizes, then: `cancelled` -> `cancelAndRefund`; everything else -> `transitionInternal` (service.go:1228).
- `transitionInternal`: plain `SELECT ... FROM orders WHERE id=$1` (no tx, no `FOR UPDATE`), `canTransition(read, new)` in Go, then **`UPDATE orders SET status=$1 WHERE id=$2`** (service.go:1243). No `AND status=$prior`, no RowsAffected check. No DB trigger on `orders` (checked `pg_trigger`).
- `cancelAndRefund` (service.go:1518) and `refundAndClose` (:1642) DO use tx + `SELECT ... FOR UPDATE`, so cancel vs cancel is safe. But the lock only makes the racing unguarded UPDATE *wait*; once cancel commits, the stale-read UPDATE runs and overwrites `cancelled`.
- Same unguarded pattern reaches pickup/delivered via `transitionInternal` (dispatch.go:172, :207).

### Results (local DB :54322, real Service, real settlements)
1. **Parallel accept** (pending->confirmed, 8 goroutines x 200 orders): 198/200 orders had all 8 calls return success; distribution successes->orders `{1:1, 5:1, 8:198}`. Each success also fires the audit event + customer notification (duplicate notifications).
2. **Accept vs cancel** (confirmed: owner->preparing || customer->cancelled, 300 rounds): both calls returned nil in 300/300; **290/300 ended `orders.status='preparing'` with `settlements.status='refunded'`**. Mechanism: accept reads `confirmed`, cancel takes the lock/refunds/commits, accept's UPDATE unblocks and overwrites `cancelled` -> `preparing`. Customer is refunded AND the kitchen cooks; order is non-terminal again and can proceed to ready/picked_up/delivered, which would then run settleOrder on an already-refunded escrow.
3. **Deterministic replay** (read -> cancel commits -> stale UPDATE): `read=confirmed, order=preparing settlement=refunded`.

### Reproduce
Throw-away tests (not committed; kept in scratchpad, copy into `backend/internal/restaurant/` temporarily):
```
# /private/tmp/claude-501/-Users-paymax-Desktop-wordpress-spotlight-new--claude-worktrees-remote-sync-workflow-433ca9/d8b97ea8-89b5-4d12-af1f-f842e8aaa7de/scratchpad/zz_v1_race_live_db_test.go, /private/tmp/claude-501/-Users-paymax-Desktop-wordpress-spotlight-new--claude-worktrees-remote-sync-workflow-433ca9/d8b97ea8-89b5-4d12-af1f-f842e8aaa7de/scratchpad/zz_v1b_test.go  (reuse fsm_expansion_live_db_test.go helpers)
cd backend && TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54322/postgres \
  go test ./internal/restaurant -run 'TestV1_' -count=1 -v
```

### Fix direction (for Phase 5)
In `transitionInternal`: wrap in tx, `SELECT status ... FOR UPDATE`, then `UPDATE ... WHERE id=$2 AND status=$prior` and treat 0 rows as a conflict (409). Fixing cancel's lock alone is insufficient. Add the 8-way accept and accept-vs-cancel specs as permanent live-DB regression tests.

## Phase 5 Wave 1 verify — FOOD-UAT-D-002

**Claim:** `SweepUnacceptedOrders` is never scheduled/called, so paid+unaccepted orders sit in escrow until the customer cancels.

### Static proof

```
$ grep -rn 'SweepUnacceptedOrders' backend/
backend/internal/restaurant/hours.go:338:  // doc comment ("Intended to be run periodically by an ops job")
backend/internal/restaurant/hours.go:349:  func (s *Service) SweepUnacceptedOrders(ctx, now) (int, error)      <- declaration
backend/internal/restaurant/service.go:2060: // comment in SweepStalledDispatch ("mirrors SweepUnacceptedOrders")
backend/internal/restaurant/availability_live_db_test.go:94:  svc.SweepUnacceptedOrders(...)                                  <- TEST ONLY
backend/internal/restaurant/instructions_scheduled_live_db_test.go:205: ...                                          <- TEST ONLY
```

Zero non-test callers. No handler, no route, no `cmd/*`, no asynq task. Sibling `SweepStalledDispatch` (service.go:2061) is likewise never called outside comments (same defect class, DP-003).

Registrations that DO exist for this module (`backend/internal/app/finance_routes.go`, under the food flag):
- `restaurant.StartStuckSettlementReconciler(...)` (every 5m, `FOOD_RECONCILE_INTERVAL_MINUTES`)
- `restaurant.StartScheduledOrderSweeper(...)` (finance_routes.go:1997, every 1m, `FOOD_SCHEDULED_SWEEP_INTERVAL_MINUTES`) -> runs only `ActivateScheduledOrders` (scheduled.go:64), which selects `scheduled_for IS NOT NULL`. `SweepUnacceptedOrders` explicitly excludes those rows (`scheduled_for IS NULL`), so the two are disjoint.

Other tickers in backend/cmd (marketplace-cron, notification-worker, transport-scheduler) and `internal/scheduler`, `internal/platform/queue` contain no reference to the restaurant sweep. There is no `internal/platform/asynq` or `internal/scheduled` dir.

`scheduled_test.go` / `scheduled_group_live_db_test.go` cover `validateScheduledFor` / `ActivateScheduledOrders` / group orders: a DIFFERENT sweeper. `instructions_scheduled_live_db_test.go:205` and `availability_live_db_test.go:94` call the function directly (unit-level only).

The SLA is operator-set: `restaurants.accept_sla_minutes` (default 0 = off, 0..1440), written via `pricing.go:40`.

### Live repro (local PG :54322, backend container `new-api-1` :8080 up since 17:02, logs show the stuck-settlement reconciler and scheduled-order sweeper started)

```sql
-- fixture (psql into supabase_db_spotlight)
INSERT INTO restaurants (id,owner_id,name,address,is_open,accept_sla_minutes) VALUES ('d0020000-...-a1', owner, 'D002 Kitchen','1 St',TRUE, 1);
INSERT INTO settlements (..., status) VALUES (..., 'escrowed');           -- 100000 kobo
INSERT INTO orders (..., status, settlement_id, created_at) VALUES (..., 'pending', sett, now() - interval '30 minutes');
```
Observed ~2m15s later (>2 sweeper ticks and 30+ min past a 1-min SLA), with the live backend running:
```
 now                          | status  | settlement | accept_sla_minutes | created_at
 2026-10-20 20:14:14.959+00   | pending | escrowed   | 1                  | 2026-10-20 19:41:59.673+00
```
Not cancelled, not refunded: nothing runs the sweep.

### Function itself works when invoked (step 4)
```
$ cd backend && TEST_DATABASE_URL=postgresql://postgres:postgres@localhost:54322/postgres \
    go test ./internal/restaurant -run TestLiveDB_AvailabilityHolidayAndSweep -count=1 -v
--- PASS: TestLiveDB_AvailabilityHolidayAndSweep (0.66s)
```
Test asserts stale order -> `cancelled`, settlement -> `refunded`, fresh order stays `pending`. Side effect: that run also swept my seeded D-002 fixture (log: cancel notify for user d0020000-...-02), confirming the logic is correct and only the trigger is missing. (Residual fixture rows with ids `d0020000-*` remain: restaurant + auth users, blocked from deletion by ledger FKs; harmless.)

### Verdict: CONFIRMED

Impact is gated by opt-in: only restaurants with `accept_sla_minutes > 0` are affected, and the default is 0. But any restaurant that sets the SLA (pricing endpoint) gets a promise the platform never keeps; escrow stays locked until the customer cancels. Same for `SweepStalledDispatch` (rider-search timeout).

### Fix site (not touched)
Add a ticker runner next to `StartScheduledOrderSweeper` in `backend/internal/restaurant/scheduled.go` (e.g. `StartUnacceptedOrderSweeper(ctx, svc, interval)` calling `svc.SweepUnacceptedOrders` and `svc.SweepStalledDispatch`, same shape/log/timeout pattern), and register it in `backend/internal/app/finance_routes.go` immediately after the `StartScheduledOrderSweeper` call (~line 1997), under the same food flag, interval env e.g. `FOOD_ACCEPT_SWEEP_INTERVAL_MINUTES` (default 1). Both sweeps are idempotent/multi-instance safe via `cancelAndRefund` / settlement-status guards. Add a regression test asserting a live caller exists.
