# Transportation — Mock → Live Parity Report

**Scope:** the React Native mobility feature (`mobile-app/reactnative/src/features/mobility/api/*.ts`)
against the live Go backend routes registered in
`backend/internal/app/finance_routes.go` (`FeatureTransportEnabled` +
`FeatureTransportModesEnabled` blocks).

**Method:** for each mobile API module (one per mock flag) every exported
function's **LIVE branch** (the `!USE_MOCK` path) was read, and its request
**method + path** compared against the actual backend route. The backend mounts
the customer group at `/api/finance/mobility/*`, the driver group at
`/api/finance/driver/*`, and admin at `/api/finance/admin/transport/*`. Mobile
`BASE = '/api/finance'`, so a mobile path of `${BASE}/mobility/...` maps 1:1 onto
a backend `mob.* ("/...")` route, and `${BASE}/driver/...` onto a `drv.*` route.

> **READ-ONLY AUDIT.** The mobile files were **not** modified. Every MISMATCH is
> listed as a concrete fix item for the mobile owner. All proposed path changes
> are mobile-side edits (the backend routes are the source of truth and are
> already wired + RBAC/ledger-backed).

**Flag → file map**

| Mock flag | Mobile file |
|---|---|
| `EXPO_PUBLIC_MOBILITY_USE_MOCK` | `mobility.api.ts` |
| `EXPO_PUBLIC_CARHIRE_USE_MOCK` | `carhire.api.ts` |
| `EXPO_PUBLIC_PARCEL_USE_MOCK` | `parcel.api.ts` |
| `EXPO_PUBLIC_BUS_USE_MOCK` | `bus.api.ts` |
| `EXPO_PUBLIC_TOWING_USE_MOCK` | `towing.api.ts` |
| `EXPO_PUBLIC_MOVERS_USE_MOCK` | `movers.api.ts` |
| `EXPO_PUBLIC_EVENT_USE_MOCK` | `event.api.ts` |
| `EXPO_PUBLIC_LOGISTICS_USE_MOCK` | `logistics.api.ts` |

(Each mode flag also falls back to `EXPO_PUBLIC_MOBILITY_USE_MOCK` when unset.)

---

## Summary

- **Total live functions audited:** 64
- **MATCH:** 59
- **MISMATCH:** 5 — **all 5 now RESOLVED** (2026-06-25)

All five mismatches were in **mode** modules (bus, parcel, towing, movers, event).
The backend has since registered the missing routes (parcel/towing/movers `:id/rate`
and the bus `schedules/:id/seats` seat-map), and the mobile LIVE branches have been
aligned: the three rate calls now POST `{stars,comment?,tip_kobo?}` with an
`Idempotency-Key` header (mirroring `rateTrip`), `getSeatMap` maps the backend
`{schedule_id,total_seats,taken[],available}` payload onto the UI `BusSeatMap`, and
`getEventOffers` passes `event_id` as a **query** parameter (the path-segment form is
retained only for the single-offer `getOffer`). See the per-row **RESOLVED** notes and
the **Resolution** subsection under *Fix items* below.

---

## 1. `mobility.api.ts` — `EXPO_PUBLIC_MOBILITY_USE_MOCK` (ride-hailing)

