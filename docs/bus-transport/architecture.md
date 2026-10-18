# Bus Transport — Architecture

## Boundary
Extend `backend/internal/transport/` (bus domain) — no new service. Sub-packages by seam:
- `busprovider` (onboarding/KYB) · `busroute` (geography, templates, fares) · `busfleet`
  (vehicles, layouts) · `businventory` (holds, segment occupancy) · `busticket`
  (booking, passengers, QR) · `busops` (manifest, check-in, status) · reuse `settlement`.

## Data model (additive migrations)
- `bus_geo_state`, `bus_geo_city`, `bus_terminal` — shared NG reference data.
- `bus_route_template` + `bus_route_stop` (seq, terminal, offsets, board/alight flags)
  + `bus_route_fare` (OD pair → kobo, effective range) + `return_route_id`.
- `bus_vehicle` (operator, plate, capacity, layout_id, status),
  `bus_seat_layout` + `bus_seat_layout_seat` (label,row,col,deck,type,blocked).
- `bus_departure` (schedule instance: route_version, bus, cutoff, status, snapshot).
- `bus_seat_hold` (departure, seat, segment [from_seq,to_seq), owner, expires_at).
- `bus_seat_occupancy` (departure, seat, from_seq, to_seq, booking_ref) —
  non-overlap enforced by locking seat rows + CHECK on seq + serialized insert txn;
  overlap test: `from_seq < new.to_seq AND to_seq > new.from_seq`.
- `bus_booking` + `bus_booking_leg` (return legs) + `bus_booking_passenger`
  (name/phone/delivery pref) + `bus_ticket` (uuid token, status).
- Reuse ledger/escrow for fare hold→settle; refund via existing compensation path.

## Flows
- Search → departures (route stops join) → hold (TTL, segment check) → paystack
  initiate (billingemail rule) → webhook verify → occupy + issue tickets → manifest/
  QR check-in → trip events → settlement batch.
- Provider: register → CAC adapter (reuse business onboarding pattern) → Tier-2
  kycverify gate → reviewer queue → approved ⇒ publish routes.

## Flags
`FEATURE_BUS_TRANSPORT_V2` + module-visibility row. Legacy flat routes keep working.
