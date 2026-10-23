# Cluster E — Dispatch, Rider, Tracking & Pickup (RST-UAT-0169 … 0218)

Spec: `mobile-app/reactnative/tests/e2e/food-uat/cluster-e-dispatch-rider.spec.ts` (run 2026-10-20).
Evidence legend: **[UI]** = Playwright drove the RN-web rider/customer screens (Food runs in mock mode, `EXPO_PUBLIC_FOOD_USE_MOCK` default true). **[static]** = asserted against product source (read-only); no live rider/driver seed or `TEST_DATABASE_URL` was available, so live concurrency / DB behaviour was NOT exercised. Existing Go tests cited where they already cover a case. Defect cases are encoded as `test.fail()` (expected to fail until fixed).

## Totals (50 cases)
**Pass 11 · Fail 17 · Blocked 3 · N/A 19** (Playwright desktop-chrome run: 43 passed incl. 16 expected-failure defect assertions, 21 skipped, 0 unexpected failures).

**Harness note (important):** the :8083 Metro server runs `EXPO_PUBLIC_FOOD_USE_MOCK=false` (live mode) and the harness fake Supabase token is 401'd by the Go API, which triggers global sign-out. UI cases therefore drive the real RN screens against a route-mocked, stateful fake of the Go food API using the shape the CLIENT expects (`installFoodApiFake`). Go-real response shapes are checked separately (E-018).

