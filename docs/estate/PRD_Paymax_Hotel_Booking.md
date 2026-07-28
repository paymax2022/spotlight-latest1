# PRD — Paymax Hotel Booking (Property Suite · Stays module)

**Product:** Paymax Super-App — Property Suite → Hotel Booking
**Benchmark:** Booking.com (UX + extranet model), adapted for the Nigeria/Africa market
**Status:** Draft for build (God Mode) · **Doc owner:** Property/Stays Product Lead
**Stack baseline:** Go services · React Native client · React admin/extranet web · PostgreSQL + PostGIS · existing Paymax platform primitives

---

## 0. Document control

| Field | Value |
|---|---|
| Version | 1.0 (build-ready) |
| Sits within | Paymax **Property Suite** (shares core with Listing Marketplace, Shortlet, Owner–Tenant–Rent), built on the pre-shipped Visitor Access feature |
| Supply model | **Dual-rail:** bedbank/aggregator API inventory **+** Paymax-operated extranet for direct-contracted local hotels, unified by a dedup/mapping layer |
| Net-new services | `stays-svc`, `supply-gateway`, `ari-svc` (availability/rates/inventory), `stays-extranet` (hotelier web), `stays-admin` (ops web) |
| Reused primitives | Identity/SSO, KYC, Wallet ledger, Virtual accounts, Payouts, Agent network, Notifications, Document store, Reviews infra, Search/Media (property suite) |
| Regulatory/finance notes | FX display + parallel-rate handling; Naira settlement to local hotels; pay-at-property + deposit support; NDPA 2023 for guest PII |

---

## 1. Executive summary

Paymax will launch an in-app hotel booking experience with Booking.com-grade UX (search → map/filters → property page → room/rate selection → instant confirmation → managed bookings) but engineered around the realities that break hotel booking in Nigeria today:

1. **Payment friction.** A large majority of Nigerian cards fail on international hotel platforms; travellers default to cash, bank transfer, and deposit-at-property. Paymax pays from the **wallet**, settles hotels in **Naira**, and natively supports **prepay, deposit, and pay-at-property**.
2. **Trust friction.** The defining local failure mode is "I paid, but the hotel has no record of my booking," followed by slow refunds. Paymax guarantees **confirmed inventory** (two-step prebook→book), **instant refunds to wallet**, and a reconciliation/settlement spine that makes "paid-but-not-confirmed" structurally impossible.
3. **Supply gaps.** Most Nigerian mid/budget hotels are absent from global bedbanks. Paymax runs a **dual supply rail**: aggregator/bedbank inventory for breadth (global + regional) **plus** a Paymax extranet that onboards local hotels directly, deduplicated so each hotel appears once with the best rate.

Architecturally this reuses the same patterns already proven across Paymax: a **provider-agnostic `supply-gateway`** (the `MapService`/`underwriter-gateway` shape) so a new bedbank or the direct rail is a config change, not a re-architecture; the **append-only wallet ledger** for every money movement; **single-identity capabilities** (a guest, a hotelier, and an agent are capabilities on one `User`, never duplicate accounts); and **guarded state machines** with immutable audit.

The deliverable spans four surfaces: the **traveller mobile app** (~58 screens), the **hotelier extranet** (~34 screens, the Booking.com Extranet/Pulse equivalent), the **ops admin** (~30 screens), and **agent-assisted booking** (~9 screens).

---

## 2. Market context & strategic rationale

- **Demand mix.** Nigeria's stays demand skews business + VFR (oil & gas, finance, diaspora), concentrated in Lagos and Abuja, with national occupancy historically ~50%. Mid/budget hotels are numerous and domestic-facing; upscale hotels price in USD/parallel-rate.
- **Incumbents.** Hotels.ng (since 2013, 10k–15k+ properties, 1000+ cities), Jumia Travel, Bookhotels.ng on the local side; Booking.com/Agoda/Hotels.com list NG hotels but skew pricier and card-dependent.
- **The Paymax wedge (why we win):**
  - **Wallet-native checkout** removes the card-rejection wall entirely.
  - **Naira settlement + pay-at-property/deposit** matches how Nigerians actually pay for hotels.
  - **Agent network** captures offline/assisted travellers — a channel incumbents underserve.
  - **Confirmation guarantee + instant wallet refunds** directly attack the trust deficit that dominates local reviews.
  - **Super-app context:** cross-sell with the Transport module (airport pickup/ride to hotel), Insurance module (travel/PA cover at checkout), and the wider Property Suite (shortlet alternative when no hotel fits).

---

## 3. Goals, non-goals, success metrics

### 3.1 Goals
1. Booking.com-grade discovery and booking UX, mobile-first, with map, rich filters, and verified-guest reviews.
2. Dual supply rail (bedbank + direct extranet) behind one gateway, with hotel dedup/mapping.
3. Wallet-native payments with prepay / deposit / pay-at-property, Naira settlement, instant refunds.
4. Reliable confirmation (two-step prebook→book) — zero "paid-but-unconfirmed" cases.
5. Full hotelier extranet (content, ARI, promotions, reservations, finance, analytics) for direct hotels.
6. Reconciliation + settlement spine across both supply rails; immutable audit.

