# Hotel Booking / Stays — Build & Integration Plan (Property Suite)

Implements `docs/estate/PRD_Paymax_Hotel_Booking.md` INTO the existing repo as part of the **Property
Suite**. Brownfield: reuse platform + property-suite primitives; net-new = `stays` domain
(`stays-svc` + `supply-gateway` + `ari-svc`). Design system = existing `src/constants/*` tokens
(Plus Jakarta Sans, deep-purple/electric-blue, 16px radius) — same as realtor/property.

## 1. Reuse map (verified on disk — DO NOT rebuild)
- **Property suite surfaces it joins:** mobile `app/property` (hub) + `app/realtor/*` (search/shortlet/hotel)
  + `src/features/{realtor,property}`; backend `internal/{realtor,property,estate}`; admin `app/admin/realtor`.
  The property hub (`src/constants/modules.ts` PROPERTY_SUBMODULES) already has a **Stays** pillar — repoint
  it / add a Hotel entry to the new `/stays` hub.
- **Gateway pattern:** `backend/internal/maps/adapter.go` (small interfaces + adapters + `Resolve`).
  `supply-gateway` mirrors it: `BedbankAdapter` (Rail A) + `DirectInventoryAdapter` (Rail B, via ari-svc);
  search fan-out + dedup above the adapters. New supplier = adapter + config. Adapters under
  `backend/internal/provider/{bedbank,...}` or inside `internal/stays/gateway`.
