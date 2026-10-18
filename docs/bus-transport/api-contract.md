# Bus Transport — API contract (draft, maps to existing /mobility/bus/* style)

Customer: GET /mobility/bus/search?from_state&to_state&date&pax&return ·
GET /mobility/bus/departures/:id (stops, fare quote) ·
POST /mobility/bus/holds {departure_id,seat_ids,from_seq,to_seq} (Idempotency-Key) ·
DELETE /mobility/bus/holds/:id · POST /mobility/bus/book {hold_id,legs[],passengers[]}
→ booking_ref · POST /mobility/bus/paystack/initiate · GET /mobility/bus/tickets/:ref ·
POST /mobility/bus/bookings/:ref/cancel.

Provider: POST /mobility/bus/provider/register (+CAC rc, rep kyc) ·
GET /provider/me (verification status/history) · CRUD /provider/{vehicles,layouts,
routes,stops,fares,schedules} · GET /provider/departures/:id/manifest ·
POST /provider/checkin {ticket_token,stop_seq} · POST /provider/trips/:id/status.

Platform: GET /admin/bus/kyb-queue · POST /admin/bus/operators/:id/{approve,reject,suspend}
· CRUD /admin/bus/geo/* · GET /admin/bus/reconciliation · settlement batch ops.
Errors follow existing CodedError/httperr shape; money in kobo; Idempotency-Key on all mutations.
