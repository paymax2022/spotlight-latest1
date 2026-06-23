# Crowdfunding — Go-Live Runbook

How to run the crowdfunding module against the **real backend** instead of mock data.

## Architecture (request path)

```
Mobile (Expo)  ──►  frontend-web Next.js  ──►  Go backend (Gin)  ──►  Postgres (Supabase)
  axios base          /api/v1/crowdfunding/*       /api/finance/crowdfunding/*    campaigns,
  :3000               proxyToGoBackend()           requireUserID() + pgx          contributions,
                                                                                   crowdfunding_categories,
                                                                                   campaign_reviews

Admin web  ──►  Go backend (Gin)  ──►  Postgres
  :8080/api/crowdfunding/admin/*   requireUserID() + pgx
```

## What is live now

Real Go endpoints implemented in `backend/internal/crowdfunding` (compile with `go build ./...`):

| Method | Path (Go) | Purpose |
|--------|-----------|---------|
| GET  | `/api/finance/crowdfunding/campaigns` | Discovery list (collection/category/type/sort/search filters) |
| GET  | `/api/finance/crowdfunding/categories` | Categories with live counts |
| GET  | `/api/finance/crowdfunding/campaigns/:id` | Campaign detail |
| POST | `/api/finance/crowdfunding/campaigns` | Create / submit for review |
| POST | `/api/finance/crowdfunding/campaigns/:id/contribute` | Escrow a contribution (idempotent, ledger-backed) |
| POST | `/api/finance/crowdfunding/campaigns/:id/{publish,release,refund}` | Lifecycle (existing) |
| GET  | `/api/crowdfunding/admin/stats` | Platform counters (derived live) |
| GET  | `/api/crowdfunding/admin/campaigns?status=` | Review queue |
| GET  | `/api/crowdfunding/admin/campaigns/:id` | Review detail |
| POST | `/api/crowdfunding/admin/campaigns/:id/decision` | Approve / reject / request-changes / freeze / unfreeze (guarded transition + audit) |

Money path uses the existing **double-entry ledger + settlement escrow** (kobo, `Idempotency-Key`,
balanced entries) — see `internal/finance/settlement` and `internal/finance/ledger`.

## Steps

### 1. Apply the migration (additive)
```bash
cd <repo>
supabase db push        # applies supabase/migrations/20260622000000_crowdfunding_full.sql
# (optional demo data)
psql "$DATABASE_URL" -f docs/seed/crowdfunding_seed.sql
```

### 2. Run the Go backend
```bash
cd backend
export DATABASE_URL="postgres://...:54322/postgres"
export FEATURE_CROWDFUNDING_ENABLED=true
export REDIS_URL="redis://localhost:6379"   # idempotency cache (optional but recommended)
go build ./... && go run ./cmd/server
```

### 3. Run frontend-web (proxy host for mobile)
```bash
cd frontend-web
export GO_BACKEND_URL=http://localhost:8080
export FEATURE_CROWDFUNDING_ENABLED=true
npm run dev          # :3000
```

### 4. Point the clients at live data
- **Mobile** (`mobile-app/reactnative/.env`):
  ```
  EXPO_PUBLIC_API_BASE_URL=http://<your-host>:3000
  EXPO_PUBLIC_CF_USE_MOCK=false
  ```
- **Admin** (`frontend-admin/.env`):
  ```
  NEXT_PUBLIC_ADMIN_API_BASE_URL=http://localhost:8080/api/v1
  NEXT_PUBLIC_CF_USE_MOCK=false
  ```

With `*_CF_USE_MOCK=false`, the implemented endpoints hit the live backend; leave it unset (or
`true`) to keep the full mock experience.

## Verify

```bash
# categories
curl -H "Authorization: Bearer $JWT" http://localhost:3000/api/v1/crowdfunding/categories
# discovery
curl -H "Authorization: Bearer $JWT" "http://localhost:3000/api/v1/crowdfunding/campaigns?collection=featured"
# admin review queue
curl -H "Authorization: Bearer $JWT" "http://localhost:8080/api/crowdfunding/admin/campaigns?status=PENDING_REVIEW"
```

Run the backend unit tests (state machine + query builder):
```bash
cd backend && go test ./internal/crowdfunding/
```

## Remaining endpoints (same pattern)

The richer surfaces still served from mock — rewards, milestones, support tickets,
notifications, settings, investment (L), CSR (M), and the admin finance/KYC/compliance reads —
follow the **identical** pattern: add a service method + handler in `internal/crowdfunding`
(or a sibling package), register the route, add a `/api/v1/crowdfunding/...` proxy, and the
client already has the live fetch branch behind its `USE_MOCK` flag. Each keeps its own
feature-scoped `USE_MOCK` so they can be cut over independently without breaking the others.
