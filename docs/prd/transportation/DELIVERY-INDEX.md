# Paymax Mobility — Delivery Index (handoff)

Status: **all 8 transport modes built end-to-end** (backend + mobile + admin), reusing existing auth, wallet, double-entry settlement, maps service, RBAC, and design system. Everything is feature-flagged off by default.

## Modes
ride-hailing · parcel delivery · bus booking · towing/roadside · mover trucks · car hire · business logistics · event transport.

## Where everything lives
| Layer | Location |
|---|---|
| Backend (Go/Gin) | `backend/internal/transport/` (36 files, package `transport`) |
| Route wiring | `backend/internal/app/finance_routes.go` (transport + modes blocks) |
| Config flags | `backend/internal/config/config.go` (`FeatureTransportEnabled`, `FeatureTransportModesEnabled`) |
| Migrations (additive) | `supabase/migrations/2026062{3,4,5}*.sql` |
| Mobile (RN/Expo) | `mobile-app/reactnative/src/features/mobility/` + `app/mobility/` |
| Admin (Next.js) | `frontend-admin/app/admin/mobility/` + `src/services/mobility*Service.ts` |
| API contract | `contracts/openapi.yaml` (103 mobility/driver/admin paths) |

## Docs
- `BUILD-CONTRACT.md` — ride-hailing endpoints, money invariants, trip state machine.
- `BUILD-CONTRACT-MODES.md` — parcel/bus/towing/movers/car-hire.
- `BUILD-CONTRACT-LOGISTICS-EVENT.md` — business logistics + event transport.
- `INTEGRATION-RUNBOOK.md` — mock→live config, request-path map, smoke test.
- `QA-REPORT.md` / `QA-REPORT-MODES.md` — acceptance-criteria coverage + verification.

## What's verified (in this environment)
- Backend compile-consistency: cross-reference clean across all 36 files — no unresolved calls, no duplicate declarations, struct fields match migration columns, route bindings resolve.
- Real maps wired: `finance_routes.go` injects `NewMapServiceBridge(mapSvc)` (the platform `internal/maps` service) when `FEATURE_MAPS_ENABLED`; `MockMaps` is the dev/test default.
- Tests: `mobility_engine_test.go` + `modes_engine_test.go` cover every fare engine and state machine (DB-free, deterministic).
- Mobile: scoped `tsc -p tsconfig.mobility.json` clean for the module.
- Admin: `npm run type-check` EXIT 0.
- OpenAPI: parses; all `$ref`s resolve.
- Migrations: verified strictly additive (no DROP/RENAME/type-narrowing).

## Money & safety invariants (enforced server-side, all modes)
Integer kobo only · idempotency key on every money mutation · escrow via the settlement ledger, released only on proof of completion (PIN/proof/QR/customer-confirm) · driver-profit floor on ride negotiation · guarded state transitions (409 on illegal) · object-level authz · every admin mutation audited · RLS on every new table.

## To go live (host)
1. `cd backend && go build ./... && go vet ./... && go test ./internal/transport/...`
2. `npm run contract:check`
3. `supabase db push`
4. Set `FEATURE_TRANSPORT_ENABLED=true`, `FEATURE_TRANSPORT_MODES_ENABLED=true` (+ `FEATURE_MAPS_ENABLED` and a provider key for real routing); add the frontend-web `GO_BACKEND_URL` gateway rewrite; flip the mobile/admin `*_USE_MOCK` flags. See `INTEGRATION-RUNBOOK.md`.

## Deliberate follow-ups (not blocking; require host/decisions, not code I can verify here)
- **Server-side admin RBAC**: enable `RequirePermission(rbac, "mobility.*")` on admin routes once those permissions are seeded (else it locks out admins). Today: `RequireAdmin` API-key gate + client-side RBAC.
- **Realtime**: the module uses React Query polling (the app's universal convention — no realtime precedent exists). Migrating trip/location updates to Supabase realtime/websockets is an app-wide architectural change to make deliberately.
- **Composite niceties**: intercity parcel and Spotlight event deep-links build on the parcel/bus/event primitives already shipped.

## Out of scope (PRD hard exclusions — correctly unbuilt)
Autonomous vehicles · helicopter/air/maritime cargo · cross-border freight · customs · dangerous-goods · unlicensed public transport · in-app transport credit without lending compliance.
