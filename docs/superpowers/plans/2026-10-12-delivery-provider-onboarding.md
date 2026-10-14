# Delivery provider onboarding & service interest (Slice A) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a transport provider, during onboarding, record their services of interest, a vehicle type (incl. bicycle/motorcycle) that drives which documents are required, and coverage areas — persisted and shown back.

**Architecture:** Additive DB columns on `drivers`/`vehicles`; Go `transport` service gains service-profile read/write + vehicle-type-aware vehicle add + extended `/driver/me` + a static options reader; the mobile onboarding wizard gains a "Services & coverage" step and a vehicle-type selector, with required documents derived from vehicle type. Recorded-preference + display only — no dispatch changes (Slice B).

**Tech Stack:** Go 1.27 / Gin, pgx, PostgreSQL (Supabase migrations); React Native / Expo, TypeScript; `node:test` for mobile pure-logic.

**Spec:** `docs/superpowers/specs/2026-10-12-delivery-provider-onboarding-slice-a-design.md`

## Global Constraints

- Migrations are additive-only; `DROP NOT NULL` is an allowed widening; never reuse a migration version timestamp, and re-check for collisions immediately before merge.
- No money path here — no Idempotency-Key, no ledger. Do not add any.
- Driver endpoints are member-scoped via `resolveDriverID`; new ones follow suit.
- Service-interest and coverage allow-lists are single-sourced in Go; the API validates against them and rejects unknowns with 400 (never let a bad value reach an INSERT/CHECK → 500).
- `service_interests` / `coverage_areas` serialize as `[]`, never `null`.
- Service values: `rides, parcel_delivery, bus_services, car_bus_hire, movers, bulk_goods_delivery, bus_shuttle`.
- Vehicle types: `car, motorcycle, bicycle`.
- Mobile: whole-app `tsc` must pass; pure logic tested via `node:test`; UI gated behind `EXPO_PUBLIC_DELIVERY_ONBOARDING` (default on in dev).
- Conventional Commits; keep each task's diff focused.

## Review Focus

- Existing driver with nothing set → `GET /driver/me` returns `service_interests: []` and `coverage_areas: []` (not null), and the status step renders an empty state without crashing. (Task 2 test + Task 4 gate.)
- Duplicate values in a `service_interests` payload → server stores a deduped set. (Task 2 test.)
- `vehicle_type` outside the allowed set sent to `POST /driver/vehicle` → 400 from Go validation, never a DB CHECK 500. (Task 2 test.)
- Car/motorcycle submitted with an empty `plate_number` → 400 at the service layer, never a null-plate row. (Task 2 test.)
- `onboarding-options` fetch fails (offline) → client uses the hardcoded fallback and the provider can still proceed. (Task 3 test.)

---

### Task 1: Additive migration — columns, vehicle_type, nullable plate

**Files:**
- Create: `supabase/migrations/<fresh-timestamp>_delivery_provider_onboarding.sql` (timestamp strictly greater than the latest existing migration; re-check for a duplicate leading timestamp against `origin/main` right before merge)
- Test: `backend/internal/transport/delivery_onboarding_schema_live_db_test.go`

**Interfaces:**
- Produces: columns `drivers.service_interests text[]`, `drivers.coverage_areas text[]`, `vehicles.vehicle_type text` (CHECK `car|motorcycle|bicycle`, default `car`), and `vehicles.plate_number` nullable.

- [ ] **Step 1: Write the failing live-DB test** (`TestDeliveryOnboardingSchema_Integration`, skipped unless `TEST_DATABASE_URL`): insert a driver; insert a vehicle with `vehicle_type='bicycle'` and NULL `plate_number` → succeeds; insert with `vehicle_type='scooter'` → fails (CHECK); assert `drivers.service_interests` / `coverage_areas` exist and default to `'{}'`.
- [ ] **Step 2: Run it against local Postgres; verify it fails** (columns/type absent).
- [ ] **Step 3: Write the migration.** `ALTER TABLE drivers ADD COLUMN IF NOT EXISTS service_interests text[] NOT NULL DEFAULT '{}'` and same for `coverage_areas`; `ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS vehicle_type text NOT NULL DEFAULT 'car'` then `ADD CONSTRAINT vehicles_vehicle_type_check CHECK (vehicle_type IN ('car','motorcycle','bicycle'))` guarded so re-run is safe; `ALTER TABLE vehicles ALTER COLUMN plate_number DROP NOT NULL`. Keep `ALTER ... ADD`/`DROP NOT NULL` on their own lines so the additive guard regex does not trip.
- [ ] **Step 4: Apply to local Postgres and run the test; verify it passes.**
- [ ] **Step 5: Commit** (`feat(transport): additive schema for delivery provider onboarding`).

