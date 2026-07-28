# Module: Restaurant & Delivery

**Risk tier:** 0 &nbsp;·&nbsp; **Money-path:** yes &nbsp;·&nbsp; **Feature flag:** `FEATURE_RESTAURANT_ENABLED` (default OFF)
**Code:** `backend/internal/restaurant/` — `handler.go`, `handler_delivery.go`, `handler_admin.go`, `service.go`, `delivery.go`, `deliveryfee.go`, `deliveryfee_repo.go`, `dispatch.go`, `payout.go`, `reconciler.go`, `ratings.go`, `model.go`, `notify.go`, `admin_repo.go`, `ws_ticket.go`, `ws_tracking.go`; tests: `model_test.go`, `deliveryfee_test.go`, `deliveryfee_request_test.go`, `split_invariant_test.go`, `transitions_test.go`, `reconciler_test.go`. Mounting: `backend/internal/app/finance_routes.go` (lines ~1248–1403). External: `backend/tests/restaurantpayout/payout_live_db_test.go`.
**Slug:** `RESTAURANT`

## 1. Overview & scope

Food-ordering + last-mile delivery vertical. A customer places an order at an open restaurant; the full amount (food subtotal + delivery fee) is **escrowed** through the shared `settlement.Service`. The restaurant owner walks the order through a lifecycle FSM (`pending → confirmed → preparing → ready → picked_up → delivered`); marking it **ready** auto-dispatches the delivery to nearby approved riders (first-to-accept wins), and the rider proves the handoff with the customer's 4-digit code, which **settles** the escrow with an **80/10/10 owner/rider/platform** split (or **90/10** when no rider). A batched **payout-run** subsystem later disburses settled-but-unpaid provider shares to wallets via one balanced ledger transfer. A crash-recovery reconciler re-drives stranded escrow.

All member routes sit under `/api/finance/restaurant` (auth: `RequireAuthContext` + `requireUserID`). Admin routes sit under `/api/restaurant/admin` (`mapsAuth()` then per-route `RequirePermission(restaurant.admin.*)`). Object-level authz is enforced in the service by ownership (`assertOwner`), order participation (`isParticipant`), and role (customer/owner/rider).

Cross-cutting files that apply: `../cross-cutting/money-invariants.md` (escrow/settle conservation, no-float, idempotent replay), `../cross-cutting/authentication.md` + `../cross-cutting/session-and-tokens.md` (bearer + WS HMAC ticket), `../cross-cutting/rbac-and-permissions.md` (`restaurant.admin.*` slugs), `../cross-cutting/kyc-and-tiers.md` (wallet-funding gate — see the gap flagged in §6), `../cross-cutting/feature-flags-and-audit.md` (flag-off + audit).

## 2. Services / endpoints in scope

