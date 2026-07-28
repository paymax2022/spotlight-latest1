# Paymax Connect — Architecture (§26, brownfield-reconciled)

> **This is the authoritative reconciliation.** The dating `CLAUDE.md`/`BUILD-PLAN.md` describe an
> aspirational monorepo (Go microservices, MongoDB, Vue/Quasar admin, `/services`, `/apps/mobile`,
> `/packages`). That structure **does not exist** in this repo and conflicts with the root
> `CLAUDE.md` iron rules. Connect is built into the **existing stack** described below.

## §26.1 Stack mapping (docs → reality)

| Dating docs assume | Build Connect against (actual repo) |
|---|---|
| 30 Go microservices under `/services/*` | One Gin monolith: new package `backend/internal/connect/` with sub-packages per concern |
| PostgreSQL **+ MongoDB** hybrid | **Supabase Postgres only** — additive migrations in `supabase/migrations/` |
| Vue/Quasar admin | **Next.js 15** admin — `frontend-admin/app/admin/connect/*` |
| `/apps/mobile/src/modules/connect` | **Expo Router** — `mobile-app/reactnative/app/connect/*` + `src/features/connect/*` |
| Dedicated AI safety service | Internal `connect/safety` package + async worker (asynq/Redis); pluggable provider iface |
| API `/api/v1/connect/...` | Same path, registered in `backend/internal/app/router.go` via new `connect_routes.go` |

## §26.2 Backend layout (mirror `internal/finance/*` conventions)
```
backend/internal/connect/
  profile/      # profiles, profile-modes, visibility           handler|service|repository|model
  verification/ # L0–L1 selfie/liveness, badges, encryption hooks
  matchmaking/  # discovery, likes/super-likes, mutual-match state machine
  chat/         # conversations, messages, safety hooks
  safety/       # cases, reports, block/unmatch, trusted contacts; AI moderation provider iface
  dateplanner/  # date ideas, safe venues, invites, check-in, feedback
  config/       # Connect-owned flags/weights/limits exposed to mobile (backend-owned config)
  admin/        # admin-facing handlers for moderation/verification/case queues + audit reads
```
Each sub-package follows the existing pattern: `handler.go` (HTTP/Gin) → `service.go` (logic +
state machines) → `repository.go` (DB via pgx pool / Supabase) → `model.go` (types).

### Reuse (do NOT duplicate)
- **Auth:** `internal/middleware/auth_context.go` `RequireAuthContext` + `GetAuthenticatedUser()`;
  RBAC via `internal/middleware/authorization.go` + `internal/services/rbac_service.go`
  (permission slugs `connect.resource.action`).
- **Routing:** register a `connect` group in `internal/app/router.go`; gate on existing
  `config.FeatureConnectEnabled` (already present in `internal/config/config.go`).
- **Money:** call `internal/finance/wallet` + `ledger` services for subscriptions/boosts/passes
  with an `Idempotency-Key`; never touch balances directly (ledger projection rule).
- **Idempotency:** `internal/platform/redis` lock + DB unique constraint (two-tier), as ledger does.
- **Audit:** `internal/services/audit_service.go` `LogAction(...)`; admin actions also written to
  the `admin_audit_logs` table (see `data-model.md`).
- **DB/Redis handles:** injected `*pgxpool.Pool` (`internal/platform/db`) and optional
  `*redis.Client` (`internal/platform/redis`).

## §26.3 Data plane
All Connect tables live in Supabase `public.*`, FK to `auth.users(id)` (the proven pattern used by
ledger, kyc, events). RLS on every table: `auth.uid()` self-checks + `EXISTS` relationship checks +
`is_admin()` for admin reads + `service_role` bypass for backend writes. Money columns are BIGINT
kobo. Verification PII is encrypted at rest and never logged. See `data-model.md`.

## §26.4 Config ownership (backend-owned, mobile reads)
Matching weights, discovery/anti-fatigue limits, premium entitlements, moderation/safety rules,
verification requirements, and feature flags are stored backend-side (Connect `config` package,
backed by a `connect_config` table) and exposed via `GET /api/v1/connect/config`. **Mobile never
hard-codes these** (root rule + `dating/CLAUDE.md §46`).

## §26.5 State machines (reject illegal transitions)
- **Verification:** `none → pending → l0_passed → l1_passed | failed | rejected`.
- **Match:** `like → (mutual?) → matched → conversation_open | unmatched | blocked`.
- **Conversation safety:** `open → flagged → under_review → cleared | restricted | closed`.
- **Case/incident:** `open → investigating → resolved | closed` (mirrors existing `disputes`).
- **Subscription:** reuse Paymax subscription/entitlement lifecycle.
All transitions are guarded in `service.go`, idempotent, transactional, and audited.

## §26.6 Admin (Next.js)
`frontend-admin/app/admin/connect/{page,moderation,verification,cases,audit}/page.tsx` mirroring
the existing **Realtor** module; shared helpers in `_ui.tsx`; data via
`src/services/connectAdminService.ts` calling `/api/connect/admin/*` with the admin bearer token.

## §26.7 Mobile (Expo RN)
Routes under `app/connect/*` (file-based), feature code under `src/features/connect/*`
(`api/ types/ constants/ hooks/ components/`) mirroring the **Visitor** module. State via Zustand +
React Query. Design tokens already exist in `src/constants/*` matching `DESIGN-Mobile.md`
(primary `#340075`, secondary `#0051D5`, Plus Jakarta Sans). API via `src/api/client.ts` (axios,
auto-injects Supabase bearer token; `Idempotency-Key` on money mutations).

## §26.8 Async / AI safety
Media moderation and AI scam/harassment scoring run as async jobs (Redis/asynq), writing reason
codes to `connect_moderation_decisions`. Provider is behind an interface so the model can change
without touching call sites. Media is **not** publicly visible until moderation passes.