### Task 2: Go service + handlers + routes

**Files:**
- Modify: `backend/internal/transport/onboarding.go` (AddVehicle, DriverMeFull, listVehicles), `backend/internal/transport/model.go` (request/row structs), `backend/internal/transport/handler.go` (handlers), `backend/internal/app/finance_routes.go` (routes)
- Create: `backend/internal/transport/service_profile.go` (allow-lists + `SetServiceProfile` + `OnboardingOptions`)
- Test: `backend/internal/transport/service_profile_live_db_test.go`, `backend/internal/transport/service_profile_test.go` (pure validation)

**Interfaces:**
- Produces:
  - `func (s *Service) SetServiceProfile(ctx, userID string, interests, areas []string) (*DriverProfile, error)` — validates against allow-lists, dedupes, upserts.
  - `func OnboardingOptions() OnboardingOptionsResp` — `{ Services []Option; CoverageAreas []Option }`, `Option{Value/Code, Label string}`.
  - `AddVehicle` accepts `VehicleRequest.VehicleType string`; defaults `car`; requires non-empty `PlateNumber` unless `bicycle`.
  - `DriverMeFull` map gains `service_interests []string`, `coverage_areas []string`; each vehicle gains `vehicle_type`.
  - Routes: `PUT /driver/service-profile`, `GET /driver/onboarding-options`, extended `POST /driver/vehicle`, extended `GET /driver/me`.

- [ ] **Step 1: Write failing pure test** (`service_profile_test.go`): `validateServiceInterests(["rides","rides","movers"])` → `["rides","movers"]` (deduped, order-stable); `validateServiceInterests(["flying"])` → error; `validateCoverageAreas(["ikeja","mars"])` → error.
- [ ] **Step 2: Run; verify fail** (functions undefined).
- [ ] **Step 3: Implement allow-lists + `validateServiceInterests` / `validateCoverageAreas` + `OnboardingOptions` in `service_profile.go`.** Values/codes per Global Constraints; coverage seed list per spec.
- [ ] **Step 4: Run; verify pass.**
- [ ] **Step 5: Write failing live-DB test** (`service_profile_live_db_test.go`): seed driver; `SetServiceProfile` with valid+duplicate values persists a deduped set and `DriverMeFull` returns them; unknown value → error; a fresh driver's `DriverMeFull` returns empty (non-nil) arrays; `AddVehicle` bicycle with empty plate → ok, car with empty plate → error, `vehicle_type='scooter'` → error (400-class, not a DB 500).
- [ ] **Step 6: Run; verify fail.**
- [ ] **Step 7: Implement** `SetServiceProfile` (UPDATE drivers SET arrays WHERE user_id), `AddVehicle` vehicle_type handling + plate rule, `DriverMeFull`/`listVehicles` scans into `[]string`/`vehicle_type`; handlers + routes. Member-scope via `resolveDriverID`. Map validation errors to 400 via the existing error helper.
- [ ] **Step 8: Run live-DB test + `go build ./... && go vet ./internal/transport/`; verify pass.**
- [ ] **Step 9: Commit** (`feat(transport): service-profile + vehicle-type API for delivery onboarding`).

### Task 3: Mobile pure logic, constants, API client, hook