| Operation | Method + path | Auth / permission | Money-path? |
|---|---|---|---|
| List open restaurants | `GET /api/finance/restaurant` | member | no |
| Create restaurant | `POST /api/finance/restaurant` | member (owner=caller) | no |
| Restaurant detail + menu | `GET /api/finance/restaurant/:id` | member | no |
| Create menu category | `POST /api/finance/restaurant/:id/menu/categories` | owner (`assertOwner`) | no |
| Create menu item | `POST /api/finance/restaurant/:id/menu/items` | owner (`assertOwner`) | no |
| Update menu item | `PATCH /api/finance/restaurant/:id/menu/items/:itemId` | owner (`assertOwner`) | no |
| Delivery-fee preview | `POST /api/finance/restaurant/:id/delivery-quote` | member | no |
| **Place order (escrow)** | `POST /api/finance/restaurant/:id/orders` | member (customer=caller) | **yes** |
| **Advance order status** | `PATCH /api/finance/restaurant/:id/orders/:orderId/status` | participant (FSM) | **yes** (settle on delivered) |
| **Cancel order (refund)** | `DELETE /api/finance/restaurant/:id/orders/:orderId` | participant | **yes** |
| List orders (role-scoped) | `GET /api/finance/restaurant/orders?role=customer\|restaurant\|rider` | member | no |
| Get order (participant) | `GET /api/finance/restaurant/orders/:orderId` | participant (`isParticipant`) | no |
| Assign rider (offer) | `POST /api/finance/restaurant/orders/:orderId/assign` | owner | no |
| Re-dispatch | `POST /api/finance/restaurant/orders/:orderId/dispatch` | owner | no |
| Rider accept delivery | `POST /api/finance/restaurant/orders/:orderId/accept` | offered rider (single-winner) | no |
| Rider confirm pickup | `POST /api/finance/restaurant/orders/:orderId/pickup` | assigned rider | no (ready→picked_up) |
| **Rider confirm handoff** | `POST /api/finance/restaurant/orders/:orderId/handoff` | assigned rider + code | **yes** (settle) |
| Rider post location | `POST /api/finance/restaurant/orders/:orderId/location` | assigned rider | no |
| Rider offers / active | `GET /api/finance/restaurant/rider/{offers,active}` | member (rider) | no |
| Order chat | `GET/POST /api/finance/restaurant/orders/:orderId/messages` | participant | no |
| Rate order | `POST /api/finance/restaurant/orders/:orderId/rate` | customer, delivered only | no |
| Live order WS | `GET /api/finance/restaurant/orders/:orderId/ws` | bearer OR HMAC ticket + participation | no |
| Admin delivery config | `GET/PUT /api/restaurant/admin/delivery-config` | `restaurant.admin.pricing` | no |
| Admin dispatch board | `GET /admin/riders`, `GET /admin/dispatch/queue`, `POST /admin/orders/:id/assign` | `restaurant.admin.dispatch` | no |
| Admin onboarding | `GET /admin/onboarding`, `POST /admin/onboarding/:id/:decision` | `restaurant.admin.onboarding` | no |
| **Admin payout runs** | `GET /admin/payouts`, `POST /admin/payouts/build`, `GET /admin/payouts/:id`, `POST /admin/payouts/:id/process` | `restaurant.admin.payouts` | **yes** (process) |

## 3. Test matrix by layer

| Behavior | Layer | Existing coverage (cite file) | Status |
|---|---|---|---|
| Order FSM legal + illegal transitions | fsm/unit | `internal/restaurant/transitions_test.go` (`TestCanTransition`) | AUTOMATED |
| Settlement split sums to 1.0 (rider 80/10/10, no-rider 90/10, orphan-rider rejected) | inv | `internal/restaurant/split_invariant_test.go` (`TestRestaurantSplitInvariant`) | AUTOMATED |
| Flat delivery fee = 50 000 kobo; total = subtotal + delivery | inv/unit | `internal/restaurant/model_test.go` | AUTOMATED |
| Distance/time delivery-fee formula (free tiers, surge, night/weather, promo, floor/cap, route vs haversine) | unit | `internal/restaurant/deliveryfee_test.go` | AUTOMATED |
| Delivery-coord normalization (flat vs nested, partial) | unit | `internal/restaurant/deliveryfee_request_test.go` (`TestDeliveryCoords_Normalization`) | AUTOMATED |
| Reconciler grace-window literal + stranded-escrow predicate guards | unit | `internal/restaurant/reconciler_test.go` | AUTOMATED |
| Payout build→process posts ONE balanced transfer, replay-safe | int | `backend/tests/restaurantpayout/payout_live_db_test.go` (`TestLiveDB_Payout_BuildThenProcess_PostsOneBalancedTransfer_ReplaySafe`, gated on `TEST_DATABASE_URL`) | AUTOMATED |
| PlaceOrder escrow + Idempotency-Key handling (handler→service→DB) | int | — | TODO |
| Handoff-code settle end-to-end (escrow→80/10/10 wallets) | int/e2e | — | TODO |
| AcceptDelivery concurrency (single-winner under FOR UPDATE) | int | — | TODO |
| Participant/owner/role authz + IDOR | authz | — | TODO |
| Admin payout RBAC (`restaurant.admin.payouts`) + missing Idempotency-Key | authz/sec | partially via cross-cutting `RBAC-*` | PARTIAL |

## 4. Manual test cases

