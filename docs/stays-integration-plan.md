# Paymax Stays — Backend Integration Plan (audit + gap)

**Status:** Audit complete · **Date:** 2026-07-05
**Goal:** Move the mobile Stays module (`app/stays/*`, `src/features/stays/*`,
~76 screens) from mock static data to being **driven by the real Go backend**.

---

## 1. Headline finding

The stays backend is **real and substantial** — `backend/internal/stays/*`
(search, reservation saga, pricing, dual-rail gateway + adapters, reviews,
consent, extranet, settlement, admin), registered at **`/api/finance/stays/*`**
and gated by `FEATURE_STAYS_ENABLED`. The frontend already points its live
branches at `/api/v1/stays` → proxy → Go `/api/finance/stays/*`.

**But the two sides model the domain differently:**

| | Frontend (mobile) | Backend (Go) |
|---|---|---|
| Mental model | Booking.com-style: browse **property** → see **rooms** → pick dates → book | **Supply-gateway**: a dated **search** returns per-offer rows (property+room+rate); rates only exist *inside* a dated search |
| Identity | single opaque `propertyId` / `roomTypeId` / `ratePlanId` | composite `rail` + `supplier_code` + `supplier_*_ref` + ephemeral `offer_token` |
| Discovery | home feed, deals, destinations, nearby, saved/wishlist, add-ons, profile, loyalty | **none of these exist** — only dated `/search` + `/properties/:rail/:supplier/:ref` content |
| Response envelope | bare JSON | `{ "data": ... }` (must unwrap) |
| Money | `*Minor`/`*Kobo`, `currency` | `*_kobo`, explicit `currency`/`source_currency`/`display_currency` + `fx_rate` |

So this is **not** a simple path-swap like the referral read modules. The
booking saga exists but needs the frontend to carry supplier refs + dates
through the flow; and a large discovery/agent surface has no backend at all.

---

## 2. Endpoint gap (frontend live path → backend reality)

### Core booking saga — EXISTS on backend (needs shape + identity bridge)
| Frontend call | Backend member route | Note |
|---|---|---|
| `POST /search {query,filter}` | `GET /search?city&check_in&check_out&rooms&adults&currency` | method+shape differ; returns `Result[]{offer,breakdown}` + `degraded_rails`, not `PropertyCard[]` |
| `GET /properties/:id` | `GET /properties/:rail/:supplier/:ref` | id must encode the composite key |
| `GET /properties/:id/rooms` | **none** | rooms come inline from `/search` offers (dated) |
| `POST /quote` | **none** | pricing embedded in `/search` `breakdown` + `/prebook` |
| `POST /prebook` | `POST /prebook` | body needs `rail/supplier_code/property_id/room_type_id/rate_plan_id/offer_token/check_in/check_out`; returns `{reservation,breakdown,book_token}` |
| `POST /book` (Idem-Key) | `POST /book` (Idem-Key ✓) | body `{reservation_id,book_token,guest{first_name,last_name,email,phone}}`; 409+`data.state=VOID` = auto-released |
| `GET /reservations/:id` | `GET /reservations/:id` | `{data:Reservation}`; backend Reservation carries IDs, not display name/photo |
| (trips) `GET /trips`,`/trips/:id` | `GET /reservations`, `/reservations/:id` | trips is a re-skin of reservations |
| (trips) cancel/modify | `POST /reservations/:id/{cancel,modify}` | exist; refund-preview does **not** |
| reviews mine/eligible/write | `GET /reviews-mine`, `GET /reservations/:id/review-eligibility`, `POST /reservations/:id/review` | paths differ from frontend `/reviews/*` |
| property reviews | `GET /reviews?property_id=` | path differs from `/properties/:id/reviews` |
| NDPA consent | `GET/POST /consent` | **frontend has no consent call yet** — but `/prebook` returns 428 `consent_required`; must add |

### No backend at all — discovery + agent + loyalty
`GET /home`, `/deals`, `/destinations`, `/nearby`, `/saved` + `/saved/:id/toggle`,
`/addons`, `/profile`; all of **`agent.ts`** (`/agent/*` — customer lookup, agent
search/quote/collect/book/commission); `reviews.ts` `/loyalty` + `/saved-guests`;
`trips.ts` `/trips/:id/cancel/preview` + `/refund`. `isSavedSync()` reads an
in-memory Set with no live equivalent.

---

## 3. The two bridge decisions (why this needs a call)

**A. Booking-saga identity/dates plumbing.** The backend's rates live only inside
a dated search and are addressed by `rail+supplier+refs+offer_token`. The
frontend flows a single `propertyId`/`roomTypeId`/`ratePlanId` + a store-held
draft. To wire search→prebook→book faithfully we either:
- **(A1) Adapter/encode** — encode the composite key (+dates+offer_token) into the
  opaque `id` strings the UI already passes around, and unpack them in
  `getProperty`/`prebook`. Minimal screen changes, ships fast, slightly hacky;
  `offer_token` expiry means a stale card can't prebook (handle as "refresh").
- **(A2) Store/flow refactor** — carry the real offer + refs in the booking-draft
  store and thread them through the room/review/book screens. Cleaner and matches
  the backend saga, but touches many screens.