| ID | Title | Pri | Core/Cond | Scope | Status | Evidence | Defect |
|---|---|---|---|---|---|---|---|
| 0169 | Create dispatch request once | P0 | Core | In | Pass | [static] `DispatchOrder` returns early if rider set; `UNIQUE(order_id,rider_id)` + `ON CONFLICT DO NOTHING` | — |
| 0170 | Assign nearest eligible online rider | P0 | Core | In | Fail | [static] online+approved + nearest-first pass (`dispatch_fairness_test.go`); no service-zone/radius filter | E-001 |
| 0171 | Exclude offline or suspended rider | P0 | Core | In | Fail | Offer side filters `status='online' AND verification_status='approved'`; `AcceptDelivery` checks approved only | E-002 |
| 0172 | Enforce rider capacity | P0 | Core | In | Fail | Offer side caps load at 3 (6 on SLA breach); accept never re-checks, 7-way fan-out lets one rider hold many offers | E-002 |
| 0173 | Offer with limited acceptance window | P0 | Core | In | Fail | `restaurant_delivery_offers` has no `expires_at`; offers only expire on accept/reassign | E-003 |
| 0174 | Prevent double-claim race | P0 | Core | In | Pass | [static] `AcceptDelivery` tx + `SELECT … FOR UPDATE` + "already has a rider"; losers' offers set `expired`. Concurrency not run live | — |
| 0175 | Reassign rejected job | P0 | Core | In | Fail | Decline → `DispatchOrder` when no open offers (pass); re-dispatch never excludes riders who already hold an offer row | E-004 |
| 0176 | Recover when no rider available | P0 | Core | In | Fail | Customer notified (`EventOrderNoRiders`), UI shows "Finding a rider…" (pass); `SweepStalledDispatch` (refund) has zero callers; customer cannot cancel once `ready` | E-003 |
| 0177 | Reassign rider no-show | P1 | Core | In | Fail | Only admin `ReassignOrder` + offline sweep (`SweepOfflineAssigned`, no caller); no pickup-SLA no-show trigger | E-003 |
| 0178 | Prevent post-pickup silent reassignment | P0 | Core | In | Pass | [static] `ReassignOrder` refuses `picked_up`/`delivered` | — |
| 0179 | Exclude ineligible vehicle mode | P2 | Core | N/A | N/A | No vehicle requirement on orders; `dispatch.go`/`delivery.go` never reference vehicle (grep) | E-015 (gap) |
| 0180 | Go online after approval | P0 | Core | In | Blocked | [UI] `/food/rider` has no availability control; `drivers.status` owned by transport module | E-005 |
| 0181 | Reject go-online while pending | P0 | Core | In | Pass | [static] sourcing + `AcceptDelivery` both require `verification_status='approved'` | — |
| 0182 | Go offline when idle | P1 | Core | In | Blocked | Toggle not in Food module | E-005 |
| 0183 | Handle offline during active job | P1 | Core | In | Blocked | No offline control in Food; `SweepOfflineAssigned` only pre-pickup, unscheduled | E-005 |
| 0184 | Accept valid job offer | P0 | Core | In | Fail | [UI] vs client-shaped fake: offer card (restaurant, items, distance, payout) + accept → Active delivery works; [static] pre-accept address masked. LIVE wire shape of `/rider/offers` is incompatible with the client (`0184b` fails) | E-018 |
| 0185 | Reject job without side effects | P1 | Core | In | Fail | [UI] decline hides offer, order untouched (vs fake); unreachable live because the offers list cannot load (E-018) | E-018 |
| 0186 | Arrive & confirm pickup | P0 | Core | In | Pass | [UI] correct code (vs fake) advances to handoff step; [static] `picked_up_at` + `recordOrderEvent`; Go `TestLiveDB_ConfirmPickupRequiresPickupCode` | — |
| 0187 | Reject incorrect pickup code | P0 | Core | In | Fail | Wrong code rejected [UI]+Go test; no attempt limit/lockout, no route rate-limit (4-digit space) | E-008 |
| 0188 | Block premature delivery status | P0 | Core | In | Fail | [UI] no handoff card before pickup; rejected (public `UpdateStatus` forbids delivered; FSM refuses), no payout; but `ConfirmHandoff` writes `delivered_at`/`dispatch_status='delivered'` before the FSM guard, non-atomic | E-009 |
| 0189 | Confirm destination arrival | P1 | Core | N/A | N/A | No "arrived" state in order FSM or rider UI | E-010 (gap) |
| 0190 | Complete delivery with proof | P0 | Core | In | Pass | [UI] correct delivery code → "Delivery confirmed", double-tap posts once; [static] POD → `transitionInternal(delivered)` → `settleOrder`; OTP only (no photo/signature) | — |
| 0191 | Reject fake delivery proof | P0 | Core | In | Fail | Wrong code rejected; unlimited guesses of a 4-digit code (rider-side brute force of payout trigger) | E-008 |
| 0192 | Avoid duplicate delivery settlement | P0 | Core | In | Pass | [UI] double-tap Confirm sends 1 POST; [static] `delivered` terminal in FSM. Caveat: `ConfirmHandoff` has no row lock; concurrent double-submit not run live | — |
| 0193 | Report failed delivery attempt | P1 | Core | In | Fail | `MarkDeliveryFailed` exists but has no route/handler/UI | E-011 |
| 0194 | Use route deep link safely | P2 | Core | N/A | N/A | No Linking/openURL maps deep link in `app/food/rider/*` (in-app MobilityMap only) | — |
| 0195 | Recover interrupted rider session | P1 | Core | In | Fail | [static] `/rider/active` returns `{"deliveries":[Order]}` but client expects a single Order|null → resume banner links to `/food/rider/undefined` live (`0195b`) | E-018 |
| 0196 | Handle expiring credential mid-shift | P1 | Core | In | Pass | [static] new sourcing + accept gated on `verification_status='approved'`; in-flight job untouched. Expiry→status flip is transport's | — |
| 0197 | Show correct live stage | P0 | Core | In | Pass | [UI] rider view stage shown; [static] FSM forward-only | — |
| 0198 | Track assigned rider | P0 | Core | In | Fail | [UI] customer "Live rider tracking" map shows for assigned/picked_up; no ETA rendered on tracking | E-014 |
| 0199 | Handle GPS unavailable mid-trip | P1 | Core | In | Fail | Rider heartbeat re-posts `order.rider.location` (server echo), never device GPS; customer map has no last-updated | E-012 |
| 0200 | Stop location visibility after completion | P0 | Core | In | Fail | UI hides rider card/map on terminal; WS order-bound + participant-gated (pass); `PostLocation` has no status gate and location rows have no retention | E-013 |
| 0201 | No access to other orders | P0 | Core | In | Pass | [static] `GetOrder` participant check, WS HMAC ticket bound to order, `PostLocation` assigned-rider only | — |
| 0202 | Avoid false ETA | P1 | Core | In | Pass | Tracking screen never fabricates an ETA (none shown at all — see E-014) | — |
| 0203 | Place restaurant pickup order | P1 | Cond | N/A | N/A | No customer self-pickup fulfilment: `checkout.tsx` has no pickup/collect option, `orders.delivery_address` mandatory | E-016 (gap) |
| 0204 | Issue pickup reference securely | P1 | Cond | N/A | N/A | `pickup_code` is restaurant→rider only and masked from the customer (`maskPODCodes`) | E-016 |
| 0205 | Confirm correct handover | P1 | Cond | N/A | N/A | As 0203 | E-016 |
| 0206 | Reject wrong pickup code | P1 | Cond | N/A | N/A | As 0203 (rider-side analogue covered by 0187) | E-016 |
| 0207 | Prevent repeat collection | P1 | Cond | N/A | N/A | As 0203 (FSM blocks repeat rider pickup) | E-016 |
| 0208 | Handle no-show pickup | P2 | Cond | N/A | N/A | As 0203 | E-016 |
| 0209 | Scan table QR and open menu | P2 | Cond | N/A | N/A | No dine-in/table/reservation surface in current Food module (per code search in `backend/internal/restaurant/`, `mobile-app/reactnative/app/food/`; spec pre-check test asserts no hits) | E-017 (gap) |
| 0210 | Reject tampered QR table id | P2 | Cond | N/A | N/A | same | E-017 |
| 0211 | Add orders to active table session | P2 | Cond | N/A | N/A | same | E-017 |
| 0212 | Settle table and close session | P2 | Cond | N/A | N/A | same | E-017 |
| 0213 | Prevent editing another table | P2 | Cond | N/A | N/A | same | E-017 |
| 0214 | Reserve available slot | P2 | Cond | N/A | N/A | same | E-017 |
| 0215 | Prevent capacity overbooking | P2 | Cond | N/A | N/A | same | E-017 |
| 0216 | Reject booking in closed period | P2 | Cond | N/A | N/A | same | E-017 |
| 0217 | Modify and cancel booking | P2 | Cond | N/A | N/A | same | E-017 |
| 0218 | Guest arrival and no-show | P2 | Cond | N/A | N/A | same | E-017 |

