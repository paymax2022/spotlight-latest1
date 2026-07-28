# Merchant Onboarding — Go-Live Runbook

The mobile + admin clients are now wired to **live** mode (env flags flipped to
`false`). The three steps below require a Go toolchain, the Supabase CLI, and a
running stack — none of which exist in the build sandbox, so they must be run on
a real dev/CI machine. They are listed in dependency order.

## 0. Prereqs
- Go 1.23+, Node 20+, Supabase CLI, a linked Supabase project (`supabase/config.toml` → project_id `spotlight`).
- `backend/.env` has `DATABASE_URL`; set `FEATURE_ONBOARDING_ENABLED=true` (defaults false — no flag, no merge).

## 1. Compile & vet the backend
```bash
cd backend
go build ./...        # expect: clean (all external signatures + routes pre-verified statically)
go vet ./...
```

## 2. Apply the additive migration
```bash
# Review first — additive only (no DROP/rename/type-narrowing):
sed -n '1,60p' supabase/migrations/20260619000000_merchant_onboarding.sql
supabase db push      # creates onb_* tables, seeds Health/Marketplace modules + types + form schemas,
                      # seeds health_provider/pharmacy_provider/marketplace_seller roles +
                      # onboarding.review / onboarding.configure permissions (granted to super-admin)
```

## 3. Run the stack
```bash
# Terminal A — backend
cd backend && FEATURE_ONBOARDING_ENABLED=true go run ./cmd/server   # (verify cmd path)
# Terminal B — admin (live: NEXT_PUBLIC_ONBOARDING_ADMIN_USE_MOCK=false already set)
cd frontend-admin && npm run dev   # http://localhost:4030/admin/merchant-onboarding
# Terminal C — mobile (live: EXPO_PUBLIC_MERCHANT_USE_MOCK=false already set)
cd mobile-app/reactnative && npm start
```

## 4. End-to-end happy path (canonical PRD scenario)
1. Mobile: Profile ▸ **Become a Merchant** → Health → **Medical Practitioner** → fill wizard → **Submit**.
   - Expect `POST /api/v1/onboarding/applications` (201) → `PATCH .../:id` (draft) → `POST .../:id/submit` (200, requires `Idempotency-Key`).
2. Admin: `/admin/merchant-onboarding` → application appears in queue → open → **Approve**.
   - Expect `POST /api/admin/onboarding/applications/:id/approve` (200); MerchantProfile ACTIVE + `health_provider` role granted (idempotent) + audit row.
3. Mobile: pull-to-refresh capabilities → **Health Provider** now shows ACTIVE in the switcher; user is still a Customer.

## Contract alignment (already verified statically)
All 10 mobile customer/me endpoints map 1:1 to the Go routes and OpenAPI paths;
admin client paths map 1:1 to `/api/admin/onboarding/*`. See QA report §11.

## Rollback / demo mode
Set `EXPO_PUBLIC_MERCHANT_USE_MOCK=true` and `NEXT_PUBLIC_ONBOARDING_ADMIN_USE_MOCK=true`
to return to fully in-app mock data (no backend needed).