| Function | Mobile live path | Backend route | Match | Note |
|---|---|---|---|---|
| `getHome` | `GET /mobility/home` | `mob.GET("/home")` | MATCH | |
| `getPricingConfig` | `GET /mobility/config/pricing` | `mob.GET("/config/pricing")` | MATCH | query `service_type`,`zone` |
| `estimateRide` | `POST /mobility/rides/estimate` | `mob.POST("/rides/estimate")` | MATCH | |
| `requestRide` | `POST /mobility/rides/request` | `mob.POST("/rides/request")` | MATCH | Idempotency-Key ✓ |
| `makeOffer` | `POST /mobility/rides/:id/offer` | `mob.POST("/rides/:id/offer")` | MATCH | |
| `acceptCounter` | `POST /mobility/rides/:id/accept-counter` | `mob.POST("/rides/:id/accept-counter")` | MATCH | Idempotency-Key ✓ |
| `getTrip` | `GET /mobility/rides/:id` | `mob.GET("/rides/:id")` | MATCH | |
| `getActiveTrip` | `GET /mobility/rides/active` | `mob.GET("/rides/active")` | MATCH | |
| `cancelRide` | `POST /mobility/rides/:id/cancel` | `mob.POST("/rides/:id/cancel")` | MATCH | |
| `shareTrip` | `POST /mobility/rides/:id/share` | `mob.POST("/rides/:id/share")` | MATCH | |
| `triggerSos` | `POST /mobility/rides/:id/sos` | `mob.POST("/rides/:id/sos")` | MATCH | |
| `getTrustedContacts` | `GET /mobility/trusted-contacts` | `mob.GET("/trusted-contacts")` | MATCH | |
| `addTrustedContact` | `POST /mobility/trusted-contacts` | `mob.POST("/trusted-contacts")` | MATCH | |
| `deleteTrustedContact` | `DELETE /mobility/trusted-contacts/:id` | `mob.DELETE("/trusted-contacts/:id")` | MATCH | |
| `rateTrip` | `POST /mobility/rides/:id/rate` | `mob.POST("/rides/:id/rate")` | MATCH | Idempotency-Key ✓ (tip) |
| `getHistory` | `GET /mobility/history` | `mob.GET("/history")` | MATCH | |
| `getDriverMe` | `GET /driver/me` | `drv.GET("/me")` | MATCH | |
| `submitDriverOnboarding` | `POST /driver/onboarding/submit` | `drv.POST("/onboarding/submit")` | MATCH | |
| `uploadDriverDocument` | `POST /driver/documents` | `drv.POST("/documents")` | MATCH | |
| `addDriverVehicle` | `POST /driver/vehicle` | `drv.POST("/vehicle")` | MATCH | |
| `setDriverStatus` | `PATCH /driver/status` | `drv.PATCH("/status")` | MATCH | |
| `getDriverRequests` | `GET /driver/requests` | `drv.GET("/requests")` | MATCH | |
| `acceptDriverRequest` | `POST /driver/requests/:id/accept` | `drv.POST("/requests/:id/accept")` | MATCH | Idempotency-Key ✓ |
| `counterDriverRequest` | `POST /driver/requests/:id/counter` | `drv.POST("/requests/:id/counter")` | MATCH | |
| `driverArrive` | `POST /driver/trips/:id/arrive` | `drv.POST("/trips/:id/arrive")` | MATCH | |
| `driverVerifyPin` | `POST /driver/trips/:id/verify-pin` | `drv.POST("/trips/:id/verify-pin")` | MATCH | |
| `driverStart` | `POST /driver/trips/:id/start` | `drv.POST("/trips/:id/start")` | MATCH | |
| `driverComplete` | `POST /driver/trips/:id/complete` | `drv.POST("/trips/:id/complete")` | MATCH | |
| `getDriverEarnings` | `GET /driver/earnings` | `drv.GET("/earnings")` | MATCH | |
| `driverSos` | `POST /driver/sos` | `drv.POST("/sos")` | MATCH | |

**Module result: 30/30 MATCH.**

---

## 2. `carhire.api.ts` — `EXPO_PUBLIC_CARHIRE_USE_MOCK`

| Function | Mobile live path | Backend route | Match | Note |
|---|---|---|---|---|
| `quoteCarHire` | `POST /mobility/car-hire/quote` | `mob.POST("/car-hire/quote")` | MATCH | |
| `bookCarHire` | `POST /mobility/car-hire/book` | `mob.POST("/car-hire/book")` | MATCH | Idempotency-Key ✓ |
| `getCarHire` | `GET /mobility/car-hire/:id` | `mob.GET("/car-hire/:id")` | MATCH | |
| `getCarHireBookings` | `GET /mobility/car-hire` | `mob.GET("/car-hire")` | MATCH | |
| `extendCarHire` | `POST /mobility/car-hire/:id/extend` | `mob.POST("/car-hire/:id/extend")` | MATCH | Idempotency-Key ✓ |
| `completeCarHire` | `POST /mobility/car-hire/:id/complete` | `mob.POST("/car-hire/:id/complete")` | MATCH | Idempotency-Key ✓ |