### 3.2 Non-goals (v1)
- Flights, car rental, attractions, taxi (Transport module already covers rides; revisit cross-sell, not full OTA).
- Building a proprietary global bedbank (we consume one).
- Channel-manager certification for every PMS (start with the top connectors / manual extranet; expand later).
- Corporate/TMC travel-policy engine (Phase 4+).

### 3.3 Success metrics
| Metric | Target (first 2 quarters live) |
|---|---|
| Look-to-book conversion | ≥ benchmark for wallet-checkout cohort |
| Booking confirmation success (prebook→book) | ≥ 99.5% |
| "Paid-but-unconfirmed" incidents | **0 unresolved** |
| Wallet-pay share of bookings | ≥ 60% |
| Direct-hotel inventory live (extranet) | ≥ 1,500 NG properties by end Q2 |
| Refund-to-wallet median | ≤ minutes (vs days on incumbents) |
| Hotel payout reconciliation break rate | < 0.5% |

---

## 4. Competitive benchmark — Booking.com parity + Paymax deltas

| Capability | Booking.com | Paymax v1 |
|---|---|---|
| Search (destination/dates/guests/rooms) | ✓ | ✓ |
| Map view + sold-out markers | ✓ | ✓ |
| Rich filters (price, score, amenities, type, distance, free-cancel, breakfast) | ✓ | ✓ |
| Ranking ("Top picks" relevance + commercial signals) | ✓ | ✓ (transparent commercial weighting) |
| Property page (gallery, amenities, policies, reviews, room grid) | ✓ | ✓ |
| Multiple rate plans (refundable / non-ref / breakfast / mobile / LOS) | ✓ | ✓ |
| Verified-guest reviews | ✓ | ✓ |
| Free cancellation + non-refundable | ✓ | ✓ |
| Pay online vs pay-at-property | ✓ | ✓ **+ deposit + wallet** |
| Genius loyalty (host-funded tiers) | ✓ | ✓ (Paymax **Stays loyalty**) |
| Mobile-only rates | ✓ | ✓ |
| In-app chat with property | ✓ | ✓ |
| Hotelier Extranet + Pulse app | ✓ | ✓ (`stays-extranet`) |
| Visibility Booster / Preferred Partner | ✓ | ✓ (Phase 3) |
| **Naira settlement to local hotels** | ✗ (limited) | **✓** |
| **Wallet checkout (no card needed)** | ✗ | **✓** |
| **Agent-assisted offline booking** | ✗ | **✓** |
| **Instant refund to wallet** | partial | **✓** |
| **Cross-sell: ride to hotel + travel insurance** | partial | **✓ (super-app)** |

---

## 5. Supply strategy — dual rail

### 5.1 Rail A — Bedbank / aggregator API (breadth, instant)
Consume one aggregated supplier API for global + regional inventory. Candidate suppliers and their fit:

| Supplier | Model | Fit for Paymax |
|---|---|---|
| **RateHawk (ETG)** | Aggregator of 200+ suppliers; net rates; **no IATA required**; HMAC auth | Strong default — widest coverage, emerging-market depth, fast onboarding |
| **WebBeds / DOTW** | Bedbank, **MEA strength** | Regional depth for Africa/Middle East |
| **Hotelbeds (APItude)** | Direct bedbank, 300k+ hotels | Leisure/global depth; heavier content mgmt |
| **TBO** | Bedbank, emerging-market depth | Secondary breadth |
| **ZentrumHub (aggregator-of-aggregators)** | One normalised API over 100+ suppliers, **Vervotech dedup**, sub-second | Fastest path to multi-supplier breadth without N integrations |

> **Recommendation (D-1):** start with **one aggregator** (RateHawk or ZentrumHub) for net-rate breadth + dedup, to avoid building N supplier integrations and mapping from scratch. Add WebBeds for MEA depth in Phase 3.

Rail A mechanics: net rate + Paymax markup; two-step **prebook (price/availability re-check) → book**; content via supplier content API cached locally; cancellation/modification via supplier API.

### 5.2 Rail B — Direct local extranet (depth, margin, Naira)
A Paymax-operated **extranet + lightweight channel manager** that onboards Nigerian hotels not on bedbanks. Hotels self-manage content, room types, rate plans, ARI calendar, promotions, and reservations; Paymax settles them in **Naira** and supports **pay-at-property/deposit**. This is the Booking.com Extranet/Pulse equivalent and the source of unique local inventory + better margin.

### 5.3 Dedup / mapping layer
Same hotel can appear from Rail A and Rail B (or multiple Rail-A suppliers). A **mapping service** (Vervotech-style: name + geo + address + fuzzy signals) collapses duplicates so each property shows **once**, **best bookable rate wins**, with a clear source attribution internally. Mapping conflicts route to an admin **mapping queue**.

---

## 6. System architecture — REUSE vs NET-NEW

### 6.1 REUSE — existing platform & property-suite primitives