(Priority values are best-effort from the workbook extract; confirm during roll-up.)

## Defects

Severity order: **Blocker** E-018 · **Major** E-002, E-003, E-004, E-008, E-011, E-012 · **Minor** E-001, E-005, E-009, E-013, E-014 · **Feature gaps** E-010, E-015, E-016, E-017.

### FOOD-UAT-E-018 — Blocker — Rider console cannot work against the live backend (wire-contract mismatch)
`GET /restaurant/rider/offers` returns `{"offers":[Order…]}` (handler_delivery.go `RiderOffers`, Order JSON: `id`, `delivery_address`, `delivery_kobo`, no `payout_kobo`/`item_count`/`distance_meters`/`restaurant_name`). Client `getRiderOffers` (`src/features/food/api.ts:~490`) unwraps and calls `raw.map(...)` on the offered `{offers:[…]}` object expecting a flat array of `{order_id,restaurant_name,payout_kobo,item_count…}` → TypeError / "Couldn't load offers". `GET /restaurant/rider/active` returns `{"deliveries":[Order…]}` but `getRiderActive` expects one `Order|null` → garbage order, resume banner navigates to `/food/rider/undefined`. Masked locally because `FOOD_USE_MOCK` defaults to true. Repro: live mode, approved online rider, an order marked ready → open `/food/rider`. Spec: `0184b`, `0195b`.

