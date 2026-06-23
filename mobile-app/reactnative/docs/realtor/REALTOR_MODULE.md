# Spotlight Realtor — Module (V1: Connected Funnel Slice)

Faithful extension of the existing Paymax super-app. Implements the headline
**discovery → occupancy** funnel of the proptech spec:

> Marketplace home → Search/Filter → Listing detail → Book inspection →
> Inspection detail → Apply for rental → Application review

Built on the spec's core abstraction: **one property graph, many offering modes**
(`Portfolio → Property → Unit → Room`, each Unit carrying pluggable offering
modes `for_sale | for_lease | long_rent | short_stay`). A `Listing` is the
marketplace projection of a Unit in one mode; the funnel connects Listing →
InspectionBooking → RentalApplication.

## What shipped (this pass)

15 screens, 5 module components, a typed mock-flagged data layer, two state
stores, and an additive Supabase migration.

### Screens (`app/realtor/`)

| Spec | Screen | File |
|---|---|---|
| D1–D29 | Marketplace home (featured / verified / popular areas / newest / recently viewed) | `index.tsx` |
| E1–E30 | Search + results (list/grid/sort) | `search/index.tsx` |
| E1–E19 | Filter sheet (type, bedrooms, price, furnishing, amenities, verified/escrow toggles) | `search/filters.tsx` |
| F1–F30 | Listing detail (gallery, price + fee breakdown, trust panel, agent card, amenities, similar, sticky CTA) | `listing/[id]/index.tsx` |
| F2 | Photo gallery (paged) | `listing/[id]/gallery.tsx` |
| H1–H8 | Book inspection (viewing type, date/slot picker, attendee) | `inspection/book.tsx` |
| H9 | Inspection booked (success) | `inspection/booked.tsx` |
| — | My inspections (list) | `inspection/index.tsx` |
| H10–H26 | Inspection detail (status, directions, agent, **convert→application**) | `inspection/[id].tsx` |
| J1–J12 | Apply for rental (personal / employment / guarantor / screening consent) | `apply/index.tsx` |
| J11–J12 | Application review + submit | `apply/review.tsx` |
| J13 | Application submitted (success) | `apply/submitted.tsx` |
| J21 | My applications (list) | `application/index.tsx` |
| J14–J17 | Application review/status (timeline, documents) | `application/[id].tsx` |

Each screen renders the four states — loading / empty / error / success — via the
shared `StateView`.

### Module components (`src/features/realtor/components/`)

New only where nothing existing fit; each matches the fx-module file/style:

- `PropertyCard` — the most-reused surface (home rails, results, similar, saved); `feed` + `rail` variants; trust signals prominent.
- `StatusBadge` — tone-based pill driving every status surface (verification, listing, inspection, application).
- `VerificationBadge` — anti-scam trust chip (wraps `StatusBadge`).
- `AmenityChip` — soft-tinted icon pill.
- `DetailRow` — label↔value row for fee breakdowns / summaries / reviews.

### Data layer (`src/features/realtor/`)

- `types/realtor.types.ts` — property graph + funnel entities. **Money is integer minor units (kobo)**; every status is an explicit union.
- `constants/realtor.constants.ts` — label maps + filter option lists (single source of copy).
- `utils/realtorFormatters.ts` — ₦ formatting, mode-aware price labels, `newIdempotencyKey`.
- `api/realtor.api.ts` — typed wrapper, `USE_MOCK` flag (mirrors `fx.api.ts`); funnel mutations carry an `Idempotency-Key`.
- `api/realtor.mock.ts` — realistic NG inventory (Lekki, Yaba, Maitama, VI, Gbagada, Ikeja).
- `hooks/useRealtor.ts` — React Query hooks (mirrors `useFx.ts`).
- `store/searchStore.ts`, `store/applyStore.ts` — zustand (mirrors `authStore`), so multi-screen flows share state without threading complex router params.

## Reuse map (existing components consumed — not rebuilt)

`StateView` ×10 · `ScreenHeader` ×9 · `PrimaryButton` ×9 · `SectionHeader` ×5 ·
`SelectField` ×3 · `TextInputField` ×2 · `SearchBar` ×2 · `SegmentedControl` ×1.
All theming via `@/constants/{colors,typography,spacing,radius,shadows}` — **no
hardcoded colours/spacing/fonts** (the few literal rgba values are image-overlay
scrims, consistent with `SegmentedControl`/`SelectField` which do the same).

## Data model & API (contract)