- **Money:** `finance/{ledger,wallet,settlement,tiers,kyc,va}`. Booking = wallet **HOLD** at prebook →
  **CHARGE** on confirmed book → **RELEASE** on book failure (auto-release = the #1 invariant). Refund =
  reversing credit. Hotel payout (direct rail) = settlement entry in Naira. Commission on the existing
  separate `AccountCommission`; net-rate remittance on `AccountProviderClearing`. Kobo + idempotency keys.
  (If a true wallet "hold/authorization" primitive is absent, model HOLD as an escrow debit to
  `AccountEscrow` via `settlement.Escrow`, CHARGE = settle split, RELEASE = `settlement.Refund` — reuse it.)
- **AuthZ:** `middleware.RequireAuthContext` + `middleware.RequirePermission(rbac, "stays.*")` +
  `GetAuthenticatedUser`; object-level checks IN `stays-svc` (guest owns reservation; hotelier owns property).
- **Routes:** `Register(...)` aggregator like `realtor.Register` / `RegisterReferral`, wired in
  `app/finance_routes.go` under `FeatureStaysEnabled` (added). Member `finance.Group("/stays")` →
  `/api/finance/stays/*`; ops admin `r.Group("/api/stays/admin")`; hotelier extranet `r.Group("/api/stays/extranet")`;
  supplier webhooks `r.Group("/internal/webhooks")` → `/internal/webhooks/stays-supplier`.
- **Frontend-web proxy:** catch-all `frontend-web/app/api/v1/stays/[...path]/route.ts` →
  `proxyToGoBackend(req, '/api/finance/stays/<...>')`, gated by `featureFlags.stays()` (added).
- **Mobile:** Expo Router `app/stays/*` (traveller) reached from the property hub; feature lib
  `src/features/stays/*`; reuse `src/components/*` + `src/features/payments` (`usePurchasePayment` +
  `PaymentSheet`) for checkout (wallet/card/top-up); design tokens. Reuse realtor map/search components where useful.
- **Admin/extranet:** reuse `app/admin/connect/_ui.tsx`-style inline kit (new `app/admin/stays/_ui.tsx`);
  ops console `frontend-admin/app/admin/stays/*`; hotelier extranet `frontend-admin/app/extranet/*`
  (object-scoped hotelier capability). New services `staysAdminService.ts` + `staysExtranetService.ts`.
  `AdminSidebar.tsx` "Stays" section gated by `stays.*`.
- **Cross-sell reuse:** Transport (ride-to-hotel) + Insurance (travel cover at checkout) already exist —
  link out, don't rebuild. Reviews/search/media = property-suite shared infra.
- **Flags:** `FeatureStaysEnabled` (Go) + `featureFlags.stays()` (web) — DONE.

## 2. Invariants (NON-NEGOTIABLE, PRD §7/§11/§12/§22)
- **Two-step prebook→book mandatory.** Prebook re-checks live price+availability, returns short-lived
  `book_token`; Book consumes it. Closes price-drift / sold-out gaps.
- **Money held, not charged, until supplier confirms.** BOOK_FAILED → **release hold, no debit** (kills
  "paid-but-unconfirmed"). 0 unresolved release failures. Idempotent Book/Cancel/payout.
- **Oversell impossible (direct rail):** allotment decrement transactional + row-locked at book time.
- **Dedup:** same hotel from multiple rails shows once; lowest bookable total wins; conflicts → admin queue.
- **FX integrity:** every rate carries currency; controlled conversion; never silent. NDPA consent before
  sharing guest PII with supplier/hotel. Normalised models only past adapters (supplier JSON never leaks).
- **Commission** on a separate ledger account from net-rate/hotel-payable; reconciled; refund reverses commission.

## 3. Shared DB contract (SB0 OWNS; SB1 references — additive, RLS, FKs to auth.users(id), kobo BIGINT, PostGIS)
- `stays_property` (id, source_rail BEDBANK|DIRECT, supplier_code, supplier_property_ref,
  mapped_property_id, name, geo geography(Point), address, city, star_rating, property_type, content_ref,
  status DRAFT|PENDING_REVIEW|ACTIVE|SUSPENDED) — UNIQUE(supplier_code,supplier_property_ref); idx geo GIST,(city,status),mapped_property_id.
- `stays_room_type` (property_id, occupancy, bedding, size, photos jsonb).
- `stays_rate_plan` (room_type_id, board, cancellation_policy jsonb, refundable bool, mobile_only bool).
- `stays_reservation` (id, guest_user_id, property_id, room_type_id, rate_plan_id, source_rail,
  supplier_ref UNIQUE(source_rail,supplier_ref), state enum, check_in, check_out, rooms, occupancy jsonb,
  currency, gross_amount, tax_amount, net_rate, markup, payment_method, cancellation_policy_snapshot jsonb,
  idempotency_key UNIQUE, book_token_ref, created_at, updated_at, version) — idx (guest_user_id,state),(property_id,check_in),(state,check_in).
- `stays_reservation_guest`, `stays_payment_intent` (wallet ledger refs; method; status),
  `stays_cancellation` (policy snapshot; refund amount; ledger ref), `stays_offer` (ephemeral; ttl; book_token),
  `stays_consent` (NDPA), `stays_mapping_record` (cross-supplier identity; confidence; status).
- SB1 adds: `stays_rate_day` (PK rate_plan_id,date; price,currency,min_los,max_los,cta,ctd,stop_sell),
  `stays_availability_day` (room_type_id,date,allotment,sold,stop_sell), `stays_promotion`,
  `stays_hotel_payout`, `stays_supplier_remittance`, `stays_commission_entry`, `stays_review`,
  `stays_hotelier_profile`, `stays_review_response`, `stays_ari_event` (idempotent ingest).
- RBAC seeded by SB0: `stays.search.view`(public-ish), `stays.booking.manage`(own), `stays.admin.*`
  (supplier/mapping/moderation/pricing/recon/payout/refund/loyalty/fraud), `stays.hotelier.*` (object-scoped:
  content/ari/reservations/finance), `stays.agent.book`, `stays.finance.view`, `stays.audit.view`.

## 4. Booking state machine (PRD §11) + saga
SEARCHING→OFFER_SELECTED→PREBOOK_OK→PAYMENT_HELD→BOOKING→CONFIRMED→{COMPLETED→REVIEWABLE,
CANCELLED_BY_GUEST(refund per policy), CANCELLED_BY_HOTEL(full refund+goodwill), NO_SHOW(policy charge)};
BOOKING→BOOK_FAILED→(release hold, no debit)→VOID; PAYMENT_HELD→PAYMENT_FAILED→VOID;
PREBOOK_FAILED(price drift/sold out)→re-quote|VOID; OFFER ttl→expiry.
On BOOKING→CONFIRMED (one tx): persist supplier_ref, CHARGE held amount (or pay-at-property guarantee +
deposit charge), decrement direct allotment (row-locked), voucher PDF, commission entry, notify guest+hotel, audit.

## 5. Swarm split (disjoint files)
| Agent | Layer | Deliverable |
|---|---|---|
| **SB0** | Backend core | supply-gateway + Bedbank/Direct adapters + search/dedup; stays-svc domain; reservation orchestrator (prebook→hold→book→charge→release saga) + pricing; core migration + stays.* RBAC; RegisterStays + frontend-web proxy. |
| **SB1** | Backend ari/extranet/settle | ari-svc (rate/avail/restrictions/promotions, row-locked allotment, derived rates, bulk edit); hotelier extranet API; settlement (Naira payouts) + reconciliation + commission; reviews binding; supplier/ARI webhooks. New pkgs + migration + RegisterStaysExtranet. |
| **SM1** | Mobile discovery/book | §17 A(7)+B(5)+C(9)+D(12): search/map/filters, property/rate, booking flow w/ prebook→book + wallet pay (reuse payments) + deposit/pay-at-property + auto-release. Feature lib + StaysColors + property-hub entry. |
| **SM2** | Mobile trips/reviews/agent | §17 E(10)+F(5)+G(6)+H(4) + §20 agent(9): bookings, voucher, modify/cancel/refund, chat/support/fast-path, reviews/loyalty/profile, agent-assisted. Reuse SM1 lib. |
| **SA1** | Ops admin (~30) | §19 stays-admin: supply/connectivity, mapping queue, moderation, reservation support, reconciliation/payouts/pricing/FX/commission, loyalty/promotions/reviews/CMS, fraud/reliability/agents/KYC, RBAC/audit/flags. _ui + service + sidebar. |
| **SA2** | Hotelier extranet (~34) | §18 stays-extranet: onboarding/verification, content/inventory, calendar/ARI grid + bulk edit + restrictions, promotions/loyalty, reservations/guests/messaging/reviews, finance (Naira), analytics, account/staff. Object-scoped hotelier. extranet service + nav. |

Orchestrator wires: Register fns in finance_routes.go, frontend-web proxy, mobile property-hub + modules entry,
admin sidebar Stays + extranet nav, stays-ci.yml, trackers.

## 6. Production-grade bar (DoD)
- Full PRD screen coverage, loading/empty/error/success; supplier/underwriter-equivalent + FX disclosed.
- Money: kobo, idempotency, hold→charge→release saga w/ auto-release, commission separate account, Naira payouts.
- Two-step prebook→book; dedup best-rate; row-locked allotment (no oversell); NDPA consent; graceful per-rail degradation.
- Mock/live switch (mobile `EXPO_PUBLIC_STAYS_USE_MOCK`, admin `NEXT_PUBLIC_STAYS_USE_MOCK`, backend
  `FeatureStaysEnabled` + supplier sandbox); TS + gofmt clean; CI build/test + tsc + additive-migration guard.
