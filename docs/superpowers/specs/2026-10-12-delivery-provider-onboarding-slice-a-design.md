# Delivery provider onboarding & service interest — Slice A design

- **Date:** 2026-10-12
- **Status:** Approved design (pre-implementation)
- **Scope:** Slice A of the delivery cluster (batch items #6, #7, and the
  onboarding half of #3). Slice B (consumer delivery booking / dispatch
  routing) is a separate, later spec and is explicitly out of scope here.

## Intent

A transport/logistics provider onboarding today is a single ride-centric flow
(details → documents → vehicle → status) with no way to say *which* services
they want to offer, no delivery vehicle types (bicycle, motorcycle), and no
coverage areas. This slice lets a provider, during onboarding:

1. pick the **services they are interested in** (parcel, bus, hire, movers,
   bulk goods, shuttle — plus rides),
2. choose a **vehicle type** including bicycle/motorcycle, which determines
   **which documents** they must upload,
3. declare their **coverage areas**,

and then **see those choices** after onboarding.

**Success:** a provider completes onboarding having recorded service interests,
a vehicle type, documents appropriate to that vehicle type, and coverage areas;
all of it persists and is shown back on the status step; `GET /driver/me`
returns it. Agreed constraint: in Slice A these are **recorded preferences and
display only** — they do **not** yet change which jobs a provider receives
(dispatch gating is Slice B). No existing driver is broken: all new fields
default to empty and existing vehicles default to `vehicle_type = 'car'`.

## Non-goals (Slice A)

- No change to dispatch, request queues, matching, or job routing.
- No consumer-facing delivery booking flow.
- No admin review/approval changes (existing `verification_status` flow stays).
- No new profile screen beyond the existing status step.

## Data model

Additive migration (`supabase/migrations/<new-timestamp>_delivery_provider_onboarding.sql`),
additive-only per CLAUDE.md:

- `drivers.service_interests text[] NOT NULL DEFAULT '{}'`
- `drivers.coverage_areas   text[] NOT NULL DEFAULT '{}'`
- `vehicles.vehicle_type text NOT NULL DEFAULT 'car'`
  `CHECK (vehicle_type IN ('car','motorcycle','bicycle'))` — new column; existing
  rows take the `'car'` default.
- `ALTER TABLE vehicles ALTER COLUMN plate_number DROP NOT NULL` — a bicycle has
  no plate. `DROP NOT NULL` is a widening the additive-only guard explicitly
  allows.

Notes:
- `vehicles.category` (ride class: economy/comfort/premium/xl) is unchanged and
  only meaningful for cars; it keeps its default for bike/motorcycle.
- Arrays use `'{}'` default so they scan into non-nil empty Go slices and
  serialize as `[]`, never `null` (the empty-list serialization trap).
- Migration uses the `DROP CONSTRAINT IF EXISTS` / `ADD CONSTRAINT` DO-block
  pattern only if a CHECK must be widened; here `vehicle_type` is a brand-new
  column, so a plain `ADD COLUMN ... CHECK` suffices.

### Canonical allow-lists (single-sourced on the server)

Service interest values (the only values the API accepts):
`rides`, `parcel_delivery`, `bus_services`, `car_bus_hire`, `movers`,
`bulk_goods_delivery`, `bus_shuttle`.

Coverage area codes — seed set at LGA grain for Lagos (extensible by ops without
an app release, because the list is served from the backend):
`ikeja`, `surulere`, `yaba`, `lekki`, `victoria_island`, `ikoyi`,
`lagos_island`, `apapa`, `ajah`, `oshodi_isolo`, `alimosho`, `gbagada`,
`agege`, `mushin`, `ikorodu`, `badagry`, `epe`.

To prevent the client/DB drift that caused the insurance `doc_type` 500, the
server owns these lists and exposes them (see API); the client renders from the
server response with a small hardcoded fallback for offline.

### Vehicle type → required documents

| Vehicle type | Required documents |
|---|---|
| `bicycle`    | `government_id`, `proof_of_address` |
| `motorcycle` | `government_id`, `proof_of_address`, `drivers_licence` |
| `car`        | `government_id`, `proof_of_address`, `drivers_licence`, `vehicle_insurance`, `roadworthiness` |

Encoded once as `requiredDocumentsFor(vehicleType)` (pure function, unit-tested)
and consumed by the onboarding documents step's completeness gate.

## Onboarding flow

New step order (vehicle moves before documents because documents depend on
vehicle type):

**details → services & coverage → vehicle → documents → status**