**B. The no-backend discovery/agent surface (~10 endpoints + the whole agent
flow).** Either **build** those member endpoints in Go (home/deals/destinations/
nearby/saved/addons/profile/loyalty + agent-assisted booking + dated rooms) —
large, and each is spec→migration→handler→tests under the money-path iron rules —
or **keep them mock-flagged** for now and ship the real booking saga first.

---

## 4. Constraints in this session
- No Go toolchain / no test DB here, so any **new backend** endpoints can't be
  compiled/tested by me — I can write them against source signatures and you run
  `go build/vet/test` locally (same caveat as the referral withdraw work).
- Mobile TypeScript **can** be type-checked here.
- `FEATURE_STAYS_ENABLED=true` + `GO_BACKEND_URL`→backend (port 8091 per project
  notes) + `EXPO_PUBLIC_STAYS_USE_MOCK=false` are required to run live.

---

## 4b. Progress (2026-07-06) — booking saga wired (adapter approach)

Chosen: **fast adapter** (A1) + **defer discovery/agent** (B). Implemented in
`src/features/stays/{api,trips,reviews,agent}.ts`; mobile type-check clean.

Wired LIVE to the real backend (unwrapping the `{data}` envelope; composite
supplier key encoded into opaque ids):
- **search** → `GET /search` (per-offer results grouped into `PropertyCard[]`;
  client-side filter/sort preserved). `searchRelaxed` too.
- **property content** → `GET /properties/:rail/:supplier/:ref` → `PropertyDetail`.
- **rooms** → re-runs the dated `/search`, groups offers into `RoomType[]` +
  `RatePlan[]`, encoding `offer_token`+refs into each `RatePlan.id`.
- **prebook** → `POST /prebook` (auto-grants NDPA `consent` first; sends the
  supplier refs; returns a `bookToken` carrying `reservation_id`+`book_token`).
- **book** → `POST /book` (Idempotency-Key; 409+`state=VOID` → hold-released).
- **reservations / trips** → `GET /reservations[/:id]`, `POST /reservations/:id/
  {cancel,modify}` → `Trip`/`Reservation`/`RefundStatus`.
- **reviews** → `GET /reviews`, `GET /reviews-mine`, `GET /reservations/:id/
  review-eligibility`, `POST /reservations/:id/review`.

> **Discovery progress (2026-07-06):** `destinations` (GET /destinations?q=) and
> `home` (GET /home → trending destinations) are now BUILT and wired
> (`internal/stays/discovery/discovery.go`, registered in `stays_routes.go`;
> frontend `searchDestinations`/`getStaysHome` live). `go build`/`vet` clean; SQL
> verified against seeded rows on the local Postgres. Both read distinct ACTIVE
> cities from `stays_property` (DIRECT inventory) — bedbank supply isn't locally
> indexed, and `deals`/`nearby` remain (deals needs a curated table; nearby needs
> lat/lng in the search handler + frontend device coords + PostGIS geo).

Kept as flagged fallbacks (no backend): deals, nearby,
saved/wishlist (client-only Set), add-ons (static catalogue), profile, loyalty,
saved-guests, cancel/modify previews, refund status, and the **entire agent
flow** (`agent.ts` — reads return empty, money mutations throw). Every one is
marked `TODO(stays)` and never calls a 404 path.

**Known lossiness / must-verify (flagged in code):**
- ~~`Reservation`/`Trip` carry no property display content~~ **ADDRESSED
  (2026-07-06, pending local `go build`):** the reservation handler now enriches
  List/Get/Cancel/Modify responses with a best-effort `content` block
  (`name/city/address/cover_url/star_rating/property_type`) via
  `searchSvc.GetContent(rail, supplier, PropertyID)` — additive, nil-safe, no
  migration (relies on the reservation persisting the supplier property ref as
  `PropertyID`, which the adapter's prebook body sends). Backend:
  `internal/stays/reservation/handler.go` + `internal/app/stays_routes.go`.
  Frontend `api.ts`/`trips.ts` read the `content` block. Room/rate display names
  are still ID-only (would need room/rate content embedding). **Verify with
  `go build ./... && go vet ./...` locally.**
- Results cards have no cover photo (search offers carry no thumbnail).
- **prebook/book field semantics are UNVERIFIED here** (no Go toolchain / test DB
  in this session): `property_id/room_type_id/rate_plan_id` are sent as the
  supplier refs; if the gateway needs the INTERNAL mapped ids for mapped supply,
  thread `offer.mapped_property_id`. **Run the two-step saga against a live
  backend before trusting the money path.**

## 5. Recommended sequence (once approach chosen)
1. **Consent** call + gate (prebook returns 428 without it).
2. **Search → property content** wired live (real supply on the results/detail
   screens) using the chosen identity approach.
3. **prebook → book → reservation** saga live (the money path; book already
   requires Idem-Key on both sides).
4. **trips** (reservations list/detail/cancel/modify) + **reviews** live.
5. Decide build-vs-defer for discovery/agent/loyalty; build under iron rules.
6. Flip `EXPO_PUBLIC_STAYS_USE_MOCK=false`; keep mock only behind a dev override.