| Case ID | Title | Priority | Preconditions | Steps | Test data | Expected result |
|---|---|---|---|---|---|---|
| `RESTAURANT-E2E-001` | Happy path: place → confirm → prepare → ready → accept → pickup → handoff settles | P0 | Flag ON; open restaurant with priced menu; customer wallet funded; one approved online rider | Place order; owner PATCH status through the chain; rider accepts, pickup, handoff with code | subtotal 350 000, delivery 50 000, total **400 000** kobo | Order reaches `delivered`; escrow settled 80/10/10 → owner **320 000**, rider **40 000**, platform **40 000**; kobo-exact, sums to 400 000 |
| `RESTAURANT-INT-001` | Place order escrows exact total | P0 | Flag ON; funded customer | `POST /:id/orders` with `Idempotency-Key` header | items 3 × 100 000 + flat 50 000 | 201; `total_kobo=350 000`; one `settlements` row `escrowed`, `total_kobo=350 000`; wallet debited once |
| `RESTAURANT-INT-002` | Distance-based fee used when coords + pin present | P1 | Restaurant has `geo_lat/lng`; delivery coords sent | Place order with `delivery_location{lat,lng}` | 5 km route | `delivery_kobo` = configured formula result (not flat 50 000); `delivery_breakdown` persisted; total = subtotal + computed fee |
| `RESTAURANT-CON-001` | Missing Idempotency-Key rejected | P0 | Flag ON | `POST /:id/orders` with no header and no body key | — | 400 `"Idempotency-Key is required"`; no escrow, no order row |
| `RESTAURANT-CON-002` | Item id / quantity validation | P1 | Flag ON | Place order with empty `item_id`, then `qty=0` | — | 400 `"each item requires an item_id"` / `"quantity >= 1"`; no money moves |
| `RESTAURANT-INT-003` | Closed restaurant rejects order | P1 | Restaurant `is_open=false` | Place order | — | Error `"restaurant is currently closed"`; no escrow |
| `RESTAURANT-INT-004` | Unavailable / foreign menu item rejected | P1 | Item `is_available=false`; item from another restaurant | Place order referencing it | — | `"menu item ... not found"` / `"not available"`; no escrow (server re-prices from DB, ignores client price) |
| `RESTAURANT-AUTHZ-001` | Only owner manages menu | P0 | Caller ≠ restaurant owner | `POST /:id/menu/items` | — | 403 `"only the owner may manage the menu"` |
| `RESTAURANT-AUTHZ-002` | Order read scoped to participants (IDOR) | P0 | Order belongs to other customer/owner/rider | `GET /orders/:orderId` as unrelated user | — | 403 `"not a participant of this order"` |
| `RESTAURANT-AUTHZ-003` | Only assigned rider may pickup/handoff/post-location | P0 | Order has rider R1; caller R2 | `POST /orders/:id/{pickup,handoff,location}` as R2 | — | Rejected `"only the assigned rider may ..."`; no state change, no settle |
| `RESTAURANT-AUTHZ-004` | Only customer may rate, only when delivered | P1 | Order not yet delivered; then delivered | `POST /orders/:id/rate` as owner; then as customer pre-delivery | stars 5 | Owner → `"only the customer may rate"`; customer pre-delivery → `"not delivered yet"`; delivered → 201 |
| `RESTAURANT-SEC-001` | Handoff requires correct delivery code | P0 | Order `picked_up`; code = `4271` | `POST /orders/:id/handoff` with `0000`, then `4271` | — | Wrong code → `"incorrect delivery code"`, still `picked_up`, escrow held; correct → `delivered` + settle |
| `RESTAURANT-INV-001` | Replay of PlaceOrder does not double-debit | P0 | Funded customer | `POST /:id/orders` twice with the SAME `Idempotency-Key` | total 400 000 | Wallet debited **once** (Escrow idempotent on key; single `settlements` row). See §6 note on duplicate order row |
| `RESTAURANT-INV-002` | Settlement conservation (no-rider folds to 90/10) | P0 | Order delivered with no rider assigned | Drive to `delivered` | total 400 000 | owner **360 000** + platform **40 000** = 400 000; rider leg absent; no negative leg; provider absorbs rounding |
| `RESTAURANT-INV-003` | Reconciler re-drives stranded escrow idempotently | P0 | Order `delivered` but `settlements.status='escrowed'` past grace | Run `ReconcileStuckSettlements` twice | grace 600 s | First run settles once; second run no-ops; ledger legs `ON CONFLICT DO NOTHING`; balances unchanged after 2nd |
| `RESTAURANT-INT-005` | AcceptDelivery single-winner under concurrency | P0 | Order `ready`, offered to R1..R3 | Two riders `POST /accept` simultaneously | — | Exactly one wins (`rider_id` set, `dispatch_status=assigned`); losers get `"already has a rider"`; other offers expire |
| `RESTAURANT-INT-006` | Cancel refunds before pickup, blocked after | P0 | Order `confirmed` (case A); order `picked_up` (case B) | `DELETE /orders/:orderId` | total 400 000 | A: escrow refunded to customer, status `cancelled`; B: `"cannot cancel ... already picked up"`, escrow untouched |
| `RESTAURANT-INT-007` | Payout run: build then process disburses net once | P0 | Delivered+settled orders for one owner; `restaurant.admin.payouts` granted | `POST /admin/payouts/build` (periodKey), then `POST /admin/payouts/:id/process` with `Idempotency-Key` | provider shares e.g. 320 000 + 320 000 | Draft run net = sum of provider `provider_kobo`; process posts ONE balanced DR settlement→CR provider-wallet transfer for `net_minor`; run `paid` |
| `RESTAURANT-INV-004` | Payout process is idempotent / never double-pays | P0 | Run in `draft` | Call `process` twice (same key); and a concurrent duplicate | net 640 000 | draft→processing guarded UPDATE affects one caller; ledger keyed on run idem key; second call returns the `paid` run; provider wallet credited once |
| `RESTAURANT-CON-003` | Payout process requires Idempotency-Key; empty run fails closed | P1 | Draft run with `net_minor=0` | `process` with no key; then a zero-net run with key | — | No key → `ErrPayoutMissingIdem`; zero-net → rolled back to `draft` + `ErrPayoutNothingDue` (no zero posting) |
| `RESTAURANT-AUTHZ-005` | Admin surfaces fail-closed on missing permission | P0 | Caller without `restaurant.admin.*` | Hit each `/api/restaurant/admin/*` route | — | 403 from `RequirePermission`; see `../cross-cutting/rbac-and-permissions.md` (`RBAC-*`) |
| `RESTAURANT-SEC-002` | WS order channel requires participation | P1 | Non-participant user / forged ticket | `GET /orders/:orderId/ws` | bad `ticket` | 401 without auth/ticket; 403 when authenticated non-participant; ticket bound to `orderId` (see `../cross-cutting/session-and-tokens.md`) |
| `RESTAURANT-SEC-00x` | Flag OFF hides the whole surface | P0 | `FEATURE_RESTAURANT_ENABLED=false` | Call any `/api/finance/restaurant/*` route | — | 404 (routes never registered); reconciler + payouts not started. Reference `../cross-cutting/feature-flags-and-audit.md` (`FLAG-SEC-001`) |

