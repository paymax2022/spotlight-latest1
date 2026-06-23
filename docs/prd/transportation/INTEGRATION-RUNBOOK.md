# Paymax Mobility — Integration Runbook (mock → live)

How to take the ride-hailing module from in-app mock data to the live Go backend, end-to-end across mobile + admin.

## Request path map
| Caller | Client base | Path it calls | Reaches |
|---|---|---|---|
| Mobile rider/driver | frontend-web gateway (`EXPO_PUBLIC_API_BASE_URL`, default `:3000`) | `/api/finance/mobility/*`, `/api/finance/driver/*` | Go backend, via the frontend-web rewrite → `GO_BACKEND_URL` |
| Admin console | `NEXT_PUBLIC_ADMIN_API_BASE_URL` (default `http://localhost:8080/api/v1`) | `/api/finance/admin/transport/*` | Go backend directly |

The Go backend mounts mobility/driver groups **directly under `/api/finance`** (siblings of the legacy `/transport` group); admin under `/api/finance/admin/transport`. The mobile API base was corrected from `/api/finance/transport` → `/api/finance` to match.

## Go-live checklist

1. **Database** — apply the additive migration:
   ```
   supabase db push        # or: supabase migration up
   ```
   Adds: trip lifecycle columns, pricing/commission config (seeded), fare_offers, vehicles, driver_documents, safety_incidents, trip_events, trip_ratings, trusted_contacts, mobility_profiles, transport_audit_log. No DROP/RENAME — safe on existing data.

2. **Backend** (`backend/.env`):
   ```
   FEATURE_TRANSPORT_ENABLED=true
   APP_PORT=8080
   ADMIN_API_KEY=<strong-secret-in-prod>     # empty = open admin (dev only)
   DATABASE_URL=...                          # money-path pgx pool
   ```
   Run: `cd backend && go run ./cmd/server` (listens on :8080).

3. **Gateway** (`frontend-web`) — proxy finance calls to Go:
   ```
   GO_BACKEND_URL=http://localhost:8080      # or the deployed backend URL
   ```
   The added `rewrites()` forwards `/api/finance/:path*` → `${GO_BACKEND_URL}/api/finance/:path*`, so the mobile app reaches Go through its single base URL (Bearer header is forwarded).

4. **Mobile** (`mobile-app/reactnative/.env`):
   ```
   EXPO_PUBLIC_MOBILITY_USE_MOCK=false
   # Keep EXPO_PUBLIC_API_BASE_URL on the gateway (:3000) to use the rewrite,
   # or set it to http://localhost:8080 to hit Go directly.
   ```

5. **Admin** (`frontend-admin/.env.local`):
   ```
   NEXT_PUBLIC_MOBILITY_ADMIN_USE_MOCK=false
   NEXT_PUBLIC_ADMIN_API_BASE_URL=http://localhost:8080/api/v1
   ```

## Smoke test (happy path)
1. Admin → Mobility → Pricing: confirm seeded `default/ride_hailing` config loads; tweak base fare (audited).
2. Driver (mobile): onboarding submit → upload docs → add vehicle. Admin → Drivers: approve (status `approved`, audited).
3. Driver: go online (allowed only once approved) with a location.
4. Rider: estimate → request (instant) → driver sees request → accept → arrive → rider reads PIN → driver verifies PIN → start → complete. Confirm wallet debit/escrow and driver settlement on the ledger.
5. Rider: rate + tip. Driver: earnings reflect net of commission.
6. Rider: SOS mid-trip → Admin → Safety Center shows the incident; resolve it (audited).
7. Negotiation guard: rider offer below `fare_floor_pct`, and a driver counter that breaches the profit floor → both rejected `422 FARE_BELOW_FLOOR`.

## Verification commands (run on host)
```
cd backend && go build ./... && go vet ./... && go test ./internal/transport/...
cd frontend-admin && npm run type-check
cd mobile-app/reactnative && npx tsc --noEmit -p tsconfig.mobility.json
npm run contract:check        # implementation vs contracts/openapi.yaml
```

## Production hardening follow-ups (not blocking the vertical)
- The Go admin transport routes use `requireUserID()` + `RequireAdmin(ADMIN_API_KEY)` (the existing finance-admin convention). For finer control, add `RequirePermission(rbac, "mobility.*.manage")` middleware. If `ADMIN_API_KEY` is set, the admin console must also send `x-admin-api-key` (it currently sends Bearer only, matching the other admin services).
- Swap `MockMaps` for a live provider behind the `MapsAdapter` interface (one injection point in `transport.NewService(...).WithMaps(...)`).
- Replace polling hooks with Supabase realtime / websockets for live driver location + trip updates.
- Add `react-native-maps` (or Mapbox) and replace the `MapPlaceholder` stand-in (single component swap).