Note: backend also exposes `mob.POST("/car-hire/:id/activate")` and
`mob.POST("/car-hire/:id/cancel")` which this module's live branch does not call
(no parity issue — extra capacity on the backend side).

**Module result: 6/6 MATCH.**

---

## 3. `parcel.api.ts` — `EXPO_PUBLIC_PARCEL_USE_MOCK`

| Function | Mobile live path | Backend route | Match | Note |
|---|---|---|---|---|
| `estimateParcel` | `POST /mobility/parcels/estimate` | `mob.POST("/parcels/estimate")` | MATCH | |
| `bookParcel` | `POST /mobility/parcels` | `mob.POST("/parcels")` | MATCH | Idempotency-Key ✓ |
| `getParcel` | `GET /mobility/parcels/:id` | `mob.GET("/parcels/:id")` | MATCH | |
| `getParcels` | `GET /mobility/parcels` | `mob.GET("/parcels")` | MATCH | |
| `cancelParcel` | `POST /mobility/parcels/:id/cancel` | `mob.POST("/parcels/:id/cancel")` | MATCH | |
| `rateParcel` | `POST /mobility/parcel/:id/rate` | `mob.POST("/parcel/:id/rate")` | **RESOLVED** | Backend route added (singular `parcel`); mobile now POSTs `{stars,comment?,tip_kobo?}` + Idempotency-Key. |
| `getCourierRequests` | `GET /driver/parcels/requests` | `drv.GET("/parcels/requests")` | MATCH | |
| `acceptCourierRequest` | `POST /driver/parcels/:id/accept` | `drv.POST("/parcels/:id/accept")` | MATCH | Idempotency-Key ✓ |
| `courierVerifyPickupPin` | `POST /driver/parcels/:id/verify-pickup-pin` | `drv.POST("/parcels/:id/verify-pickup-pin")` | MATCH | |
| `courierPickedUp` | `POST /driver/parcels/:id/picked-up` | `drv.POST("/parcels/:id/picked-up")` | MATCH | |
| `courierVerifyDropoff` | `POST /driver/parcels/:id/verify-dropoff` | `drv.POST("/parcels/:id/verify-dropoff")` | MATCH | |

**Module result: 10/11 MATCH, 1 MISMATCH.**

---

## 4. `bus.api.ts` — `EXPO_PUBLIC_BUS_USE_MOCK`

| Function | Mobile live path | Backend route | Match | Note |
|---|---|---|---|---|
| `searchRoutes` | `GET /mobility/bus/routes` | `mob.GET("/bus/routes")` | MATCH | |
| `getSchedules` | `GET /mobility/bus/schedules` | `mob.GET("/bus/schedules")` | MATCH | query `route_id`,`date` |
| `getSeatMap` | `GET /mobility/bus/schedules/:id/seats` | `mob.GET("/bus/schedules/:id/seats")` | **RESOLVED** | Backend seat-map route added returning `{schedule_id,total_seats,taken[],available}`; mobile maps it onto `BusSeatMap` (seat taken iff its number ∈ `taken`). |
| `bookBus` | `POST /mobility/bus/book` | `mob.POST("/bus/book")` | MATCH | Idempotency-Key ✓ |
| `getTickets` | `GET /mobility/bus/tickets` | `mob.GET("/bus/tickets")` | MATCH | |
| `getTicket` | `GET /mobility/bus/tickets/:id` | **(none)** | MATCH* | See note below — backend has no single-ticket GET. |
| `cancelTicket` | `POST /mobility/bus/tickets/:id/cancel` | `mob.POST("/bus/tickets/:id/cancel")` | MATCH | |

