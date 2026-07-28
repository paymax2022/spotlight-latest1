# Build Contract — Business Logistics + Event Transport (final modes)

> Extends `BUILD-CONTRACT.md` / `-MODES.md`. Same rules: kobo ints, idempotency keys, escrow via the `settlement` service, guarded transitions, object-level authz, audited admin. Base: `/api/finance` (customer/driver), `/api/finance/admin/transport` (admin). Reuse drivers (couriers), parcel patterns, bus_schedules, `transport_pricing_config` (service_types `business_logistics`, `event_transport`), safety, ratings. Gate behind `FEATURE_TRANSPORT_MODES_ENABLED` (or a dedicated flag).

## BUSINESS LOGISTICS
Business owner = a Paymax user with a `business_accounts` row. Billing: prepaid wallet (escrow per delivery) or monthly invoice (accrue, settle at period close).

Delivery state: `created → assigned → picked_up → delivered` · (failed / cancelled). Batch state: `created → dispatched → in_progress → completed / partially_failed`.

| Method | Path | Notes |
|---|---|---|
| POST | `/mobility/business/accounts` | create/register business account `{name,account_type,billing_mode,cod_enabled}` |
| GET | `/mobility/business/accounts/me` | owner's account |
| POST | `/mobility/business/deliveries` | single delivery `{pickup,dropoff,receiver,size,cod_kobo}` → escrow (prepaid) or accrue (invoice) |
| POST | `/mobility/business/batches` | bulk: `{name, deliveries:[...]}` (CSV parsed client-side → array) → creates batch + N deliveries |
| GET | `/mobility/business/batches` / `/:id` | list / detail (with stops) |
| GET | `/mobility/business/deliveries?status=` | tracking dashboard |
| POST | `/mobility/business/deliveries/:id/cancel` | refund/void |
| GET | `/mobility/business/invoices` | monthly invoices |
| GET | `/mobility/business/analytics` | counts, success rate, COD totals |
| GET | `/driver/business/requests` · POST `/driver/business/:id/accept` · `/picked-up` · `/deliver` `{dropoff_pin?,proof_url}` · `/fail` `{reason}` |
| Admin | `/admin/transport/business/accounts` (list/status), `/business/deliveries`, `/business/invoices` (issue/mark-paid) — audited |

Proof of delivery (proof_url and/or dropoff PIN) required to mark `delivered`; settles courier split (prepaid) or marks invoice-accrued. Failed delivery records `failure_reason`; batch rolls up to `partially_failed`.

## EVENT TRANSPORT (Spotlight)
Organizer (event owner) publishes `event_transport_offers` tied to a Spotlight `event_id` (loose ref). Riders book seats; ticket+ride bundle links a `ticket_ref`. Group ride / fan bus / shuttle / artist / crew / equipment van. Fan bus may link a `bus_schedule_id`.

Offer state: `draft → open → full → departed → completed` · (cancelled). Booking state: `booked → confirmed → boarded → completed` · (cancelled / refunded).

| Method | Path | Notes |
|---|---|---|
| GET | `/mobility/events/:event_id/transport` | list transport offers for an event |
| POST | `/mobility/events/transport` | organizer creates an offer `{event_id,type,title,venue,capacity,fare_kobo,departure_time,bus_schedule_id?}` |
| POST | `/mobility/events/transport/:id/book` | book seats `{seats,ticket_ref?,idempotency_key}` → escrow→settle organizer; QR issued; increments booked_count; `full` when capacity reached |
| GET | `/mobility/events/transport/:id` | offer detail |
| GET | `/mobility/events/bookings` | my event bookings (QR) |
| POST | `/mobility/events/bookings/:id/cancel` | refund per rules |
| POST | `/driver/events/validate` | `{qr_code}` → boarded (organizer/driver) |
| Admin | `/admin/transport/events/offers` (list/status), `/events/bookings` (list), promo + post-event surface — audited |

Venue geofencing (geofence_radius_m) and post-event pickup zone are surfaced to the client from the offer; capacity enforced server-side (reject when `booked_count >= capacity` → 409). Bundle = booking carries `ticket_ref`.

## Mobile / Admin / OpenAPI
- Mobile: business logistics dashboard (create/bulk/track/invoices/analytics) under `app/mobility/business/`; event transport (event rides, fan bus, group ride, bundle, my bookings) under `app/mobility/events/`. Reuse mobility api/mock pattern + design tokens.
- Admin: `app/admin/mobility/{business,events}/page.tsx` reusing the admin shell + service pattern.
- Add paths to `contracts/openapi.yaml` under tags `[Mobility Logistics]`, `[Mobility Event]`.