## 5. State-machine transitions

Order lifecycle FSM — `canTransition` in `service.go`, pinned by `transitions_test.go`. The rider sub-lifecycle (`dispatch_status`: `none → searching → assigned → delivered`; offers `offered → accepted/expired`) is driven through the same order FSM by `dispatch.go`/`delivery.go`.

| From | Event | To | Side effect | Case ID |
|---|---|---|---|---|
| `pending` | owner confirm | `confirmed` | notify customer | `RESTAURANT-FSM-001` |
| `confirmed` | owner prepare | `preparing` | notify customer | `RESTAURANT-FSM-002` |
| `preparing` | owner ready | `ready` | **auto-dispatch** to nearest online+approved riders; delivery code generated | `RESTAURANT-FSM-003` |
| `ready` | rider accept → pickup | `picked_up` | `ConfirmPickup` (assigned rider only) | `RESTAURANT-FSM-004` |
| `picked_up` | rider handoff + code | `delivered` | **settleOrder** 80/10/10 (or 90/10); commission earning-row | `RESTAURANT-FSM-005` |
| `pending`/`confirmed`/`preparing`/`ready` | cancel | `cancelled` | **refund** escrow to customer | `RESTAURANT-FSM-006` |

Illegal transitions (must be rejected — `"cannot move order from X to Y"`), asserted in `RESTAURANT-FSM-007`:
`pending→delivered` (skips steps), `pending→preparing`, `confirmed→ready`, `picked_up→cancelled` (no cancel after pickup), `delivered→confirmed` (terminal), `cancelled→confirmed` (terminal), `ready→ready` (no self-transition). Re-entering a terminal state is idempotent/rejected — a second `delivered` is blocked by the FSM and, at the money layer, by `settlement.Settle`'s `status='escrowed'` guard.

## 6. Security & abuse cases