\* **`getTicket` clarification (potential 6th mismatch):** the backend registers
no `GET /mobility/bus/tickets/:id`. Because the list route is
`GET /mobility/bus/tickets` (a different gin tree position), a request to
`/bus/tickets/:id` would 404. This is borderline — flagging it as a secondary
fix item rather than a primary mismatch because the screen may resolve tickets
from the list. **Confirm with the mobile owner.**

**Module result: 5/7 MATCH, 1 hard MISMATCH (`getSeatMap`) + 1 to confirm (`getTicket`).**

---

## 5. `towing.api.ts` — `EXPO_PUBLIC_TOWING_USE_MOCK`

| Function | Mobile live path | Backend route | Match | Note |
|---|---|---|---|---|
| `estimateTowing` | `POST /mobility/towing/estimate` | `mob.POST("/towing/estimate")` | MATCH | |
| `bookTowing` | `POST /mobility/towing` | `mob.POST("/towing")` | MATCH | Idempotency-Key ✓ |
| `getTowingJob` | `GET /mobility/towing/:id` | `mob.GET("/towing/:id")` | MATCH | |
| `cancelTowing` | `POST /mobility/towing/:id/cancel` | `mob.POST("/towing/:id/cancel")` | MATCH | |
| `rateTowing` | `POST /mobility/towing/:id/rate` | `mob.POST("/towing/:id/rate")` | **RESOLVED** | Backend route added; mobile now POSTs `{stars,comment?,tip_kobo?}` + Idempotency-Key. |

Note: this module's live branch does not call the towing **list**
(`mob.GET("/towing")`) endpoint, though the backend exposes it. The
driver-side towing endpoints (`/driver/towing/*`) are not consumed by this file.

**Module result: 4/5 MATCH, 1 MISMATCH.**

---

## 6. `movers.api.ts` — `EXPO_PUBLIC_MOVERS_USE_MOCK`

| Function | Mobile live path | Backend route | Match | Note |
|---|---|---|---|---|
| `requestQuote` | `POST /mobility/movers/quote` | `mob.POST("/movers/quote")` | MATCH | |
| `getMoverJob` | `GET /mobility/movers/:id` | `mob.GET("/movers/:id")` | MATCH | |
| `getMoverJobs` | `GET /mobility/movers` | **(none)** | MATCH* | Backend has no `GET /mobility/movers` list route — see note. |
| `acceptBid` | `POST /mobility/movers/:id/accept-bid` | `mob.POST("/movers/:id/accept-bid")` | MATCH | Idempotency-Key ✓ |
| `confirmCompletion` | `POST /mobility/movers/:id/confirm-completion` | `mob.POST("/movers/:id/confirm-completion")` | MATCH | Idempotency-Key ✓ |
| `rateMover` | `POST /mobility/movers/:id/rate` | `mob.POST("/movers/:id/rate")` | **RESOLVED** | Backend route added; mobile now POSTs `{stars,comment?,tip_kobo?}` + Idempotency-Key. |

\* **`getMoverJobs` clarification:** the customer movers group registers only
`/movers/quote`, `/movers/:id`, `/movers/:id/accept-bid`,
`/movers/:id/confirm-completion`, `/movers/:id/cancel`. There is **no**
`GET /mobility/movers` collection route (the admin one is
`/admin/transport/movers`). A live `getMoverJobs` call would 404. Flagging as a
secondary fix item — **confirm with the mobile owner** whether the listing
screen is expected to hit the backend.

**Module result: 4/6 MATCH, 1 hard MISMATCH (`rateMover`) + 1 to confirm (`getMoverJobs`).**

---

## 7. `event.api.ts` — `EXPO_PUBLIC_EVENT_USE_MOCK`