- **details** — unchanged (name, phone, email).
- **services & coverage (new)** — multi-select chips for the seven services
  (≥1 required) and multi-select coverage areas (≥1 required); saved via
  `PUT /driver/service-profile`. Continue is gated on ≥1 of each.
- **vehicle (moved up)** — pick `vehicle_type` first. Car & motorcycle capture
  plate/make/model/year/color as today; **bicycle skips plate/make/model** and
  records only the type. Submits via the extended `POST /driver/vehicle`.
- **documents (moved after vehicle)** — required set = `requiredDocumentsFor`
  of the chosen vehicle type; `allDocsUploaded` checks that derived set, so a
  bicycle courier finishes after ID + proof of address.
- **status** — unchanged purpose; additionally renders the chosen services and
  coverage as read-only chips (item #7).

## API

Base: `/api/finance/driver` (existing group; see `backend/internal/app/finance_routes.go`).

- `PUT /driver/service-profile` — body `{ service_interests: string[],
  coverage_areas: string[] }`. Validates each value against the server
  allow-lists (reject unknown with 400, dedupe), upserts both arrays onto the
  caller's `drivers` row, returns the updated profile. Idempotent (a plain
  overwrite of the two columns; no money path, so no Idempotency-Key).
- `POST /driver/vehicle` (extend) — add optional `vehicle_type`
  (default `car`); validate against the CHECK set; require `plate_number`
  for car/motorcycle, allow empty for bicycle.
- `GET /driver/me` (`DriverMeFull`, extend) — add `service_interests`,
  `coverage_areas`, and each vehicle's `vehicle_type` to the response, arrays
  as `[]` when empty.
- `GET /driver/onboarding-options` (new, read-only) — returns
  `{ services: [{value,label}], coverage_areas: [{code,label}] }` from the
  server's canonical lists.

All four are member-scoped to the authenticated driver (`resolveDriverID`),
matching the existing driver endpoints.

## Components / isolation

- **Go:** extend `transport` service — `SetServiceProfile(ctx, userID, interests,
  areas)`, allow-list validation helpers, `AddVehicle` accepts `vehicle_type`,
  `DriverMeFull` returns the new fields, and an `OnboardingOptions()` reader for
  the static lists. Handlers in `transport/handler.go`, routes in
  `finance_routes.go`.
- **Mobile:** `requiredDocumentsFor(vehicleType)` pure helper; onboarding
  constants for services (value+label+icon) and the offline-fallback option
  lists; a new "Services & coverage" step component; a vehicle-type selector in
  the vehicle step; status-step chips. API client methods for the new
  endpoints. Hooks via the existing `useDriverOnboarding` pattern.

## Error handling

- Unknown service/area value → 400 with a clear message; the client only ever
  sends values it got from `onboarding-options`, so this is a guard, not a
  normal path.
- Car/motorcycle submitted without a plate → 400 at the vehicle step.
- `onboarding-options` fetch failure → client uses the hardcoded fallback list
  and still lets the provider proceed.
- Documents step reflects the derived required set; removing/adding a document
  type never blocks a vehicle type that does not need it.

## Testing

- **Go (live-DB + unit):** migration applies and replays from zero;
  `vehicle_type` CHECK enforced; bicycle insert with null plate succeeds while a
  car without a plate is rejected at the service layer; `SetServiceProfile`
  rejects unknown service/area values and persists valid, deduped arrays;
  `DriverMeFull` returns the new fields as empty arrays by default.
- **Mobile (pure-logic `node:test`, per repo RN unit-test pattern):**
  `requiredDocumentsFor` returns the correct set per vehicle type; the services
  step continue-gate requires ≥1 service and ≥1 area.
- **CI gates:** mobile whole-app tsc, live-DB suite (Postgres + migrations),
  additive-only guard, migration-version check.

## Rollout / flags

Onboarding is a cohesive flow; the new step is gated behind a mobile flag
`EXPO_PUBLIC_DELIVERY_ONBOARDING` (default on in dev, togglable) so the step can
be dark-launched if needed. Backend columns/endpoints are additive and safe to
ship ahead of the client. No production data backfill required (defaults cover
existing rows). Reaches providers only via a new app build; backend ships with
the normal deploy. Prod DB migration is subject to the existing migrate backlog
(see issue #712).

## Open questions / deferred

- Slice B will decide how `service_interests` and `coverage_areas` feed
  dispatch/matching; the array shape is chosen to make that query-able later.
- Whether coverage should later become geo (radius/polygon) — deferred; LGA
  codes are forward-compatible as labels.
