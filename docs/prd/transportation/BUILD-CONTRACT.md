# Paymax Mobility — Build Contract (ride-hailing vertical)

> Ground truth for backend, mobile, and admin agents. All money is **integer kobo**.
> Every money-mutating POST requires `Idempotency-Key` (header) or `idempotency_key` (body).
> Base path for customer/driver: `/api/finance/transport`. Admin: `/api/finance/admin/transport`.
> Auth: existing Supabase JWT (Bearer). Backend reads caller via `requireUserID()` → `c.GetString("user_id")`.
> Admin routes additionally require admin auth middleware + audit log on every mutation.

## Money / fare invariants (enforced server-side, never client)
- System fare = `base_fare + per_km*km + per_min*min`, then `* surge`, floored at `min_fare`. All from `transport_pricing_config` (per zone+service_type). Never hard-code in client.
- **Offer fare** must satisfy `system_fare * fare_floor_pct <= offer <= system_fare * fare_ceiling_pct`.
- **Driver-profit floor:** any accepted fare must leave the driver (after commission) `>= driver_profit_floor_kobo`. Reject otherwise.
- Commission split from `transport_commission_config` by the driver's `commission_tier` (default `standard` = 80/20).

## Trip state machine (`trips.phase`)
`requested → fare_negotiating → driver_assigned → driver_arriving → pin_verified → in_progress → completed`
Side branches: `cancelled` (refund escrow), `no_show`, `safety_hold`. Coarse `trips.status` mirrors: requested/accepted/picked_up/completed/cancelled. Every transition writes a `trip_events` row. Only allowed transitions accepted.

## Maps adapter (Go interface, mock impl first)
`Geocode(addr) -> (lat,lng)`, `Route(from,to) -> (distance_m, duration_s, polyline)`, `ETA(from,to) -> seconds`, `DistanceMatrix`. Mock = deterministic haversine + avg-speed. Business logic depends only on the interface.

---

## Customer endpoints
| Method | Path | Body / notes | Returns |
|---|---|---|---|
| GET  | `/mobility/home` | — | wallet balance, active trip, quick tiles, saved places, safety reminder |
| GET  | `/mobility/config/pricing?zone=&service_type=` | — | active pricing config (client renders fare range, never computes floor) |
| POST | `/mobility/rides/estimate` | `{pickup{lat,lng,address}, dest{lat,lng,address}, service_type}` | `{distance_m,duration_s,system_fare_kobo, offer_min_kobo, offer_max_kobo, polyline}` |
| POST | `/mobility/rides/request` | `{pickup, dest, pricing_mode:'instant'\|'offer', offer_kobo?, payment_method, idempotency_key}` | trip (escrows fare; phase `requested` or `fare_negotiating`) |
| POST | `/mobility/rides/:id/offer` | `{offer_kobo}` | fare_offer (validates range; rejects below floor 422) |
| POST | `/mobility/rides/:id/accept-counter` | `{}` | accepts driver counter, re-escrows delta |
| POST | `/mobility/rides/:id/cancel` | `{reason}` | refunds escrow, phase `cancelled` |
| GET  | `/mobility/rides/:id` | — | trip detail + driver + vehicle + fare offer + phase |
| GET  | `/mobility/rides/active` | — | current active trip for rider |
| POST | `/mobility/rides/:id/share` | `{}` | live-share token |
| POST | `/mobility/rides/:id/sos` | `{lat,lng,description?}` | creates SafetyIncident(type=sos), phase→safety_hold flag |
| POST | `/mobility/rides/:id/rate` | `{stars,comment?,tip_kobo?}` | rating |
| GET  | `/mobility/history` | — | past trips |
| GET  | `/mobility/profile` / PUT | trust level, addresses | mobility_profile |
| GET/POST/DELETE | `/mobility/trusted-contacts` | `{name,phone}` | contacts |