- **Authz / IDOR:** participant scoping (`GetOrder`, chat, WS), owner-only menu + assign/redispatch, assigned-rider-only pickup/handoff/location, customer-only rating. Covered by `RESTAURANT-AUTHZ-001..005`, `RESTAURANT-SEC-002`.
- **Idempotency / replay:** `Idempotency-Key` header mandatory on PlaceOrder (`RESTAURANT-CON-001`); Escrow idempotent on key; payout process requires + is keyed on the run idem key (`RESTAURANT-INV-004`, `RESTAURANT-CON-003`). See `../cross-cutting/money-invariants.md` (`MONEY-INV-*`).
- **Server-side re-pricing / amount tampering:** menu prices + delivery fee are re-read/recomputed server-side in `PlaceOrder`; client-sent prices are ignored (`RESTAURANT-INT-004`).
- **Handoff proof:** 4-digit code gate before settlement (`RESTAURANT-SEC-001`).
- **Settlement conservation & no-float:** integer kobo throughout; split validated to sum 1.0 fail-closed before any money moves; provider leg is the remainder (absorbs rounding, never negative) — `RESTAURANT-INV-002`, `split_invariant_test.go`.
- **⚠️ Coverage gap — KYC/tier gate:** unlike `transport`, `restaurant.PlaceOrder` does **not** call an `enforceTierLimit` gate before escrow — it relies solely on the wallet balance/funds check inside the shared escrow debit. A Tier-0 / over-daily-limit customer with a funded wallet is not blocked here. Confirm whether this is intended vs the money-path rule in `CLAUDE.md`; reference `../cross-cutting/kyc-and-tiers.md` (`KYC-*`) and add `RESTAURANT-SEC-003` if a gate is required.
- **⚠️ Note — duplicate order row on replay:** a replayed PlaceOrder with the same key reuses the escrow (no double-debit) but the `orders` INSERT is not deduped on `idempotency_key`, so a second order row can point at the same settlement. Money is safe; surface as a data-integrity question (spec below).
- **Flag-off:** `RESTAURANT-SEC-00x`.

## 7. Automated specs to add

- `internal/restaurant/service_place_order_test.go` — table-driven handler→service test (hoisted pgx mock): asserts escrow amount = subtotal + fee, Idempotency-Key precedence (header over body), and that a same-key replay produces exactly one debit. **(covers `RESTAURANT-INT-001`, `RESTAURANT-INV-001`)** TODO.
- `internal/restaurant/settle_order_test.go` — settle split assertion against a fake `settlement.Service`: rider present → 80/10/10, absent → 90/10, kobo-exact conservation. TODO.
- `internal/restaurant/accept_delivery_concurrency_test.go` — live-DB (gated on `TEST_DATABASE_URL`) two-goroutine accept; assert single winner + losers expired. **(covers `RESTAURANT-INT-005`)** TODO.
- `internal/restaurant/reconciler_live_db_test.go` — seed delivered+escrowed order, run reconcile twice, assert settle-once + no balance change on 2nd. **(covers `RESTAURANT-INV-003`)** TODO.
- `backend/tests/restaurantpayout/payout_idempotency_test.go` — extend the existing live-DB payout suite with the concurrent/duplicate `process` and zero-net fail-closed cases. **(covers `RESTAURANT-INV-004`, `RESTAURANT-CON-003`)** TODO.
- `internal/restaurant/authz_order_test.go` — pure-function participant/role/owner authz matrix (IDOR). TODO.
- Decision + spec for the KYC/tier gap (`RESTAURANT-SEC-003`) once product confirms intent. TODO.

## 8. Coverage target & exit criteria

Coverage floor: Tier-0 pure logic ≥ 85% (fee formula, FSM, split builder, reconciler predicate already automated). Money-path service seams (PlaceOrder escrow, settleOrder split, payout process) must have committed integration tests before go-live.

Exit criteria (all must be green): `RESTAURANT-E2E-001`, `RESTAURANT-INT-001`, `RESTAURANT-CON-001`, `RESTAURANT-SEC-001`, `RESTAURANT-INV-001..004`, `RESTAURANT-INT-005..007`, `RESTAURANT-AUTHZ-001..005`, and `RESTAURANT-SEC-00x`. The KYC/tier gap (§6) must be resolved (gate added, or an ADR documenting why escrow-time funds-check suffices) before the flag is enabled in production.
