# API Endpoints (v1)

> Financial + booking POSTs require idempotency keys + server-side validation. Base path `/api/v1`.

## Customer
| Method | Path |
|---|---|
| GET | `/mobility/home` |
| POST | `/mobility/rides/estimate` |
| POST | `/mobility/rides/request` |
| POST | `/mobility/rides/offer` |
| POST | `/mobility/rides/:id/cancel` |
| GET | `/mobility/rides/:id` |
| POST | `/mobility/rides/:id/share` |
| POST | `/mobility/rides/:id/sos` |
| POST | `/mobility/rides/:id/rate` |
| GET | `/mobility/bus/routes` |
| GET | `/mobility/bus/schedules` |
| POST | `/mobility/bus/book` |
| GET | `/mobility/bus/tickets` |
| POST | `/mobility/parcels/estimate` |
| POST | `/mobility/parcels/book` |
| GET | `/mobility/parcels/:id` |
| POST | `/mobility/car-hire/quote` |
| POST | `/mobility/car-hire/book` |
| POST | `/mobility/towing/quote` |
| POST | `/mobility/towing/book` |
| POST | `/mobility/movers/quote` |
| POST | `/mobility/movers/book` |
| GET | `/mobility/history` |
| GET | `/mobility/receipts` |
| POST | `/mobility/support/tickets` |

## Driver
| POST | `/driver/onboarding/start` |
| POST | `/driver/documents/upload` |
| POST | `/driver/vehicle/add` |
| POST | `/driver/status/online` |
| POST | `/driver/status/offline` |
| GET | `/driver/requests` |
| POST | `/driver/requests/:id/accept` |
| POST | `/driver/requests/:id/counter` |
| POST | `/driver/trips/:id/start` |
| POST | `/driver/trips/:id/complete` |
| GET | `/driver/earnings` |
| POST | `/driver/payouts/request` |
| POST | `/driver/safety/sos` |

## Admin
| GET | `/admin/mobility/dashboard` |
| GET | `/admin/mobility/users` |
| GET | `/admin/mobility/drivers` |
| PATCH | `/admin/mobility/drivers/:id/status` |
| GET | `/admin/mobility/vehicles` |
| PATCH | `/admin/mobility/vehicles/:id/status` |
| GET | `/admin/mobility/trips` |
| GET | `/admin/mobility/deliveries` |
| GET | `/admin/mobility/bus/bookings` |
| GET | `/admin/mobility/safety/incidents` |
| PATCH | `/admin/mobility/pricing` |
| PATCH | `/admin/mobility/commissions` |
| GET | `/admin/mobility/reconciliation` |
| GET | `/admin/mobility/reports` |