**Files:**
- Create: `mobile-app/reactnative/src/features/mobility/deliveryOnboarding.ts` (`requiredDocumentsFor`, service + coverage fallback constants, `canContinueServicesStep`)
- Modify: `mobile-app/reactnative/src/features/mobility/api/mobility.api.ts` (new API methods), `mobile-app/reactnative/src/features/mobility/hooks/useMobility.ts` (hook wiring)
- Test: `mobile-app/reactnative/src/features/mobility/__tests__/deliveryOnboarding.test.ts`

**Interfaces:**
- Consumes: Task 2 endpoints (`PUT /driver/service-profile`, `GET /driver/onboarding-options`).
- Produces:
  - `requiredDocumentsFor(vehicleType: 'car'|'motorcycle'|'bicycle'): DocType[]`.
  - `canContinueServicesStep(interests: string[], areas: string[]): boolean` (≥1 each).
  - `SERVICE_INTERESTS` (value+label+icon), `COVERAGE_FALLBACK`.
  - api: `setServiceProfile(interests, areas)`, `getOnboardingOptions()` (with fallback on failure).

- [ ] **Step 1: Write failing `node:test`**: `requiredDocumentsFor('bicycle')` → `['government_id','proof_of_address']`; `'motorcycle'` → adds `drivers_licence`; `'car'` → adds `vehicle_insurance`,`roadworthiness`. `canContinueServicesStep([], [])` false; `(['rides'], ['ikeja'])` true. `getOnboardingOptions` returns the fallback when the fetch throws.
- [ ] **Step 2: Run** (`node --experimental-strip-types --test "src/features/mobility/__tests__/deliveryOnboarding.test.ts"`); **verify fail.**
- [ ] **Step 3: Implement** the helper + constants + api methods + hook. `getOnboardingOptions` try/catch → `COVERAGE_FALLBACK` + built-in `SERVICE_INTERESTS`.
- [ ] **Step 4: Run; verify pass.**
- [ ] **Step 5: Commit** (`feat(mobile): delivery-onboarding logic, constants, and API client`).

### Task 4: Mobile onboarding UI — services step, vehicle type, reorder, status chips

**Files:**
- Modify: `mobile-app/reactnative/app/mobility/driver/onboarding.tsx` (step order, services & coverage step, vehicle-type selector, documents derived set, status chips, flag gate)
- Create: `mobile-app/reactnative/src/features/mobility/components/ServiceInterestStep.tsx`, `.../components/VehicleTypeSelector.tsx` (reusing `HireTypeCard`-style tiles / `SelectableCard` as fits)
- Test: covered by `tsc` + the Task 3 pure tests (no RN render test harness in repo)

**Interfaces:**
- Consumes: Task 3 helpers/constants/api; Task 2 `/driver/me` fields.

- [ ] **Step 1: Implement** the new step order `details → services → vehicle → documents → status`; the services & coverage step (multi-select chips, continue-gated by `canContinueServicesStep`); the vehicle step's vehicle-type selector that sets type and hides plate/make/model for bicycle; documents step driven by `requiredDocumentsFor`; status-step read-only chips for interests + coverage from `/driver/me`; gate the new step behind `EXPO_PUBLIC_DELIVERY_ONBOARDING`.
- [ ] **Step 2: Typecheck** — run the whole-app `tsc` (authoritative in CI); fix any errors in changed files. Verify no errors in the changed files.
- [ ] **Step 3: Commit** (`feat(mobile): delivery provider onboarding step, vehicle type, and interest display`).

### Task 5: Spec/docs + PR wiring

**Files:**
- Modify: the spec's status line if any decision changed during build; `docs/...` only if needed.

- [ ] **Step 1:** Open the PR; ensure CI lanes (mobile tsc, live-DB suite, additive guard, migration-version check) are green; re-check the migration timestamp for collisions against `origin/main` before merge.
- [ ] **Step 2: Commit** any doc touch-ups.

## Self-review notes

- Spec coverage: data model → Task 1; API + validation + display data → Task 2; mobile logic → Task 3; mobile flow/display → Task 4; rollout/CI → Tasks 1–5. All spec sections mapped.
- Review Focus: each of the five lines has an owning task+test (Tasks 2 and 3).
- Proportion: plan is shorter than the spec; code blocks are test names/signatures only.