Entities: `Portfolio, Property, Unit, Room, OfferingMode, Listing,
InspectionSlot, InspectionBooking, RentalApplication`.

Endpoints the wrapper targets when `USE_MOCK=false`:

```
GET  /v1/realtor/home
GET  /v1/realtor/listings            (filter params)
GET  /v1/realtor/listings/{id}
GET  /v1/realtor/listings/{id}/similar
GET  /v1/realtor/listings/{id}/inspection-slots
POST /v1/realtor/inspection-bookings           (Idempotency-Key)
GET  /v1/realtor/inspection-bookings
GET  /v1/realtor/inspection-bookings/{id}
POST /v1/realtor/inspection-bookings/{id}/cancel
POST /v1/realtor/applications                  (Idempotency-Key)
GET  /v1/realtor/applications
GET  /v1/realtor/applications/{id}
```

Migration: `supabase/migrations/20260620000000_realtor_property_graph.sql`
(additive only: 8 tables, indexes, RLS — published listings public; funnel rows
private to owner; unique constraint blocks inspection double-booking).

## Trust & escrow (built into the slice)

Verification level is surfaced on every card and the detail trust panel;
unverified listings are explicitly marked (`ShieldAlert`/warning tone). Escrow
protection is shown on cards, in the fee breakdown ("refundable, held in
escrow"), and on the application review ("no payment now; deposit held in escrow
until move-in") — the anti-scam + deposit-dispute thesis, not an afterthought.

## Connected funnel hand-offs

- Listing detail CTA routes to inspection (if required) or directly to apply.
- Completed inspection shows **"Apply for this property"** carrying `inspectionId`.
- Application carries the originating `inspectionId`; review screen shows the
  move-in cost with the escrow note before submit.

## V2 / V3 build-out (added after the V1 slice)

The funnel was extended end-to-end and the owner + short-stay + AI + admin
surfaces were built. 30 realtor screens total now; shared-component reuse rose to
21× each for `StateView` / `ScreenHeader` / `PrimaryButton` (plus `PaymentMethodSelector`
reused for both lease payment and shortlet checkout).

**V2 — lease → occupancy** (`app/realtor/lease/[id]/*`): lease preview → e-sign →
rent/deposit payment (escrow) → payment success → move-in checklist → occupancy
activated. Data layer `realtorLease.api.ts` (+ hooks); additive migration
`20260620010000_realtor_lease_payments.sql` (leases, invoices, idempotency-keyed
payments, escrow deposits, move-ins). Reachable from an approved application.

**V2 — owner side** (`app/realtor/owner/*`): owner financial cockpit (rent
collected, occupancy, void rate, arrears, deposits-in-escrow, payout, NOI) →
create property → add unit → configure offering modes → **void optimization**
(auto-list vacant units as shortlet, with a long-term-conflict guard). Reachable
from the marketplace-home landlord banner.

**V3 — shortlet** (`app/realtor/shortlet/*`): date/guest selection → live quote
(nightly + cleaning + refundable escrow deposit) → pay → confirmed (access code)
→ booking detail. The listing-detail `short_stay` CTA routes here.

**V3 — AI + admin**: `app/realtor/ai/listing-assistant.tsx` generates a
structured listing title/description/tags + price band (mock mirrors the LLM
output shape for a drop-in real call); `app/realtor/admin/moderation.tsx` is an
on-call listing-approval queue with AI risk flags, approve/reject.

## Data layer status — fully wired (mock + real)

Every realtor data layer now has both a mock branch and a real Supabase branch,
gated by one env-driven flag: `EXPO_PUBLIC_REALTOR_USE_MOCK` (default **mock**, so
the dev sandbox runs with no backend; set `=false` to hit Supabase + the AI
route). Helper: `src/features/realtor/api/realtorEnv.ts`.

Real branches:
- **Funnel** (`realtor.api.ts`) — reads/writes the property-graph + funnel tables via `realtor.mapper.ts`.
- **Lease/payment** (`realtorLease.api.ts`) — reads tables; **money path via atomic RPCs** `realtor_sign_lease` and `realtor_pay_invoice` (idempotency-keyed, escrow + move-in created in one transaction).
- **Owner** (`realtorOwner.api.ts`) — graph reads/writes; aggregates via `realtor_owner_dashboard` RPC; get-or-create portfolio on first property.
- **Shortlet** (`realtorShortlet.api.ts`) — quote from listing; **booking via `realtor_create_shortlet_booking` RPC** guarded by a DB `EXCLUDE` constraint (no double-booking).
- **Admin** (`realtorAdmin.api.ts`) — moderation queue from `pending_verification` listings; approve/reject updates status + verification.
- **AI** (`realtorAI.api.ts`) — posts to the secure Next.js route below; same structured shape as the mock.

SQL: `supabase/migrations/20260620020000_realtor_backend_rpcs.sql` adds the
shortlet table + four `SECURITY DEFINER` RPCs (each checks `auth.uid()` ownership).

### AI assistant — real Claude call

`frontend-web/app/api/v1/realtor/ai/listing-copy/route.ts` proxies to the
Anthropic Messages API **server-side** (key never reaches the client), gated by
`featureFlags.realtor()` and `requireRequestUser`. Env: `FEATURE_REALTOR_ENABLED`,
`ANTHROPIC_API_KEY`, `ANTHROPIC_REALTOR_MODEL` (default `claude-haiku-4-5`).

### CI

`.github/workflows/realtor-ci.yml`: scoped + full mobile typecheck
(`tsconfig.realtorcheck.json`), frontend-web typecheck + lint (covers the AI
route), and an additive-only migration guard.

## Maintenance triangle (V2) — tenant ↔ manager ↔ vendor

A three-party repair SLA whose costs roll up to the owner cockpit. 5 screens:

- **Tenant** (`app/realtor/maintenance/*`): dashboard (list), report-issue wizard
  (category grid, urgency with an emergency-bypass note, description, photos), and
  ticket detail with a full **status-machine timeline**, vendor card, quote
  approve/reject, completion evidence, confirm-completion, and rating.
- **Vendor** (`app/realtor/vendor/*`): jobs list and job detail with
  stage-specific actions (accept → submit quote → start → upload evidence → mark
  completed).

Status machine: `submitted → manager_review → vendor_assigned → quote_submitted
→ quote_approved → in_progress → completed → tenant_confirmed → closed`
(+ `quote_rejected` / `cancelled`). Emergencies bypass the approval gate per the
iron-rule exception.

Data: `realtorMaintenance.api.ts` (+ hooks) — mock by default, real branch hits
`realtor_maintenance_requests` (migration `20260620030000`) with three RLS
policies (tenant owns; assigned vendor reads/updates; property owner reads).
Reachable from the marketplace-home "Maintenance" / "Vendor jobs" shortcuts.

## Hotel + channel sync (V3)

8 screens (`app/realtor/hotel/*`, `app/realtor/channel-sync.tsx`): hotel search,
hotel detail (room types + rate plans), book (dates/guests/pay), confirmed,
reservation (check-in QR), front desk (KPIs + arrivals), room status board
(tap-to-update), and a channel-sync dashboard (connect/disconnect, run sync,
double-booking conflicts). Data: `realtorHotel.api.ts` (+ hooks) — mock + real;
hotel booking is availability-safe via `realtor_book_hotel_room` (migration
`20260620040000`). Reachable from the home "Hotels" / "Channel sync" shortcuts.

## AI layer (V3)

`realtorAI.api.ts` covers listing-copy generation, **maintenance triage**
(wired into the report screen), and **dynamic shortlet pricing**. All real calls
go through secure Next.js routes (`/api/v1/realtor/ai/listing-copy` and
`/api/v1/realtor/ai/assist`) that proxy to Claude server-side.

## Admin web portal (frontend-admin)

`frontend-admin/app/admin/realtor/*`: Overview (KPIs), Listing moderation
(approve/reject with risk flags), Verification queue (owner/agent/developer/
vendor/property), and Payments & escrow. Mock-backed
(`NEXT_PUBLIC_REALTOR_ADMIN_USE_MOCK`, default mock) via
`src/services/realtorAdminService.ts`, registered in the admin sidebar under a
"Realtor" section. Mirrors the fx/crowdfunding admin conventions.

## Going live (flip to real)

See `REALTOR_GO_LIVE.md` for the full runbook.

1. `supabase db push` (applies the three additive realtor migrations).
2. Seed/insert listings (or onboard owners via the create-property flow).
3. Set `FEATURE_REALTOR_ENABLED=true` + `ANTHROPIC_API_KEY` on the web server.
4. Set `EXPO_PUBLIC_REALTOR_USE_MOCK=false` in the mobile env.

## Still planned (per phasing)

Hotel multi-room inventory (P) + channel sync (AB), the maintenance triangle
(Y/Z) + tenant occupancy dashboard (L), the real LLM call behind the AI
interface, and the full admin/operations **web** portal (`frontend-admin`). The
data model and navigation are shaped to accept these without rework.
