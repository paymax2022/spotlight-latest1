# Bus Transport — Architecture Gap Analysis

Status: Phase 0 in progress. Sources verified by inspection on `main` @ 2026-10-17.
Legend: Exists / Partial / Missing / Broken / N/A.

## What already exists (verified)

### Backend — `backend/internal/transport/` (Gin, pgx, kobo-int money, escrow settlement)
- `bus.go` (659L): `BusBookRequest` (`POST /mobility/bus/book`, `seat_number` int),
  `BusRouteRequest`/`BusScheduleRequest` (admin route+schedule create),
  `SearchBusRoutes(origin, dest)` → `bus_routes WHERE status='active'`,
  `ListBusSchedules(routeID, date)` → `seats_left = total_seats − issued tickets`,
  fare gate `fare_approved=TRUE`.
- `bus_lifecycle.go` (894L): ticket machine `booked → issued(QR) → boarding → boarded →
  completed`; fare escrowed on book; deferred settlement until departure+grace.
- `bus_provider.go` (676L) + migration `20260907000000_bus_provider_marketplace.sql`:
  operator/provider marketplace surface.
- `bus_templates.go` (327L): route/schedule templates.
- Tests: `bus_wallet_*` live-DB suites, `bus_provider_test.go`.
- Seat uniqueness: partial unique index `bus_tickets_schedule_seat_active_uidx`
  (active tickets can't share seat per schedule) — whole-trip granularity only.

### Mobile — `mobile-app/reactnative/app/mobility/bus/`
- `index.tsx` (search), `results.tsx`, `seats.tsx`, `passenger.tsx`, `review.tsx`,
  `tickets.tsx`, `ticket/`, `provider/` (register at `/mobility/bus/provider/register`).
- API/hooks/utils: `src/features/mobility/api/bus.api.ts`, `busProvider.api.ts`,
  `busProvider.mock.ts`, `hooks/useBusMarketplace.ts`, `utils/busTicket.ts`.

### Cross-cutting to reuse
- Payments: `internal/transport/paystackcheckout` + `platform/billingemail` (#677 rule).
- Escrow/settlement: `internal/settlement` (EscrowExternal/RefundExternal pattern).
- KYB/KYC: `internal/finance/kycverify` (Dojah, fully automated post-#808); CAC checks
  exist under association/business onboarding — reuse adapter pattern.
- Audit: append-only audit events used across admin actions.
- Feature flags: `FEATURE_*` env + module-visibility registry.

## Gap mapping vs PRD

| PRD requirement | Status | Evidence / gap |
|---|---|---|
| Operator KYB + CAC gate before selling (§5) | Partial | `bus_provider` onboarding exists; verify whether CAC + Tier-2 KYC are enforced before publishing — audit needed on approval gate. |
| State machine for operator verification (§5.3) | Partial | bus_provider has status flow; PRD states (draft→approved/suspended/expired) and maker-checker need verification. |
| Geography model: states/FCT→city→terminal (§6) | Partial | `bus_routes` store origin/dest terminals; no shared NG state/locality reference model confirmed; client lists may be hard-coded. |
| Multi-stop route templates + OD fare matrix (§7.1) | **Missing** | `bus_routes` = origin→dest pair, flat admin fare. No intermediate stops, no per-pair pricing. |
| Return-route pairing (to-and-fro) (§7.2) | Missing/Partial | Not seen in route model; needed for the "To and fro" requirement the user called out. |
| Departure instances vs templates (§7.3) | Partial | `bus_schedules` are dated departures; booking horizon/generation job, versioned route snapshots not confirmed. |
| Seat layouts / decks / blocked cells (§8.2) | **Missing** | Seats are `seat_number` ints + `total_seats`; no layout builder, labels, blocked cells, layout versioning. |
| Segment-overlap inventory (§8.3) | **Missing** | `bus_tickets_schedule_seat_active_uidx` blocks resale for the WHOLE trip; no stop-segment intervals → under-sells multi-stop capacity AND the model can't express partial journeys. |
| Seat holds with TTL (§8.4) | **Missing** | Book escrows directly; no hold/expiry entity seen. |
| Book-for-another passenger (§9.3) | Partial | `app/mobility/bus/passenger.tsx` exists; verify purchaser≠passenger separation + delivery prefs. |
| Signed/non-guessable ticket token (§9.4) | Partial | QR = uuid (ok entropy); confirm not DB-sequential + ticket issuance idempotent on webhook replay. |
| Trip ops: manifest, check-in, status events (§11) | Partial | lifecycle has boarding/boarded states + `BusValidateRequest` (scan); manifest/check-in audit depth TBD. |
| Settlement batches/reconciliation (§12.4) | Partial | escrow settle on departure+grace exists; batch/reconciliation surface not confirmed. |
| Next.js operator portal modules (§10) | Partial/Missing | Check `frontend-web`/`frontend-admin` for bus-operator pages (fleet, layout designer, routes, manifest, financials). |
| Platform ops: KYB queue, geography admin (§10.2) | Partial | transport admin handlers exist (`admin*.go`); operator-review queue for bus TBD. |

## Risk register (initial)
- Segment inventory requires schema redesign (`seat_occupancy` interval rows + exclusion/lock strategy) — additive-only migration required, cannot alter `bus_tickets` uniqueness semantics destructively.
- Fare matrix + route versioning must snapshot into existing `bus_schedules`/`bus_tickets` without breaking sold inventory.
- Provider KYB: reuse `kycverify` (post-#808 fully automated); CAC adapter exists in business onboarding — verify transport-side reuse vs duplication.

## Next steps (Phase 0→1)
1. Finish audit: read bus_handler.go routes, bus_provider onboarding flow, web/admin surfaces, mobile bus screens vs mock layer.
2. Write `architecture.md` (domain boundaries inside `internal/transport` — no new service),
   `api-contract.md`, then schema migration set (geography, route_templates+stops+fares,
   seat_layouts, seat_occupancy, holds, booking legs/passengers).
3. Implement behind `FEATURE_BUS_TRANSPORT_V2` (or extend existing bus flag).
EOF_MARKER

## Audit round 2 (handler/service-level)

- `bus_handler.go` (~28 handlers): customer (`BusSearch`, `BusRoutes`, `BusSchedules`,
  `BusBook`, `BusTickets`, `BusTicketGet/Cancel`, `BusValidate` QR scan),
  provider (`Register`, `Me`, `Update`, route/schedule create, `Bookings` manifest,
  templates CRUD), admin (`AdminBus*`).
- `bus_provider.go`: `bus_providers.verification_status` — `verified` required for
  public search listing (`p.verification_status='verified'` in SearchBusTrips).
  Routes: `from_state/to_state/from_city/to_city + base_fare_kobo + amenities` —
  flat OD pair, single fare, NO intermediate stops, NO return pairing.
  Schedules: `total_seats + fare_kobo + fare_approved + cancel_cutoff_minutes`.
- Tickets already carry `passenger_name, passenger_phone, boarding_status, qr_code`
  → booking-for-another partially exists (per-ticket passenger fields).
- Web surfaces: `frontend-web/app/api/v1/transport` (BFF),
  `frontend-admin/app/admin/mobility/bus` (admin pages exist).
- CONFIRMED MISSING: vehicle/fleet entity, seat-layout model, seat holds,
  segment-overlap occupancy, multi-stop itinerary, OD-pair fare matrix,
  return-route relation, operator KYB/CAC workflow + review queue for bus,
  settlement batches, geography reference tables.