### FOOD-UAT-E-008 — Major (security) — Pickup/delivery codes brute-forceable
`ConfirmPickup` / `ConfirmHandoff` (`backend/internal/restaurant/dispatch.go`) compare a 4-digit code with `!=` and have no attempt counter, lockout, or route rate-limit (`finance_routes.go:1818-1819`, no limiter). The assigned rider can try all 10 000 delivery codes and trigger settlement (`transitionInternal(delivered)` → `settleOrder`) without the customer. Transport got this hardening in #843; Food did not. Repro: authenticated as assigned rider, loop POST `/orders/:id/handoff {code}` 0000..9999. Expected: lockout after N misses + audit event.

### FOOD-UAT-E-003 — Major — Dispatch lifecycle sweepers are dead code; offers never expire
`SweepStalledDispatch` (auto-refund when no rider), `SweepOfflineAssigned` have zero non-test callers anywhere under `backend/` (grep), and `restaurant_delivery_offers` has no `expires_at`. Result: unclaimed offers live forever, an order with no rider sits `ready/searching` indefinitely, customer can't cancel once `ready` (only `placed`/`accepted`), no pickup-SLA no-show handling. Repro: mark order ready with all riders offline; wait past `dispatchStaleMinutes` — nothing happens.

### FOOD-UAT-E-002 — Major — `AcceptDelivery` skips eligibility re-checks
Only `verification_status='approved'` is checked. A rider who has since gone offline, or who already holds ≥ cap jobs (fan-out offers to 7 riders at once; the same rider can hold offers on many orders), can still accept. Fix: re-check `d.status='online'` and active load inside the accept tx.

### FOOD-UAT-E-004 — Major — Re-dispatch is starved by already-declined riders
Sourcing query doesn't exclude riders that already have an offer row; `ON CONFLICT DO NOTHING` then drops them, so after the nearest 7 riders decline, farther eligible riders are never reached, the order stays `searching`, and decliners get a fresh "New delivery offer" push with no offer behind it.

### FOOD-UAT-E-011 — Major — Failed delivery cannot be reported
`Service.MarkDeliveryFailed` has no handler, route or rider UI. Riders at an unreachable address have no way to mark it; they'd be stuck in `picked_up`.

### FOOD-UAT-E-012 — Major — Rider app never reports device GPS; customer map isn't truly live
`app/food/rider/[orderId].tsx` heartbeat re-posts `order.rider?.location` (the value fetched from the server) every 8 s; `useDeviceCoords` is only used on the Food home. The customer's "Live rider tracking" is therefore static (live mode) and there is no "last updated" indicator for stale/lost GPS (0199).

### FOOD-UAT-E-001 — Minor — No service-zone / max-radius eligibility in rider sourcing
Candidates are all online+approved drivers ranked by distance; a rider 80 km away still receives an offer if fewer than 7 are online.

### FOOD-UAT-E-005 — Minor — No rider availability control in Food rider console
Online/offline is only in the shared transport `drivers` pool. Cases 0180/0182/0183 Blocked pending confirmation of the transport toggle; no Food-side policy for going offline mid-job.

### FOOD-UAT-E-009 — Minor — `ConfirmHandoff`/`ConfirmPickup` write before the FSM guard
`delivered_at`, `dispatch_status='delivered'` (and `picked_up_at`) are UPDATEd, outside a transaction, before `transitionInternal` validates the transition. A correct code supplied while the order is `ready` is rejected but leaves `delivered_at` set and `dispatch_status='delivered'` on an undelivered order (corrupts admin/SLA reporting). Fix: validate transition first, single tx with row lock (also closes the double-submit window on 0192).

### FOOD-UAT-E-013 — Minor (privacy) — Location posts not gated or retained
`PostLocation` has no order-status check (can post/broadcast after delivery) and `restaurant_rider_locations` rows have no retention/purge.

### FOOD-UAT-E-014 — Minor — Customer tracking has no ETA
Order screen renders no ETA/arrival estimate (0198 expects updated ETA). Not fabricated (0202 passes).

