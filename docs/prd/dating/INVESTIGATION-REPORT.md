# Paymax Connect — Read-Only Investigation Report

Date: 2026-06-22. Scope: what exists in the brownfield repo that Connect **reuses** rather than
rebuilds, plus the conflicts that forced the architecture reconciliation in `architecture.md`.

## 0. Headline findings
- The dating `CLAUDE.md`/`BUILD-PLAN.md` assume a stack that **does not exist** here (Go
  microservices, MongoDB, Vue admin, `/services`+`/apps/mobile`+`/packages`). Building it would
  violate the root `CLAUDE.md` iron rules. → Reconciled to the actual stack in `architecture.md`.
- The "source of truth" spec `docs/paymax-connect-prd.md` **did not exist**. → Authored as the
  multi-file set in `docs/prd/dating/` (product/architecture/data-model/api/compliance/acceptance).
- The backend **already anticipates Connect**: `config.FeatureConnectEnabled` exists in
  `backend/internal/config/config.go`. No `connect_*` tables exist yet — clean slate for the schema.

## 1. Backend (Gin monolith) — reuse map
- **Auth:** `internal/middleware/auth_context.go` → `RequireAuthContext`, `GetAuthenticatedUser()`
  (JWT → user identity). RBAC: `internal/middleware/authorization.go` + `internal/services/rbac_service.go`;
  permissions as `module.resource.action` slugs stored in Supabase. → Connect adds `connect.*` perms.
- **Routing:** `internal/app/router.go` sets versioned groups; `internal/app/finance_routes.go`
  (~1009 lines) is the reference for feature-flag-gated module registration. → add `connect_routes.go`.
- **Money:** `internal/finance/{ledger,wallet,va,kyc,tiers,referrals,fx}` with `handler|service|repository|model`.
  `internal/provider/interfaces.go` defines `PaymentProvider` (Paystack + Maplerad adapters).
  Ledger Credit/Debit take an idempotency key. → Phase 6 calls wallet/ledger; never touch balances.
- **Idempotency:** `internal/platform/redis/redis.go` distributed lock + DB unique constraint (two-tier).
- **Audit:** `internal/services/audit_service.go` → `LogAction`/`LogLogin` (actor/target/action/module/
  resource/severity/old/new), no-op safe if unconfigured. → Connect logs via this + `admin_audit_logs`.
- **Config/flags:** `internal/config/config.go` — 40+ env-driven flags incl. `FeatureConnectEnabled`.
- **Platform:** `internal/platform/db/db.go` (pgxpool v5) and `internal/platform/redis` — handles injected.
- **Module pattern to mirror:** finance modules → `handler.go`→`service.go`→`repository.go`→`model.go`.

## 2. Supabase / Postgres — reuse map
- **Migrations:** `supabase/migrations/`, 71 files, `YYYYMMDDHHMMSS_*.sql`, additive-only
  (`CREATE ... IF NOT EXISTS`, `ALTER ... ADD COLUMN IF NOT EXISTS`; no DROP/rename/narrow).
- **Identity:** `auth.users(id UUID)` is the canonical FK target used by ledger, kyc, events, va.
  Also `public.user_profiles` (role, kyc_tier, avatar) and `public.platform_users`. → Connect FKs to `auth.users(id)`.
- **RLS:** `auth.uid()` self-checks + `EXISTS` relationship checks + `is_admin()` helper +
  `service_role` bypass. Representative policies in `data-model.md`.
- **Events (Phase 3 reuse):** `events`, `event_ticket_types`, `event_tickets` (qr_code, price_kobo,
  idempotency_key) — link Connect networking to these; do not rebuild ticketing.
- **Existing audit/case tables:** `audit_logs`, `admin_audit_logs`, `moderation_logs`, `kyc_events`
  (immutable), `login_activity`, `disputes` (case/state-machine pattern to mirror for `connect_cases`).
- **No feature_flags table** — config is per-module settings tables / JSONB. → Connect adds `connect_config`.
- **Money tables:** `ledger_accounts`, `ledger_entries` (amount_kobo BIGINT, idempotency_key UNIQUE),
  plus transfers/topup/va — Phase 6 only.
- **Conventions:** TIMESTAMPTZ + `handle_updated_at()`; money BIGINT kobo; immutable append-only
  audit; ENUM via CREATE TYPE or CHECK; FK columns indexed; JSONB for metadata.

## 3. Admin (Next.js 15, `frontend-admin/`) — reuse map
- App Router under `app/admin/`; feature = folder of `page.tsx` (+ `_ui.tsx` shared helpers).
  **Realtor module** (`app/admin/realtor/{page,moderation,verification,payments}`) is the template.
- Auth: `src/features/auth/adminAuth.ts` (Supabase; `role==='admin'`); guard
  `src/components/guards/AdminRouteGuard.tsx`; RBAC `src/features/auth/rbac.ts`.
- Data: services in `src/services/{module}AdminService.ts` call `/api/{module}/admin/*` with bearer
  token from `localStorage`; `USE_MOCK` env toggles fixtures. Existing audit/users/roles/permissions
  screens under `app/admin/{audit-logs,users,roles,permissions,login-activity,security-events}`.
- → New: `app/admin/connect/{page,moderation,verification,cases,audit}` + `connectAdminService.ts`.

## 4. Mobile (Expo RN, `mobile-app/reactnative/`) — reuse map
- **Expo Router** file-based routing under `app/`; root `app/_layout.tsx` with `AuthGate`
  (Zustand `useAuthStore`) + `QueryClientProvider`. **Visitor module** is the feature template.
- Feature code under `src/features/{module}/{api,types,constants,hooks,components,utils}` with a
  `USE_MOCK` switch and React Query hooks/keys. API via `src/api/client.ts` (axios; auto-injects
  Supabase bearer token; `Idempotency-Key` on money mutations; money in kobo).
- Design tokens already present in `src/constants/{colors,typography,spacing,radius,shadows}.ts`,
  matching `DESIGN-Mobile.md` (primary `#340075`, secondary `#0051D5`, Plus Jakarta Sans). Reusable
  primitives: `PrimaryButton`, `ScreenHeader`, `TextInputField`, `StateView`, `SegmentedControl`.
- Note: dating docs' `apps/mobile/src/modules/connect` path does **not** exist. → Use `app/connect/*`
  + `src/features/connect/*`.

## 5. Conflicts surfaced (and resolution)
| Conflict | Resolution |
|---|---|
| Microservices vs Gin monolith | Build `internal/connect/*` packages in the monolith |
| MongoDB vs Supabase | Supabase only; `connect_*` tables |
| Vue admin vs Next.js admin | `app/admin/connect/*` mirroring Realtor |
| `/apps/mobile/src/modules/connect` vs Expo Router | `app/connect/*` + `src/features/connect/*` |
| Missing PRD | Authored `docs/prd/dating/*` |