| Primitive | Hotel booking use |
|---|---|
| **Identity / SSO (single-identity, multi-capability)** | Guest, Hotelier, Agent = capabilities on one `User`. No duplicate accounts. |
| **KYC** | Optional/tiered: guest KYC only for high-value/anti-fraud; **hotelier KYC + business verification mandatory** for direct rail + payouts. |
| **Wallet ledger (append-only)** | Booking pay = debit; refund = reversing credit; hotel payout = settlement entry. Balances derived, never mutated. |
| **Virtual accounts** | Fund-on-demand top-up when wallet short at checkout. |
| **Payouts** | Naira settlement to direct hotels; supplier remittance for Rail A. |
| **Agent network** | Assisted/offline booking; agent commission via existing agent ledger. |
| **Notifications** | Booking confirmation, reminders, check-in, cancellation, review prompt, hotelier new-reservation alerts. |
| **Document store (signed URLs)** | Booking vouchers, invoices, hotel content media, hotelier verification docs. |
| **Reviews infrastructure (property suite)** | Verified-guest reviews shared with shortlet/marketplace. |
| **Search / media / map (property suite)** | Shared search index, media pipeline, PostGIS geo. |
| **Transport module** | Cross-sell: ride/airport pickup to the booked hotel. |
| **Insurance module** | Cross-sell: travel/personal-accident cover at checkout (MyCover rail). |
| **Audit log** | Immutable record of every reservation/ARI/payout state change. |

### 6.2 NET-NEW — what we build

| Component | Responsibility |
|---|---|
| **`stays-svc` (Go)** | Domain owner: properties, room types, rate plans, reservations, cancellations, reviews-binding. Source of truth for booking state. |
| **`supply-gateway` (Go)** | Provider-agnostic abstraction. One interface; adapters: `BedbankAdapter` (Rail A) + `DirectInventoryAdapter` (Rail B). Search fan-out, prebook, book, cancel, content sync. **Mirrors `MapService`/`underwriter-gateway`.** |
| **`ari-svc` (Go)** | Availability/Rates/Inventory engine for the **direct rail**: calendar, restrictions (min/max LOS, CTA/CTD, stop-sell), rate plans, promotions, derived/linked rates. |
| **Mapping/dedup service** | Cross-supplier hotel identity resolution; admin mapping queue. |
| **Pricing engine** | Net-rate + markup, taxes/levies, FX & display currency, mobile rate, LOS discount, loyalty, promo stacking rules. |
| **Reservation orchestrator** | Guarded booking state machine; two-step prebook→book saga with wallet hold/charge; idempotent. |
| **Settlement & reconciliation** | Hotel payouts (direct), supplier reconciliation (Rail A), commission ledger. |
| **`stays-extranet` (web)** | Hotelier console: content, ARI, promotions, reservations, finance, analytics. |
| **`stays-admin` (web)** | Ops: supplier/connectivity, property moderation, mapping queue, reservation support, refund/dispute, reconciliation, pricing rules, loyalty, fraud, CMS. |

---

## 7. Provider-agnostic supply gateway

One interface; rails behind adapters; routing/dedup by config. Same shape as `MapService`.

```go
type SupplyGateway interface {
    Search(ctx, SearchRequest)        ([]PropertyOffer, error)   // fan-out across rails, dedup, merge
    GetContent(ctx, propertyRef)      (PropertyContent, error)
    Prebook(ctx, PrebookRequest)      (PrebookResult, error)     // re-check price+availability; returns book_token
    Book(ctx, BookRequest)            (Reservation, error)       // idempotent (idempotency_key + book_token)
    GetReservation(ctx, supplierRef)  (Reservation, error)
    Cancel(ctx, CancelRequest)        (Cancellation, error)
    Modify(ctx, ModifyRequest)        (Reservation, error)
    SyncARI(ctx, ARIEvent)            error                      // Rail B only: push availability/rates
}
// Adapters: BedbankAdapter (Rail A supplier), DirectInventoryAdapter (Rail B via ari-svc)
// New supplier = new adapter + config. No core change.
```

Design rules:
- **Two-step booking is mandatory.** `Prebook` re-validates live price + availability and returns a short-lived `book_token`; `Book` consumes it. This closes the price-drift and sold-out gaps that cause failed bookings.
- **Idempotency** on `Book`/`Cancel`/payout — retries never double-book or double-charge.
- **Normalised models** — supplier JSON never leaks past the adapter; the app sees one `PropertyOffer`, `Reservation`, `RatePlan`.
- **Graceful degradation** — a supplier timeout drops that rail from results, never blocks the whole search; the other rail still returns.
- **Money never moves before confirmation** — wallet is **held** at prebook, **charged** only on confirmed `Book`; failed book releases the hold (no debit).

---

## 8. Domain & data model