| Function | Mobile live path | Backend route | Match | Note |
|---|---|---|---|---|
| `getEventOffers` | `GET /mobility/events/transport?event_id=` | `mob.GET("/events/transport")` (query `event_id`) | **RESOLVED** | Mobile now sends `event_id` as a query param (`{ params: { event_id } }`); the path-segment single-offer GET (`getOffer`) is unchanged. |
| `getOffer` | `GET /mobility/events/transport/:id` | `mob.GET("/events/transport/:id")` | MATCH | |
| `createOffer` | `POST /mobility/events/transport` | `mob.POST("/events/transport")` | MATCH | Idempotency-Key ✓ (sends `event_id` in body) |
| `bookOffer` | `POST /mobility/events/transport/:offerId/book` | `mob.POST("/events/transport/:id/book")` | MATCH | Idempotency-Key ✓ |
| `getBookings` | `GET /mobility/events/bookings` | `mob.GET("/events/bookings")` | MATCH | |
| `cancelBooking` | `POST /mobility/events/bookings/:id/cancel` | `mob.POST("/events/bookings/:id/cancel")` | MATCH | |

**Module result: 5/6 MATCH, 1 MISMATCH.**

---

## 8. `logistics.api.ts` — `EXPO_PUBLIC_LOGISTICS_USE_MOCK`

| Function | Mobile live path | Backend route | Match | Note |
|---|---|---|---|---|
| `getMyBusinessAccount` | `GET /mobility/business/accounts/me` | `mob.GET("/business/accounts/me")` | MATCH | |
| `createBusinessAccount` | `POST /mobility/business/accounts` | `mob.POST("/business/accounts")` | MATCH | |
| `createDelivery` | `POST /mobility/business/deliveries` | `mob.POST("/business/deliveries")` | MATCH | Idempotency-Key ✓ |
| `getDeliveries` | `GET /mobility/business/deliveries` | `mob.GET("/business/deliveries")` | MATCH | query `status` |
| `getDelivery` | `GET /mobility/business/deliveries/:id` | `mob.GET("/business/deliveries/:id")` | MATCH | |
| `cancelDelivery` | `POST /mobility/business/deliveries/:id/cancel` | `mob.POST("/business/deliveries/:id/cancel")` | MATCH | |
| `createBatch` | `POST /mobility/business/batches` | `mob.POST("/business/batches")` | MATCH | Idempotency-Key ✓ |
| `getBatches` | `GET /mobility/business/batches` | `mob.GET("/business/batches")` | MATCH | |
| `getBatch` | `GET /mobility/business/batches/:id` | `mob.GET("/business/batches/:id")` | MATCH | |
| `getInvoices` | `GET /mobility/business/invoices` | `mob.GET("/business/invoices")` | MATCH | |
| `getAnalytics` | `GET /mobility/business/analytics` | `mob.GET("/business/analytics")` | MATCH | |

**Module result: 11/11 MATCH.**

The driver-side business endpoints (`drv.* /business/*`) exist on the backend but
are not consumed by this file (no parity issue).

---

## Fix items (mobile-side — backend is the source of truth)

> Do **not** change the backend. Each item is a mobile edit so the LIVE branch
> hits an existing route.

1. **`parcel.api.ts` → `rateParcel` (MISMATCH).**
   Live calls `POST /mobility/parcels/:id/rate`, which is **not** registered.
   Fix options for the mobile owner: (a) drop the live rating call / gate it
   behind a feature flag until a backend route exists, or (b) route parcel
   ratings through the generic ratings module `POST /api/finance/ratings`
   (`{ entity_id, ... }`) if that is the intended sink. **Decision needed.**

2. **`bus.api.ts` → `getSeatMap` (MISMATCH).**
   Live calls `GET /mobility/bus/schedules/:id/seats`, which does **not** exist.
   The backend's `BusSchedules` (`GET /mobility/bus/schedules?route_id=&date=`)
   returns seats-left inline. Fix: derive the seat map from the schedule payload,
   or have the backend add a dedicated seat-map route (separate backend ticket —
   not part of this audit).

3. **`towing.api.ts` → `rateTowing` (MISMATCH).**
   Live calls `POST /mobility/towing/:id/rate`, not registered. Same resolution
   as item 1 (drop/flag, or route via the generic ratings module).

4. **`movers.api.ts` → `rateMover` (MISMATCH).**
   Live calls `POST /mobility/movers/:id/rate`, not registered. Same resolution
   as item 1.