### Feature gaps (N/A cases, logged for triage)
- **E-010** no "arrived at destination" state. **E-015** no vehicle-mode constraint in dispatch. **E-016** no customer self-pickup fulfilment type. **E-017** no dine-in/table/QR/reservation capability at all.

## Notes / limits
- Machine load average during the run was ~400 (parallel cluster swarm); UI tests were run single-worker with raised timeouts. Concurrent Playwright runs share `test-results/` and can delete each other's artifacts — runs here used `--output=/private/tmp/...`, `E2E_BASE_URL` to skip webServer, `--project=desktop-chrome`.
- Mock-mode UI cannot verify the correct-pickup-code success path (random mock code is not exposed); that path rests on Go `TestLiveDB_ConfirmPickupRequiresPickupCode`.
- Live-DB checks (race on accept, offer expiry, settlement idempotency) need `TEST_DATABASE_URL`; not run.

## Phase 5 Wave 1 verify — FOOD-UAT-E-018

**Verdict: CONFIRMED (live).** Backend wraps both rider reads in an envelope key the mobile client does not unwrap. Hidden locally because `EXPO_PUBLIC_FOOD_USE_MOCK` defaults on.

**Backend**
- Route registration: `backend/internal/app/finance_routes.go:1821-1822` (`GET /api/finance/restaurant/rider/offers`, `/rider/active`).
- `RiderOffers`: `backend/internal/restaurant/handler_delivery.go:508-517`, emits `gin.H{"offers": offers}` (`offers` is `[]Order`, `delivery.go:775`).
- `RiderActive`: `backend/internal/restaurant/handler_delivery.go:519-528`, emits `gin.H{"deliveries": active}` (`[]Order`, a LIST, `delivery.go:804`; not a single order).

**Mobile client**
- `mobile-app/reactnative/src/features/food/api.ts:498-521` `getRiderOffers`: `unwrap<{order_id, restaurant_name, ..., payout_kobo, item_count}[]>(...)` then `raw.map(...)`.
- `api.ts:524-530` `getRiderActive`: `unwrap<Order | null>(...)` then `mapOrder(data)`.
- `unwrap` (`api.ts:53`) only strips a `data` key: `res.data?.data ?? res.data`. It knows nothing about `offers` / `deliveries`.
- Consumers: `hooks.ts:357,366`.

**Live probe** (qa-claude-test@spotlight.internal GoTrue JWT; backend :8080; no offers/active deliveries seeded so both empty)
```
GET /api/finance/restaurant/rider/offers  -> 200 {"offers":null}
GET /api/finance/restaurant/rider/active  -> 200 {"deliveries":null}
```

**Shape comparison and runtime consequence**
- Offers: client gets the object `{offers:null}` (unwrap passes it through since no `data` key), then `raw.map` throws `TypeError: raw.map is not a function`, so the rider offers screen errors in live mode even when empty. With data, a second mismatch applies: backend returns full snake_case `Order` objects (`id`, `restaurant_id`, `delivery_address`, `total_kobo`...), but the client reads offer-card fields `order_id`, `restaurant_name`, `payout_kobo`, `distance_meters`, `item_count`, which `Order` does not carry. So fixing the envelope alone is not enough.
- Active: client gets `{deliveries:null}` (truthy) and runs `mapOrder` on it, producing a phantom empty order instead of `null`. With data, it receives an array where a single order is expected.

**Which side is wrong:** both are inconsistent, but the fix belongs primarily on the **mobile client** (the backend envelope is the established convention for the other list endpoints and is a stable contract; nothing else reads these). Recommended: in `getRiderOffers` read `res.data.offers ?? []` and map from the `Order` shape (or enrich the backend offer payload with restaurant name / payout / distance / item_count, which needs a backend + openapi change, so decide first); in `getRiderActive` read `res.data.deliveries?.[0] ?? null`. Add a non-mock contract test against the live JSON. Also confirm `contracts/openapi.yaml` documents the envelope.