## Driver endpoints
| Method | Path | Body / notes |
|---|---|---|
| POST | `/transport/drivers` | register driver (exists) `{name,vehicle_reg,vehicle_type}` |
| POST | `/driver/onboarding/submit` | `{phone,email,photo_url,service_categories}` → verification_status `submitted` |
| POST | `/driver/documents` | `{doc_type,file_url,expiry_date?}` |
| POST | `/driver/vehicle` | `{plate_number,make,model,year,color,category,capacity}` |
| GET  | `/driver/me` | driver profile + verification status + docs + vehicle |
| PATCH| `/driver/status` | `{status:'online'\|'offline', lat?, lng?}` (only `approved` drivers may go online) |
| GET  | `/driver/requests` | nearby open ride requests (dispatch candidates) |
| POST | `/driver/requests/:id/accept` | accept at system/offer fare → phase `driver_assigned` |
| POST | `/driver/requests/:id/counter` | `{counter_kobo}` validates range + profit floor |
| POST | `/driver/trips/:id/arrive` | phase `driver_arriving` |
| POST | `/driver/trips/:id/verify-pin` | `{pin}` → phase `pin_verified` (must match trip_pin) |
| POST | `/driver/trips/:id/start` | phase `in_progress`, status `picked_up`, started_at |
| POST | `/driver/trips/:id/complete` | phase `completed`, settle split (driver/platform), status `completed` |
| GET  | `/driver/earnings` | gross, platform fee, net, completed, cancel rate, commission tier |
| POST | `/driver/sos` | `{trip_id?,lat,lng}` safety incident |

## Admin endpoints (`/api/finance/admin/transport`, admin-gated, audited)
| Method | Path | Notes |
|---|---|---|
| GET  | `/dashboard` | KPIs: trips, GBV, revenue, driver earnings, completion/cancel rate, open safety incidents, active drivers |
| GET  | `/drivers?status=` | driver list + verification queue |
| GET  | `/drivers/:id` | driver detail + docs + vehicle |
| PATCH| `/drivers/:id/verification` | `{status:'approved'\|'rejected'\|'suspended', reason}` → audit + (on approve) allow online |
| GET  | `/vehicles?status=` | vehicle compliance list |
| PATCH| `/vehicles/:id/status` | `{status, inspection_status, insurance_status, reason}` audited |
| GET  | `/trips?phase=` | trips list / dispatch feed |
| GET  | `/dispatch/live` | active trips + online drivers + stuck/SOS flags |
| POST | `/dispatch/:trip_id/assign` | `{driver_id}` manual assignment (audited) |
| GET  | `/pricing?zone=&service_type=` / PATCH | read + update pricing config (audited, maker rules) |
| GET  | `/commission` / PATCH `/commission/:tier` | commission tiers (audited) |
| GET  | `/safety/incidents?status=` | safety center feed |
| PATCH| `/safety/incidents/:id` | `{status, assigned_admin?, resolution_note?}` audited |
| GET  | `/reports/summary` | revenue/commission/trip/cancellation rollups |
| GET  | `/audit` | transport_audit_log feed |

## Error conventions
`400` bad input · `401` unauth · `403` not permitted (role/object) · `404` not found ·
`409` invalid state transition / idempotency replay conflict · `422` fare below floor / above ceiling / below driver-profit floor.
Body: `{ "error": "message", "code": "FARE_BELOW_FLOOR" }`.

## Frontend integration rules
- **Mobile** lives in `mobile-app/reactnative/src/features/mobility/{api,components,hooks,types,screens}`; api uses `@/api/client` axios (Supabase Bearer auto-attached). Mirror existing feature pattern (fx/crowdfunding): `mobility.api.ts` + `mobility.mock.ts` behind `USE_MOCK`. Read `DESIGN-Mobile.md` tokens; reuse existing shared components, wallet, auth context. Driver screens role-gated inside same app.
- **Admin** lives in `frontend-admin/app/admin/mobility/...` (Next.js 15 app router). Reuse admin shell/layout, RBAC, audit UI patterns from existing modules (e.g. `app/admin/fx`, `app/admin/merchant-onboarding`).
- Every screen handles: loading · empty · error · restricted · no-driver-found · service-unavailable · payment-failed · offline.