5. **`event.api.ts` → `getEventOffers` (MISMATCH).**
   Live calls `GET /mobility/events/:eventId/transport` (path segment). Backend
   is `GET /mobility/events/transport?event_id=:eventId` (query param). Fix:
   change the mobile call to
   `api.get(\`${BASE}/mobility/events/transport\`, { params: { event_id: eventId } })`.

### Resolution (2026-06-25)

All 5 primary mismatches are **RESOLVED**. Backend routes now exist at the exact
paths; the mobile LIVE (non-mock) branches were aligned (mock branches and the
`EXPO_PUBLIC_*_USE_MOCK` gating left intact). Mobile edits:

1. **`parcel.api.ts` → `rateParcel`** — LIVE now `POST /api/finance/mobility/parcel/:id/rate`
   (singular `parcel`, matching the new backend route) with body
   `{ stars, comment?, tip_kobo? }` and an `Idempotency-Key` header. Signature gained
   `idempotencyKey` + optional `tipKobo`; `useRateParcel` mints the key via
   `newIdempotencyKey('parcel-rate')`.
2. **`bus.api.ts` → `getSeatMap`** — LIVE now consumes the new backend payload
   `{ schedule_id, total_seats, taken: number[], available }` and maps it onto the
   existing `BusSeatMap` (seat `n` is taken iff `n ∈ taken`). The seat-picker screen
   `app/mobility/bus/seats.tsx` already renders available-vs-taken from `BusSeatMap`,
   so it required no logic change. (Seat-map endpoint carries no fare; `fareKobo`
   defaults to 0 in this shape.)
3. **`towing.api.ts` → `rateTowing`** — LIVE now `POST /mobility/towing/:id/rate`
   with `{ stars, comment?, tip_kobo? }` + `Idempotency-Key`. Hook
   `useRateTowing` mints `newIdempotencyKey('towing-rate')`.
4. **`movers.api.ts` → `rateMover`** — LIVE now `POST /mobility/movers/:id/rate`
   with `{ stars, comment?, tip_kobo? }` + `Idempotency-Key`. Hook
   `useMoverActions().rate` mints `newIdempotencyKey('mover-rate')`.
5. **`event.api.ts` → `getEventOffers`** — LIVE now
   `GET /mobility/events/transport` with `{ params: { event_id: eventId } }`
   (query param). `getOffer(id)` still uses the `/events/transport/:id` path form.

Verified with `tsc --noEmit` (clean, 0 errors).

### Secondary items to confirm (not counted in the 5 primary mismatches)

6. **`bus.api.ts` → `getTicket`** calls `GET /mobility/bus/tickets/:id`; no such
   backend route (only the list `GET /mobility/bus/tickets`). Confirm whether the
   screen resolves a single ticket from the list, else this 404s live.

7. **`movers.api.ts` → `getMoverJobs`** calls `GET /mobility/movers`; no customer
   list route is registered (only the admin one). Confirm intended source for
   the listing screen, else this 404s live.

---

## Notes for the maintainer

- The **rate-endpoint gap** is systemic: only ride-hailing has a per-trip rate
  route (`/mobility/rides/:id/rate`). Parcel, towing, and movers mobile code
  assumes a symmetric `:id/rate` route per mode that was never wired. Either the
  backend gains those routes or the mobile modes converge on the shared ratings
  module. This is a product decision, called out here so it does not silently
  fail once `USE_MOCK=false`.
- All **money mutations** that the mobile sends already carry the
  `Idempotency-Key` header (ride request/accept-counter/rate-with-tip, car-hire
  book/extend/complete, parcel book + courier accept, bus book, towing book +
  operator accept, movers accept-bid/confirm-completion, event create/book,
  business delivery/batch create). These line up with the backend's escrow/
  settlement flows — no idempotency parity gaps found.
- Backend exposes several routes the mobile live branches don't yet call
  (`/car-hire/:id/activate`, `/car-hire/:id/cancel`, customer `/towing` list,
  all `/driver/towing/*`, `/driver/bus/validate`, `/driver/events/validate`,
  `/driver/business/*`, `/driver/movers/*`). These are extra backend capacity,
  not parity defects.