### 8.1 Core entities
```
Property            (hotel; source rail; mapped_id; geo; star; content)
RoomType            (per property; occupancy; bedding; size; photos)
RatePlan            (per room type; board; cancellation policy; refundability; mobile flag)
AvailabilityDay     (Rail B: room_type × date → allotment, closed flags)
RateDay             (Rail B: rate_plan × date → price, currency, min/max LOS, CTA/CTD)
Promotion           (early-bird, LOS, last-minute, mobile, loyalty; stacking rules)
Offer               (ephemeral search result: property+roomtype+rateplan+price+token)
Reservation         (durable; guest=User; supplier_ref; state; stay dates; price breakdown)
ReservationGuest    (lead guest + occupants)
PaymentIntent       (links to wallet ledger entries; method; status)
Cancellation        (policy snapshot; refund amount; ledger ref)
HotelPayout         (direct-rail settlement; Naira; ledger ref)
SupplierRemittance  (Rail A reconciliation record)
CommissionEntry     (Paymax revenue; separate ledger account)
Review              (verified-guest; binds to completed reservation)
HotelierProfile     (capability on User; property grants; verification)
MappingRecord       (cross-supplier property identity; confidence; status)
ConsentRecord       (NDPA; guest PII share to supplier/hotel)
```

### 8.2 Key tables (essential columns)

**`property`**
`id` · `source_rail` (BEDBANK|DIRECT) · `supplier_code` · `supplier_property_ref` · `mapped_property_id` (dedup key) · `name` · `geo` (PostGIS) · `address` · `city` · `star_rating` · `property_type` · `content_ref` · `status` (DRAFT|PENDING_REVIEW|ACTIVE|SUSPENDED) · `created_at` · `updated_at`
- Index: `geo` (GIST), `(city, status)`, `mapped_property_id`
- Unique: `(supplier_code, supplier_property_ref)`

**`reservation`**
`id` · `guest_user_id` (FK) · `property_id` · `room_type_id` · `rate_plan_id` · `source_rail` · `supplier_ref` (unique per supplier) · `state` (enum) · `check_in` · `check_out` · `rooms` · `occupancy` · `currency` · `gross_amount` · `tax_amount` · `net_rate` · `markup` · `payment_method` (WALLET|CARD|TRANSFER|PAY_AT_PROPERTY|DEPOSIT) · `cancellation_policy_snapshot` (jsonb) · `idempotency_key` (unique) · `book_token_ref` · `created_at` · `updated_at` · `version` (optimistic lock)
- Unique: `(source_rail, supplier_ref)`, `idempotency_key`
- Index: `(guest_user_id, state)`, `(property_id, check_in)`, `(state, check_in)`

**`rate_day`** (Rail B)
`rate_plan_id` · `date` · `price` · `currency` · `min_los` · `max_los` · `closed_to_arrival` · `closed_to_departure` · `stop_sell` · `updated_at`
- PK: `(rate_plan_id, date)`

**`availability_day`** (Rail B)
`room_type_id` · `date` · `allotment` · `sold` · `stop_sell` — derived bookable = allotment − sold, gated by stop_sell.

Constraints encode rules: no reservation `CONFIRMED` without a settled/authorised `PaymentIntent` (except pay-at-property which records a guarantee, not a charge); a review can't exist without a `COMPLETED` reservation for that guest+property; commission and net-rate remittance live on **different** ledger accounts.

---

## 9. Availability, rates & inventory (ARI)

**Rail A (bedbank):** live search per request (cached short-TTL); **prebook re-checks** price+availability; book confirms. Content (descriptions/photos/amenities/geo) synced from supplier content API into local store, refreshed on schedule.

**Rail B (direct, `ari-svc`):**
- Hotelier sets **room types**, **rate plans** (board basis, refundability, mobile), and a **calendar** of `rate_day` + `availability_day`.
- **Restrictions:** min/max LOS, closed-to-arrival (CTA), closed-to-departure (CTD), stop-sell, per date.
- **Derived/linked rates:** e.g. non-refundable = BAR − 10%; breakfast = room-only + fixed; managed as rules so a BAR change cascades.
- **Bulk edit:** date-range rate/availability/restriction updates.
- **Overbooking protection:** allotment decrement is transactional + row-locked at book time; sell beyond allotment is rejected.
- **Optional external channel manager / PMS push:** standard ARI ingestion so hotels already on a CM/PMS can sync; manual extranet is the default for the long tail.

---

## 10. Pricing engine

