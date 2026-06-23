# Build Contract — Multi-modal expansion (parcel · bus · towing · movers · car hire)

> Extends `BUILD-CONTRACT.md`. Same rules: money in kobo, idempotency keys on money mutations, escrow via the existing `settlement` service, guarded state transitions, object-level authz, every screen handles all states. Base: `/api/finance` (customer/driver), `/api/finance/admin/transport` (admin, gated + audited). Reuse `drivers` (couriers/operators/movers are drivers with the matching `service_categories`), `transport_pricing_config` (per `service_type`), `safety_incidents`, `trip_ratings`.

## Escrow rule (all jobs)
Book → `Escrow(payer, "parcel:<id>"|"towing:<id>"|"mover:<id>"|"carhire:<id>", idemKey, "transport", fare)`. Release with `Settle(split)` **only on proof of completion** (POD/PIN/QR/confirmation). Cancel/fail → `Refund`. Bus tickets settle to the operator on issue (fixed fare, admin-approved).

## PARCEL DELIVERY — state machine
`created → courier_assigned → pickup_pin_verified → picked_up → in_transit → dropoff_verified → delivered` · (failed / disputed / cancelled)
| Method | Path | Notes |
|---|---|---|
| POST | `/mobility/parcels/estimate` | `{pickup,dropoff,category,size,speed,declared_value_kobo}` → fare (distance×size×speed) |
| POST | `/mobility/parcels` | book + escrow; generates pickup_pin + dropoff_pin; `prohibited_ack` required |
| GET | `/mobility/parcels/:id` | detail (sender sees PINs) |
| GET | `/mobility/parcels` | sender's parcels |
| POST | `/mobility/parcels/:id/cancel` | refund |
| GET | `/driver/parcels/requests` | open courier requests |
| POST | `/driver/parcels/:id/accept` | → courier_assigned |
| POST | `/driver/parcels/:id/verify-pickup-pin` | `{pin}` → pickup_pin_verified |
| POST | `/driver/parcels/:id/picked-up` | + parcel photo confirm → picked_up/in_transit |
| POST | `/driver/parcels/:id/verify-dropoff` | `{pin, proof_url}` → dropoff_verified → delivered + settle |

## BUS BOOKING — ticket machine
`booked → issued(QR) → boarding → boarded → completed` · (rescheduled / cancelled / refunded)
| Method | Path | Notes |
|---|---|---|
| GET | `/mobility/bus/routes?origin=&dest=` | search routes |
| GET | `/mobility/bus/schedules?route_id=&date=` | schedules + seats left |
| POST | `/mobility/bus/book` | `{schedule_id,seat_number,passenger_name,idempotency_key}` → escrow→settle operator, QR issued |
| GET | `/mobility/bus/tickets` | user tickets (QR) |
| POST | `/mobility/bus/tickets/:id/cancel` | refund per rules |
| POST | `/driver/bus/validate` | `{qr_code}` operator validates boarding → boarded |
| Admin | `/admin/transport/bus/routes` `/schedules` (CRUD, fare approval), `/bus/manifest?schedule_id=` |

## TOWING — state machine
`requested → operator_accepted → operator_en_route → pin_verified → in_progress → completed` · (cancelled)
| Method | Path | Notes |
|---|---|---|
| POST | `/mobility/towing/estimate` | `{service_type,pickup,dest}` → callout + distance |
| POST | `/mobility/towing` | book + escrow; operator PIN |
| GET | `/mobility/towing/:id` | detail |
| POST | `/mobility/towing/:id/cancel` | refund |
| GET | `/driver/towing/requests` · POST `/driver/towing/:id/accept` · `/en-route` · `/verify-pin` · `/start` · `/complete` (settle) |

## MOVERS — bidding + escrow
`quote_requested → bids_received → bid_accepted(escrow funded) → crew_assigned → in_progress → completion_confirmed(escrow released)` · (disputed / cancelled)
| Method | Path | Notes |
|---|---|---|
| POST | `/mobility/movers/quote` | `{pickup,dropoff,truck_size,helpers,inventory,move_at}` → job (quote_requested) |
| GET | `/mobility/movers/:id` | job + bids |
| POST | `/mobility/movers/:id/accept-bid` | `{bid_id, idempotency_key}` → escrow fund |
| POST | `/mobility/movers/:id/confirm-completion` | release escrow → settle provider |
| GET | `/driver/movers/open` · POST `/driver/movers/:id/bid` `{amount_kobo}` · `/start` · `/complete` |

## CAR HIRE
`requested → quoted → confirmed → active → (extended) → completed` · (cancelled)
| Method | Path | Notes |
|---|---|---|
| POST | `/mobility/car-hire/quote` | `{hire_type,vehicle_class,start_at,duration_hours,chauffeur}` → fare + deposit |
| POST | `/mobility/car-hire/book` | escrow fare+deposit |
| GET | `/mobility/car-hire/:id` | detail |
| POST | `/mobility/car-hire/:id/extend` | `{extra_hours}` → escrow delta |
| POST | `/mobility/car-hire/:id/complete` | settle (driver split), release deposit |

## Admin (all gated + audited)
`/admin/transport/parcels`, `/couriers`, `/bus/operators`, `/bus/routes`, `/bus/schedules`, `/bus/manifest`, `/towing/jobs`, `/movers/jobs`, `/car-hire/bookings`, each with list + status patch; dashboard KPIs extended with per-mode counts.

## Feature flags
Each mode behind its own flag (default off): `FEATURE_PARCEL_ENABLED`, `FEATURE_BUS_ENABLED`, `FEATURE_TOWING_ENABLED`, `FEATURE_MOVERS_ENABLED`, `FEATURE_CARHIRE_ENABLED` — OR a single `FEATURE_TRANSPORT_MODES_ENABLED` if simpler. Mobile/admin use `*_USE_MOCK` flags mirroring the mobility pattern.
