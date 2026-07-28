# Bus marketplace — delivery notes

Interstate (state → state) bus **provider marketplace**: operators self-register,
publish interstate routes (`from_state <> to_state`) with amenities + a base
fare, self-schedule specific departures, and take seat bookings that settle to
the operator via the existing escrow/settle money path (kobo, `Idempotency-Key`,
tier gate). See **ADR-020** for the decisions.

- API contract: `contracts/openapi.yaml` — `/mobility/bus/search`,
  `/mobility/bus/providers*`, `/mobility/bus/provider/*` (tag `Mobility Bus`).
- Backend: `backend/internal/transport/bus_provider.go`,
  `backend/internal/transport/bus_handler.go`, `backend/internal/transport/bus.go`.
- Migration: `supabase/migrations/20260907000000_bus_provider_marketplace.sql`
  (additive-only; `bus_providers` table + `bus_routes` columns + interstate CHECK).

## Go-live gates

- [ ] `cd backend && go build ./... && go vet ./...` green; bus provider tests pass
      (`backend/internal/transport/bus_provider_test.go`).
- [ ] `supabase migration up` applied **locally** (local-first — do not
      `supabase db push` until go-live) and `bus_routes_diff_states` CHECK present.
- [ ] **RBAC / verification gate**: admin verification workflow live; discovery
      (`/mobility/bus/search`, `/mobility/bus/providers`) prefers/requires
      providers with `verificationStatus = 'verified'` (verified badge). Providers
      are active-on-register with `verification_status = 'pending'` until then.
- [ ] Mobile flips off mock supply: `EXPO_PUBLIC_BUS_USE_MOCK=false`.
- [ ] `npm run contract:check` passes (implementation matches openapi.yaml).

## Deferred (per ADR-020)

Recurring departure templates; fare-approval enforcement beyond the
`fareApproved` flag; provider ratings write path; a dedicated RBAC permission
surface for provider actions (currently ownership-gated via `owner_user_id`).