- **Rail A:** net rate (from supplier) + **Paymax markup** (rule-based) + applicable taxes/levies → display price. Markup rules by supplier, destination, star tier, season, loyalty tier (admin-configurable).
- **Rail B:** hotel's sell rate + **Paymax commission** (deducted at settlement, not added on top) + taxes.
- **FX & currency:** display in NGN by default with USD toggle; upscale hotels priced in USD/parallel-rate handled explicitly — store currency on every rate, convert at a controlled FX rate, never silently. (D-3: FX source + spread.)
- **Rate plan types:** BAR/flexible (free cancellation), non-refundable (cheaper), breakfast-included, **mobile-only rate**, **LOS discount**, **early-bird**, **last-minute**.
- **Loyalty (Paymax Stays):** tiered discount à la Genius — host/hotel-funded on direct rail; funded from margin on bedbank rail. Stacking rules enforced centrally (e.g. loyalty + mobile may stack to a cap; promos don't stack with non-ref below floor).
- **Best-price selection:** when dedup surfaces the same hotel from multiple rails, the engine picks the lowest **bookable** total (incl. taxes/fees) and records which rail won.

---

## 11. Booking lifecycle (state machine)

```
SEARCHING ─► OFFER_SELECTED ─► PREBOOK_OK ─► PAYMENT_HELD ─► BOOKING ─► CONFIRMED
   │              │               │              │              │          ├─► COMPLETED (post checkout) ─► REVIEWABLE
   │              │               │              │              │          ├─► CANCELLED_BY_GUEST ─► (refund per policy)
   │              │               │              │              │          ├─► CANCELLED_BY_HOTEL ─► (full refund + comp)
   │              │               │              │              │          └─► NO_SHOW (policy charge)
   │              │               │              │              └─► BOOK_FAILED ─► (release hold; no debit) ─► VOID
   │              │               │              └─► PAYMENT_FAILED ─► VOID
   │              │               └─► PREBOOK_FAILED (price drift / sold out) ─► re-quote or VOID
   └─► (offer TTL expiry)
```

On `BOOKING → CONFIRMED` (one transaction): persist `supplier_ref`, **charge** the held wallet amount (or record pay-at-property guarantee + deposit charge), decrement direct-rail allotment, generate voucher PDF, write commission entry, notify guest + hotel, audit.

On `BOOK_FAILED`: **release the wallet hold** — never leave a guest charged without a confirmed room. This is the single most important invariant (kills the "paid-but-unconfirmed" failure that plagues local incumbents).

---

## 12. Payments, money flows & settlement (the Nigeria differentiator)

**Payment methods at checkout:**
1. **Wallet (default)** — instant, no card. Insufficient → in-flow virtual-account top-up.
2. **Card / bank transfer** — via existing Paymax rails.
3. **Pay-at-property** — booking confirmed against a guarantee (wallet hold or deposit), balance paid at hotel.
4. **Deposit + balance** — common NG pattern (e.g. partial now, rest at check-in).

**Money flow (prepay, wallet):**
1. Prebook OK → **HOLD** on wallet (no debit yet).
2. Book confirmed → **CHARGE** (convert hold to debit). Book failed → **RELEASE** hold.
3. Direct rail → **HotelPayout** scheduled in Naira (net of commission) on the agreed cadence (e.g. post check-in / post checkout).
4. Bedbank rail → net rate remitted to supplier per supplier terms; Paymax keeps markup.

**Refunds:** cancellation within free-cancel window → **instant reversing credit to wallet**. Non-refundable → no refund (policy snapshot governs). Hotel-initiated cancel → **full refund + goodwill** (configurable).

**Commission/markup:** recorded on a **separate ledger account** from net rate / hotel payable; reconciled against supplier statements (Rail A) and hotel settlements (Rail B).

**Reconciliation:** every reservation's money legs (charge, payout, commission, refund) are matched against supplier/hotel statements; unmatched → reconciliation break → admin workbench. Break SLA < 0.5%.

> This spine is what makes "paid-but-unconfirmed" impossible: money is **held not charged** until the supplier confirms, refunds are reversing ledger entries (not manual ops), and hotel payouts are gated on confirmed + reconciled reservations.

---

## 13. Cancellation, modification & no-show

- **Policy snapshot** captured on the reservation at book time (free-cancel deadline, penalty schedule, non-ref flag) so later policy changes never alter an existing booking.
- **Free cancellation** before deadline → instant wallet refund.
- **Non-refundable** → clearly flagged pre-book; no refund.
- **Modification** (dates/occupancy) → re-prebook for delta; price difference charged/refunded via wallet.
- **No-show** → policy charge; hotelier can flag via extranet; disputes route to admin.
- **Hotel-side cancel / overbooking** → guest gets full refund + goodwill credit + assisted rebooking; hotelier reliability score impacted.

---

## 14. Reviews & ratings

- **Verified-guest only:** review unlocked after a `COMPLETED` reservation (binds to that reservation). Mirrors Booking.com's integrity model and shares the property-suite reviews infra.
- Sub-scores (cleanliness, staff, location, value, comfort, facilities, WiFi) + overall.
- Hotelier can respond from the extranet; reply rate feeds ranking.
- Moderation queue in admin (profanity, authenticity, fraud).

---

## 15. Search & ranking

- **Inputs:** destination (city/landmark/geo), dates, guests, rooms.
- **Filters:** price range, review score, star rating, property type, amenities (WiFi, parking, pool, AC, breakfast, airport shuttle), distance/location, free cancellation, deals, board basis, family/business tags.
- **Sort:** Top picks (default), price (low/high), review score, distance.
- **Ranking signals (transparent):** relevance to query + availability + content completeness + review score + conversion + commercial weighting (commission/Visibility Booster) as a secondary tiebreaker. Sold-out properties show greyed on map (red markers) like Booking.com.

---

## 16. Loyalty — Paymax Stays (Genius equivalent)

- Free, account-based tiers unlocked by booking activity (e.g. T1 after first stay, T2/T3 by volume in a rolling window).
- Tier perks: stacked discount on eligible rate plans (host/margin-funded), occasional free breakfast / late checkout / room upgrade (hotelier-offered), priority support.
- Tier badge + a "Loyalty deals" filter. Hotels opt in per rate plan; can pause for limited days/year (à la Genius).

---

## 17. Mobile app screen list (traveller) — React Native

> Reuses SSO/auth, wallet, notifications. Embedded cross-sell hooks into Transport + Insurance.

**A. Entry & discovery (7)**
1. Stays home / search entry (destination, dates, guests & rooms, recent searches)
2. Destination autocomplete (cities, landmarks, "near me")
3. Date range picker (calendar, flexible dates)
4. Guests & rooms selector (adults, children + ages, rooms)
5. Deals / offers hub (mobile rate, last-minute, loyalty)
6. Saved / wishlists
7. Nearby stays (geo, map-first)

**B. Results & filtering (5)**
8. Search results — list
9. Search results — map view (markers, sold-out state, price pins)
10. Filters (full screen)
11. Sort sheet
12. Empty/relaxed-criteria suggestions

**C. Property & rate selection (9)**
13. Property detail (gallery, headline, score, location snippet)
14. Photo gallery (full screen, categorised)
15. Amenities (full list)
16. Location & map (directions, nearby landmarks, distance)
17. Reviews list + sub-scores
18. Room types grid
19. Rate plan comparison (refundable vs non-ref vs breakfast vs mobile)
20. Room/occupancy detail sheet
21. Policies & house rules (check-in/out, cancellation, children, pets)

**D. Booking flow (12)**
22. Booking review / summary
23. Lead guest details (prefill from profile/KYC)
24. Occupant details (multi-room/guest)
25. Add-ons (breakfast, late checkout, airport pickup → Transport, travel insurance → Insurance)
26. Price breakdown (room, taxes, fees, discounts, FX note)
27. Payment method select (wallet / card / transfer / pay-at-property / deposit)
28. Wallet pay + top-up (virtual account) inline
29. Deposit / pay-at-property terms
30. Apply promo / loyalty
31. Final confirm (with prebook re-price notice if changed)
32. Processing / confirming (prebook→book)
33. Booking failure / auto-release notice (with retry/alternatives)

**E. Confirmation & trip management (10)**
34. Booking confirmed + voucher
35. Voucher / e-receipt (download, share)
36. Add to calendar / directions / ride to hotel (Transport CTA)
37. My bookings — upcoming
38. My bookings — past
39. My bookings — cancelled
40. Booking detail
41. Modify booking (dates/occupancy)
42. Cancel booking (policy + refund preview)
43. Refund status (wallet)

**F. Communication & support (5)**
44. Chat with property (in-app messaging)
45. Help center / FAQs
46. Contact support / raise issue (re a booking)
47. Dispute / "hotel has no record" fast-path (confirmation guarantee)
48. Notifications center

**G. Reviews & profile (6)**
49. Write a review (post-stay, verified)
50. My reviews
51. Profile / personal details
52. Loyalty (tier, perks, progress)
53. Saved payment & wallet overview (within stays context)
54. Travel documents / saved guests

**H. Agent-assisted (in traveller context) (4)**
55. "Book with an agent" entry
56. Agent-shared booking link / handoff
57. Pay for an agent-prepared booking
58. Agent booking confirmation

**Traveller app total: ~58 screens** (plus shared components reused from wallet/notifications).

---

## 18. Hotelier extranet (web) — `stays-extranet` (Booking.com Extranet/Pulse equivalent)

**A. Onboarding & verification (6)**
1. Hotelier sign-up (SSO → Hotelier capability)
2. Property registration (name, type, address, geo)
3. Business & identity verification (KYC + business docs, bank/payout details)
4. Property content setup wizard
5. Policies setup (check-in/out, cancellation, children, pets, deposit)
6. Go-live checklist / submit for review

**B. Content & inventory (8)**
7. Property profile / descriptions
8. Photos & media manager
9. Amenities & facilities
10. Room types (create/edit, occupancy, bedding, size)
11. Rate plans (board basis, refundability, mobile, derived/linked rates)
12. Calendar — availability & rates (month grid)
13. Bulk edit (date-range rates/availability/restrictions)
14. Restrictions (min/max LOS, CTA/CTD, stop-sell)

**C. Promotions & visibility (4)**
15. Promotions (early-bird, LOS, last-minute, mobile)
16. Loyalty (Paymax Stays) opt-in per rate plan
17. Visibility Booster (commission-for-ranking) — Phase 3
18. Opportunity center (recommendations to improve conversion)

**D. Reservations & guests (5)**
19. Reservations dashboard (arrivals, departures, in-house)
20. Reservation detail (guest, room, rate, payment status)
21. Modify / cancel / mark no-show
22. Inbox / messaging with guests
23. Reviews & responses

**E. Finance (5)**
24. Payouts (Naira) & statements
25. Invoices
26. Commission overview
27. Deposit / pay-at-property reconciliation
28. Bank / payout settings

**F. Analytics (4)**
29. Performance dashboard (occupancy, ADR, RevPAR)
30. Conversion & funnel
31. Booker insights (geos, devices, lead time)
32. Competitor/market rate context

**G. Account & staff (2)**
33. Users & roles (front-desk, revenue manager, owner)
34. Settings / notifications

**Extranet total: ~34 screens.** A mobile Pulse-style companion (new-reservation alerts, quick rate/availability edit, guest chat) reuses these as a thin subset.

---

## 19. Admin UI (Paymax ops) — `stays-admin`

**A. Overview & supply (6)**
1. Dashboard (GMV, bookings, take rate, conversion, supplier mix)
2. Supplier / connectivity management (Rail A adapters, health, credentials)
3. Mapping / dedup queue (cross-supplier identity conflicts)
4. Property moderation / approval queue (direct hotels)
5. Content QA / photo moderation
6. Inventory coverage map (cities, gaps)

**B. Reservations & support (5)**
7. Reservation search
8. Reservation detail / timeline
9. Manual confirm / force-cancel / rebook
10. Refund & dispute queue ("paid-but-unconfirmed" fast-path)
11. No-show / overbooking handling

**C. Money & pricing (6)**
12. Reconciliation workbench (supplier statements vs ledger)
13. Hotel payout management (Naira settlement)
14. Commission / markup rules engine (by supplier, destination, tier, season)
15. FX & currency config
16. Commission ledger / revenue
17. Settlement break resolution

**D. Growth & content (5)**
18. Loyalty (Paymax Stays) config
19. Promotions / campaigns
20. Reviews moderation
21. CMS (cities, landmarks, SEO/content)
22. Featured / merchandising slots

**E. Trust, risk & agents (4)**
23. Fraud / risk console (payment fraud, fake reviews, anomalous bookings)
24. Hotelier reliability scoring
25. Agent management & commissions
26. KYC / verification review (hoteliers)

**F. Platform (4)**
27. Users & roles (admin RBAC)
28. Audit log & exports
29. Feature flags / config
30. Notifications / templates

**Admin total: ~30 screens.**

---

## 20. Agent-assisted booking — `stays-agent` (~9 screens)

Captures the offline/assisted NG traveller. Agent acts on the customer's identity (never their own account holds the booking).
1. Customer lookup / select
2. Assisted search
3. Assisted property/room selection
4. Build quote / hold
5. Collect payment (cash → agent float → wallet; or send pay link)
6. Confirm booking on customer's behalf
7. Agent booking book (history)
8. Agent commission view
9. Assisted cancel / refund

---

## 21. Authorization (RBAC)

| Role / capability | Scope |
|---|---|
| Guest (User) | Own bookings/reviews; book, modify, cancel, review own only |
| Agent | Assisted bookings for customers; own book + commission; **no** access to arbitrary users' bookings |
| Hotelier (owner) | Own property/properties: content, ARI, reservations, finance |
| Hotel staff (front-desk / revenue mgr) | Scoped subset of their property (object-level) |
| Stays Ops | Reservation search, refunds/disputes, reconciliation |
| Stays Admin | Supplier config, mapping, pricing rules, moderation |
| Finance | Payouts, commission, settlement; read-only on guest PII |
| Auditor | Read-only audit + exports |

Object-level checks everywhere: *can this hotelier touch this property's calendar; can this guest cancel this reservation* — enforced in `stays-svc`, not the BFF. Suspending one hotelier's property never affects another's.

---

## 22. Trust, safety & fraud (Nigeria-specific)

- **Confirmation guarantee:** two-step prebook→book + held-not-charged money = no paid-but-unconfirmed bookings; dedicated guest fast-path if a hotel disputes a reservation.
- **Overbooking control:** transactional allotment decrement (direct rail); hotel-cancel triggers full refund + goodwill + assisted rebooking + reliability hit.
- **Payment fraud:** velocity checks, device signals, wallet/KYC gating for high-value, chargeback-resistant wallet flow.
- **Review integrity:** verified-guest only; fake-review detection.
- **Hotelier fraud:** business verification, payout held until first confirmed+completed stays, anomalous-rate alerts.
- **Data protection (NDPA 2023):** versioned consent before sharing guest PII with supplier/hotel; data minimisation; PII encrypted, never logged.

---

## 23. Non-functional requirements

| Area | Requirement |
|---|---|
| Search latency | Multi-rail fan-out + dedup < 2s p95 (cache + sub-second supplier where available) |
| Booking reliability | Two-step prebook→book; ≥ 99.5% confirm success; failed book never debits |
| Idempotency | Book/cancel/payout idempotent; retries no-op |
| Consistency | Wallet hold→charge saga; auto-release on failure |
| Availability | Per-rail graceful degradation; one supplier down ≠ search down |
| Concurrency | Direct-rail allotment row-locked; no oversell |
| Security | Per-supplier secret scoping; signed-URL media/vouchers; least-privilege |
| Observability | Structured logs/metrics/traces on every reservation & money leg |
| FX integrity | Every rate carries currency; controlled conversion; no silent FX |
| Testing | State machine + authZ + oversell + auto-release + refund paths covered; supplier sandbox contract tests |

---

## 24. Analytics & event taxonomy

`search_performed`, `results_viewed`, `filter_applied`, `property_viewed`, `rate_plan_viewed`, `prebook_attempted`, `prebook_ok`, `prebook_failed`, `payment_method_selected`, `wallet_held`, `book_attempted`, `book_confirmed`, `book_failed`, `wallet_charged`, `wallet_released`, `cancellation`, `refund_issued`, `review_submitted`, `hotel_payout`, `reconciliation_break`, `loyalty_tier_changed`, `cross_sell_ride`, `cross_sell_insurance`. Each carries `source_rail`, `city`, `payment_method`, `rate_plan_type` for funnel, attach, and supplier-mix dashboards.

---

## 25. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Paid-but-unconfirmed (trust killer) | Held-not-charged + two-step book + auto-release; **zero-tolerance release gate** |
| Price drift / sold-out between search and book | Mandatory prebook re-check; re-quote UX |
| Oversell (direct rail) | Transactional, row-locked allotment decrement |
| Duplicate listings across suppliers | Dedup/mapping (Vervotech-style) + admin mapping queue |
| Card rejection (NG) | Wallet-native checkout; cards optional |
| FX mispricing / parallel-rate exposure | Currency on every rate; controlled FX source + spread; explicit display |
| Thin local inventory at launch | Direct extranet onboarding drive + aggregator breadth from day one |
| Supplier lock-in | `supply-gateway` abstraction + config; add WebBeds/others without core change |
| Slow hotel payouts hurting supply trust | Clear Naira settlement cadence; reconciliation spine; statements in extranet |
| Refund disputes | Instant wallet refunds via reversing entries; policy snapshot on reservation |

---

## 26. Phased roadmap

**Phase 0 — Foundations.** `supply-gateway` + one **bedbank adapter** (RateHawk/ZentrumHub) in sandbox; wallet hold→charge→release saga; booking state machine; content sync + cache; dedup skeleton; D-1/D-3 decided.

**Phase 1 — Bookable v1 (Rail A).** Search/map/filters; property page; rate plans; prebook→book; wallet + card checkout; confirmation/voucher; my-bookings; cancel/refund; verified reviews; admin reservation support + reconciliation v1.

**Phase 2 — Direct rail + extranet (Rail B).** `ari-svc` + `stays-extranet` (content, calendar, rate plans, restrictions, reservations, payouts in Naira); pay-at-property + deposit; dedup live across rails; hotelier KYC + payout.

**Phase 3 — Growth & trust.** Paymax Stays loyalty; promotions; Visibility Booster; agent-assisted booking; cross-sell (ride-to-hotel, travel insurance); booker insights; fraud console; WebBeds/MEA depth.

**Phase 4 — Scale.** Channel-manager/PMS connectors for direct hotels; corporate/TMC; multi-currency expansion; merchandising; regional rollout.

---

## 27. Open decisions

| ID | Decision | Owner |
|---|---|---|
| D-1 | Primary Rail-A supplier (RateHawk vs ZentrumHub aggregator) + commercial terms | CEO + Product |
| D-2 | Markup/commission policy (Rail A markup %, Rail B commission %) per segment | Finance |
| D-3 | FX source + spread for USD-priced hotels; default display currency | Finance |
| D-4 | Hotel payout cadence (post check-in vs post checkout) and hold policy | Finance + Ops |
| D-5 | Loyalty funding split (host-funded vs margin-funded) per rail | Product + Finance |
| D-6 | Guest KYC threshold for high-value/anti-fraud bookings | Compliance |
| D-7 | Dedup confidence threshold + manual-review policy | Product + Data |

---

## 28. Appendix

### A. Error taxonomy (normalised, rail-agnostic)
`OFFER_EXPIRED` · `PREBOOK_PRICE_CHANGED` · `PREBOOK_SOLD_OUT` · `INSUFFICIENT_FUNDS` · `PAYMENT_FAILED` · `BOOK_REJECTED_BY_SUPPLIER` · `SUPPLIER_TIMEOUT` · `OVERSELL_BLOCKED` (direct) · `CANCELLATION_NOT_ALLOWED` (non-ref) · `DUPLICATE_REQUEST` (idempotent no-op) · `MAPPING_CONFLICT`.

### B. ARI / reservation sync events (Rail B)
`rate.updated` · `availability.updated` · `restriction.updated` · `stop_sell.toggled` · `reservation.created` · `reservation.modified` · `reservation.cancelled` · `no_show.flagged`. Idempotent ingest; audited.

### C. Supplier comparison (Rail A candidates)
- **RateHawk (ETG):** 2.5M+ properties via 200+ sub-suppliers; net rates; no IATA; HMAC auth; broad emerging-market coverage — strong default.
- **ZentrumHub:** aggregator-of-aggregators (100+ suppliers), one normalised API, Vervotech dedup, sub-second — fastest multi-supplier path.
- **WebBeds/DOTW:** bedbank with MEA strength — regional depth for Africa.
- **Hotelbeds (APItude):** 300k+ direct bedbank; leisure/global depth; heavier content management.
- **TBO:** emerging-market depth; secondary breadth.

### D. Supply gateway interface
See §7. New supplier = new adapter + config; dedup + best-bookable-rate selection sit above the adapters.

*Final supplier codes, content schemas, rate-plan mappings, cancellation-policy formats, payout cadences, and FX terms are seeded from supplier sandbox + hotelier onboarding during Phase 0–2.*
