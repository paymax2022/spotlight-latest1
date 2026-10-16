# Admin User 360° Profile Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Extend `/admin/users/[id]` so an admin sees a user's photo and verification state, full ledger, module memberships, referral code and activity, admin-action history and sessions.

**Architecture:** Per-panel frontend fan-out (each panel owns loading / empty / 403 / error+Retry, modelled on `WalletPanel.tsx`), plus one backend membership registry endpoint following `handlers/admin_overview.go`. Three stacked PRs: A (identity + activity), B (modules), C (referral activity).

**Tech Stack:** Go 1.27 / Gin / pgx / PostgREST client (`backend`), Next.js 15 + TypeScript + vitest (`frontend-admin`), OpenAPI (`contracts/openapi.yaml`).

**Spec:** `docs/superpowers/specs/2026-10-14-admin-user-360-profile-design.md`

## Global Constraints

- Money is integer kobo; divide by 100 only for display (`formatKobo` from `src/services/transactionsAdminService.ts`).
- Read-only: no new mutation controls; no new write paths.
- Every new route requires `RequireAuthContext` + an RBAC permission + the existing per-user scope check (`AdminUsersHandler.canAccessUser`); never reachable with only `x-admin-api-key`.
- API changes start in `contracts/openapi.yaml` (additive only); one ADR per PR named `docs/adr/ADR-PR<pr-number>-<slug>.md`, never a hand-picked number.
- Feature-flag the new module endpoint: `FEATURE_ADMIN_USER_MODULES_ENABLED` (off by default; 404 when off). Enabling it on staging is a Railway variable change: ask the user first.
- Do not edit `ReferralTierPanel.tsx`, `RolesPanel.tsx`, `WalletPanel.tsx`, `KycPanel.tsx`, `ActivityPanel.tsx`. In `page.tsx` touch only the header block and append panel elements to the existing panels grid.
- Panels use the existing UI kit only (`src/components/ui/vuexy.tsx`: `Page, PageHeader, Card, Button, Input, Badge, colors, tint, thCell, tdCell`); toasts from `@/components/rbac`.
- Conventional Commits; end each commit message with `Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>`; end each PR body with `🤖 Generated with [Claude Code](https://claude.com/claude-code)`.
- Before every commit and push: `git fetch origin main`, rebase if main moved (#753 may land between PRs). Work in a fresh `git worktree` off `origin/main`, never the primary checkout. Never reuse a migration version (no migrations are expected in this plan).
- Frontend checks per PR: `cd frontend-admin && npm run type-check && npx vitest run app/admin/users src/services`. Backend checks: `cd backend && go build ./... && go vet ./... && go test ./internal/handlers/... ./internal/repositories/... ./internal/services/... -count=1`.

## Review Focus

- A user with no `user_profiles` row, or a photo URL that 404s: header shows initials, never an error (Task 1, Task 2).
- A scoped admin opening a user outside their scope: `/modules` and enriched GET return 403, not data (Task 1, Task 5).
- One module query timing out or its table missing in an environment: that row is `error`, the response is still 200 (Task 5).
- A user in zero modules: panel shows an explicit "Not onboarded to any module" state, not a blank card (Task 7).
- `GetOrCreateCode` mints a code as a side effect: the admin referral-code read must be a pure SELECT and never create one (Task 8).
- Ledger paging past the end / `total` of 0: Next disabled, "No transactions" shown (Task 3).
- Adding fields to `domain.AdminUser` must not leak new PII into the admin export (`/users/export`): new fields are filled only by the single-user GET (Task 1).

## Verified facts the tasks rely on (checked against the tree at plan time)

- `domain.AdminUser` is in `backend/internal/domain/types.go:18`; `GetAdminUser` in `backend/internal/repositories/rbac_supabase_repository.go:506`; list and get share `adminUserSelect`.
- `services.RBACService` and `repositories.RBACRepository` are interfaces with many test fakes: do NOT add methods to them. Use new optional interfaces and a type assertion in the handler.
- Handler wiring: `handlers.NewAdminUsersHandler(rbacService, auditService).WithSessions(...)` at `backend/internal/app/router.go:119`; the `rbacAdmin` group is at `router.go:386`, **before** `sharedPool` is created (`router.go:453`), so the modules route must be registered after the pool exists.
- All 22 membership table/owner columns in Task 5 exist in `supabase/migrations/` (checked by script).
- Admin pages that exist for hrefs: `/admin/restaurant`, `/admin/marketplace/users/[id]`, `/admin/health/doctor/verification`, `/admin/telemedicine/dashboard`, `/admin/mobility/drivers`, `/admin/estate`, `/admin/stays/dashboard`, `/admin/events/approval`, `/admin/crowdfunding/review`, `/admin/insurance/dashboard`, `/admin/crypto`, `/admin/academy`, `/admin/connect/users/[id]`, `/admin/merchant-onboarding`, `/admin/modules`, `/admin/business`, `/admin/creators/dashboard`, `/admin/property-roles`, `/admin/referral/users/[id]`, `/admin/savings/vaults`, `/admin/savings/ajo`. `/admin/association` and `/admin/loyalty` have no root page: use `/admin/association/dashboard`, and omit loyalty.
- Referral: the user's code resolves `finance_referral_codes` → `referral_links` (`finance/referrals/service.go` `GetOrCreateCode`, which also INSERTS: never call it from an admin read). The legacy ledger `GET /api/referral/admin/ledger?beneficiary=<id>` (permission `referral.ledger.view`, max 200, `referral/ledger/service.go:660`) is real. The rewards-engine `/v1/admin/referrals/ledger` does not filter by user.
- **Spec correction:** the spec says the code lookup order is `referral_links` first; the code does `finance_referral_codes` first. This plan follows the code.
- #752 is merged; #753 (adds `/api/finance/admin/referrals/:user_id` and `ReferralTierPanel`) is open. Task 8–9 (PR C) must start only after #753 merges, or be stacked on its branch.

---

# PR A — identity & activity (branch `feat/admin-user-360-a`)

### Task 1: Enrich the single-user GET (backend)

**Files:**
- Modify: `backend/internal/domain/types.go` (add 6 `omitempty` fields to `AdminUser`)
- Modify: `backend/internal/repositories/rbac_supabase_repository.go` (add `EnrichAdminUser`)
- Modify: `backend/internal/services/rbac_service.go` (add optional interface + delegating method)
- Modify: `backend/internal/handlers/admin_users_handler.go:91` (`Get`)
- Test: `backend/internal/repositories/rbac_supabase_repository_test.go`, `backend/internal/handlers/admin_users_handler_test.go`
- Modify: `contracts/openapi.yaml` (add the 6 optional properties to the admin user schema)

**Interfaces:**
- Produces:
  - `domain.AdminUser` gains `AvatarURL string json:"avatarUrl,omitempty"`, `LastLoginAt string json:"lastLoginAt,omitempty"`, `EmailVerifiedAt string json:"emailVerifiedAt,omitempty"`, `PhoneVerifiedAt string json:"phoneVerifiedAt,omitempty"`, `ReferralCode string json:"referralCode,omitempty"`, `ReferredBy string json:"referredBy,omitempty"`.
  - `repositories.AdminUserEnricher interface { EnrichAdminUser(ctx context.Context, u domain.AdminUser) domain.AdminUser }` (implemented by `*RBACSupabaseRepository`).
  - `services.AdminUserEnricher` with the same method set; `*rbacService` implements it by asserting its repo to `repositories.AdminUserEnricher` and returning `u` unchanged if the repo does not implement it.

- [ ] **Step 1: Write failing repo tests** in `rbac_supabase_repository_test.go` (reuse the file's existing fake-PostgREST helper): `TestEnrichAdminUser_FillsExtrasAndAvatar` (platform_users row with `last_login_at`, `email_verified_at`, `phone_verified_at`, `referral_code`, `referred_by`; user_profiles row with `profile_photo_url` set → `AvatarURL` equals it); `TestEnrichAdminUser_AvatarPrecedence` (`profile_photo_url` empty, `avatar_url` set → uses `avatar_url`; both empty, `metadata.profilePhotoUrl` set → uses that); `TestEnrichAdminUser_ProfileReadFails_ReturnsUserUnchangedNoPanic` (profile REST 500 → avatar empty, other extras still set); `TestEnrichAdminUser_PlatformReadFails_ReturnsInputUnchanged`.
- [ ] **Step 2: Run** `go test ./internal/repositories/ -run EnrichAdminUser -count=1` → FAIL (undefined).
- [ ] **Step 3: Implement** `func (r *RBACSupabaseRepository) EnrichAdminUser(ctx context.Context, u domain.AdminUser) domain.AdminUser`: two best-effort `r.client.REST` GETs, `platform_users` (`select=last_login_at,email_verified_at,phone_verified_at,referral_code,referred_by&id=eq.<u.ID>&limit=1`) and `user_profiles` (`select=profile_photo_url,avatar_url,metadata&id=eq.<u.ID>&limit=1`; the same precedence `frontend-web/src/server/user/profile.ts:124` uses). Any error → leave those fields empty; never return an error.
- [ ] **Step 4: Run** the repo tests → PASS.
- [ ] **Step 5: Write failing handler tests** in `admin_users_handler_test.go`: `TestAdminUsersHandler_Get_EnrichesWhenServiceSupportsIt` (fake svc implementing `services.AdminUserEnricher` → response `user.avatarUrl` present); `TestAdminUsersHandler_Get_NoEnricher_StillReturnsUser` (plain fake → 200, no avatarUrl key); `TestAdminUsersHandler_Get_OutOfScope_403_NoEnrichment` (enricher must not be called when `canAccessUser` is false); `TestAdminUsersHandler_List_DoesNotExposeEnrichedFields` (list/export JSON has none of the 6 keys).
- [ ] **Step 6: Implement** the interface + `rbacService.EnrichAdminUser`, and in `Get` call it **after** the scope check: `if e, ok := h.svc.(services.AdminUserEnricher); ok { row = e.EnrichAdminUser(c.Request.Context(), row) }`.
- [ ] **Step 7: Run** `go build ./... && go vet ./... && go test ./internal/handlers/... ./internal/repositories/... ./internal/services/... -count=1` → all PASS.
- [ ] **Step 8: Commit** `feat(admin): single-user GET returns photo, verification, last login, referral code`.

### Task 2: Profile header — photo and verification (frontend)

**Files:**
- Modify: `frontend-admin/src/types/users.ts` (add the 6 optional fields to `AdminUser`)
- Create: `frontend-admin/app/admin/users/[id]/UserAvatar.tsx`
- Modify: `frontend-admin/app/admin/users/[id]/page.tsx` (header block only)
- Test: `frontend-admin/app/admin/users/[id]/profile.test.tsx`

**Interfaces:**
- Produces: `export function UserAvatar({ name, src, size = 72 }: { name: string; src?: string; size?: number }): JSX.Element` (circle image; initials fallback when `src` is empty or the image `onError` fires).

- [ ] **Step 1: Write failing tests** in `profile.test.tsx`: `renders avatar image when avatarUrl is present`; `falls back to initials when avatarUrl is absent`; `falls back to initials when the image fails to load` (fire `error` on the `<img>`); `shows Email verified / Phone verified badges only when the timestamps are set`; `shows "Last login" formatted, or "Never" when lastLoginAt is absent`.
- [ ] **Step 2: Run** `npx vitest run app/admin/users` → FAIL.
- [ ] **Step 3: Implement** `UserAvatar` and the header edits (avatar left of the `PageHeader`; badges join the existing badge row; one muted "Last login" line). `referralCode` is not rendered here (Task 9 owns it).
- [ ] **Step 4: Run** frontend checks → PASS.
- [ ] **Step 5: Commit** `feat(admin): user profile header shows photo, verification and last login`.

### Task 3: Transactions panel

**Files:**
- Create: `frontend-admin/app/admin/users/[id]/TransactionsPanel.tsx`
- Modify: `frontend-admin/app/admin/users/[id]/page.tsx` (append `<TransactionsPanel userId={id} />` after `WalletPanel`)
- Test: `frontend-admin/app/admin/users/[id]/TransactionsPanel.test.tsx`

**Interfaces:**
- Consumes: `listAdminTransactions(filters: AdminTransactionFilters): Promise<AdminTransactionsPage>` and `formatKobo` from `@/services/transactionsAdminService` (`rows[]` carry `id, type, amount_kobo, description, account_type, created_at`; page has `total, limit, offset`). It throws `Error` on non-OK; map a message containing `(403)` to the permission state.
- Produces: `export function TransactionsPanel({ userId }: { userId: string })`; PAGE_SIZE 25.

- [ ] **Step 1: Write failing tests**: `loads page 1 with user_id and limit 25`; `Next requests offset 25 and Previous goes back`; `Next disabled on the last page and when total is 0`; `shows "No transactions" when empty`; `403 shows the permission message, not Retry`; `error shows message and Retry re-fetches`; `each row links to /admin/finance/transactions/<id>`; `type filter re-queries with type and resets offset to 0`.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** (table columns Type / Amount via `formatKobo` / Description / Account / Date; `total` drives the pager). **Step 4:** frontend checks PASS. **Step 5: Commit** `feat(admin): user profile transactions panel`.

### Task 4: Admin-actions and Sessions panels

**Files:**
- Modify: `frontend-admin/src/services/usersService.ts` (add two reads)
- Create: `frontend-admin/app/admin/users/[id]/AdminActionsPanel.tsx`, `frontend-admin/app/admin/users/[id]/SessionsPanel.tsx`
- Modify: `frontend-admin/app/admin/users/[id]/page.tsx` (append both panels)
- Test: `frontend-admin/src/services/usersService.test.ts`, `frontend-admin/app/admin/users/[id]/AdminActionsPanel.test.tsx`, `.../SessionsPanel.test.tsx`

**Interfaces:**
- Produces in `usersService.ts`:
  - `export type AdminAuditEntry = { id: string; actor_user_id: string; target_user_id: string; action: string; module: string; severity: string; created_at: string }`
  - `export async function getAuditLogsForUser(userId: string, limit = 50): Promise<AdminAuditEntry[]>` → `GET {adminApiBase()}/admin/audit-logs?targetUser=<id>&limit=<n>`, reads `logs` (permission `audit.logs.view`).
  - `export type UserSession = { id: string; device: string; ip: string; userAgent: string; lastSeenAt: string; expiresAt: string; createdAt: string }`
  - `export async function getUserSessions(userId: string): Promise<UserSession[]>` → `GET {adminApiBase()}/admin/users/<id>/sessions`, reads `sessions`. Uses `readOrThrow`, so a 503 throws `AdminUsersRequestError` with `status === 503`.

- [ ] **Step 1: Write failing service tests**: `getAuditLogsForUser sends targetUser and limit and returns logs`; `getAuditLogsForUser throws AdminUsersRequestError(403)`; `getUserSessions returns sessions`; `getUserSessions surfaces status 503 on feature_disabled`.
- [ ] **Step 2: Write failing panel tests**: AdminActionsPanel — loaded rows (action, module, actor, severity, date), empty "No admin actions recorded", 403, error+Retry. SessionsPanel — loaded rows, empty "No active sessions", **503 → "Session hardening is not enabled in this environment."** (no Retry), 403, error+Retry.
- [ ] **Step 3: Run** → FAIL. **Step 4: Implement** the two service functions and panels (no mutation buttons). **Step 5:** frontend checks PASS. **Step 6: Commit** `feat(admin): user profile admin-actions and sessions panels`.

### Gate A: Open PR A
- [ ] `git fetch origin main`; rebase if moved; run backend + frontend checks; write the ADR `docs/adr/ADR-PR<n>-admin-user-360.md` after the PR number is known (open the PR first, then add the ADR commit); `gh pr create` titled `feat(admin): user 360 profile — photo, ledger, admin actions, sessions`; verify all CI green.

---

# PR B — modules (branch `feat/admin-user-360-b`, after PR A merges)

### Task 5: Membership registry and handler (backend)

**Files:**
- Create: `backend/internal/handlers/admin_user_modules.go`, `backend/internal/handlers/admin_user_modules_test.go`
- Modify: `backend/internal/handlers/admin_users_handler.go` (add `WithModules`)

**Interfaces:**
- Consumes: `AdminUsersHandler.svc.GetAdminUser(userID)` + `canAccessUser(ctx, actorID, row)` for the scope check; `middleware.GetAuthenticatedUser(c)`.
- Produces:
  - `type membershipSpec struct { Key, Label, Group, Href, SQL string }` — SQL is `SELECT count(*), min(created_at)::text FROM public.<table> WHERE <col> = $1` (grants row adds `AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())`).
  - `var membershipSpecs []membershipSpec` — 22 rows (table.column → Group/Href): `restaurants.owner_id` (Commerce, `/admin/restaurant`); `mkt_listings.seller_id` (Commerce, `/admin/marketplace/users/{userId}`); `business_profiles.user_id` (Commerce, `/admin/business`); `property_role_profiles.user_id` (Commerce, `/admin/property-roles`); `onb_merchant_profile.user_id` (Commerce, `/admin/merchant-onboarding`); `stays_hotelier_profile.user_id` (Travel, `/admin/stays/dashboard`); `drivers.user_id` (Travel, `/admin/mobility/drivers`); `doctor_profiles.user_id` and `doctors.user_id` (Health, `/admin/health/doctor/verification` and `/admin/telemedicine/dashboard`); `events.organizer_id` and `event_tickets.owner_id` (Community, `/admin/events/approval`); `creator_profiles.user_id` (Community, `/admin/creators/dashboard`); `connect_profiles.user_id` (Community, `/admin/connect/users/{userId}`); `estate_residents.user_id` (Community, `/admin/estate`); `assoc_memberships.user_id` (Community, `/admin/association/dashboard`); `campaigns.creator_id` (Money, `/admin/crowdfunding/review`); `insurance_policy.policyholder_user_id` (Money, `/admin/insurance/dashboard`); `savings_vaults.owner_user_id` (Money, `/admin/savings/vaults`); `ajo_members.user_id` (Money, `/admin/savings/ajo`); `crypto_accounts.user_id` (Money, `/admin/crypto`); `user_module_grants.user_id` (Platform, `/admin/modules`); `academy_profiles.user_id` (Programs, `/admin/academy`).
  - `type userModule struct { Key, Label, Group, Href, Status string; Count int64; Since string }` with JSON `key,label,group,href,status("member"|"none"|"error"),count,since`.
  - `func (h *AdminUsersHandler) WithModules(pool *pgxpool.Pool, enabled bool) *AdminUsersHandler`
  - `func (h *AdminUsersHandler) Modules(c *gin.Context)` — 404 when disabled or pool nil; 400 on non-UUID `:id`; 404 unknown user; 403 out of scope; otherwise runs all specs concurrently (cap `overviewConcurrency`, per-query timeout `overviewQueryTimeout`, both reused from `admin_overview.go`), substitutes `{userId}` in `Href`, returns `{success:true, modules:[...]}` in registry order.

- [ ] **Step 1: Write failing tests** (pure, no DB, via an injectable `membershipQuerier func(ctx, sql, userID string) (count int64, since string, err error)` field the handler uses; the pool-backed querier is the production default): `TestModules_FeatureOff_404`; `TestModules_InvalidUUID_400`; `TestModules_UnknownUser_404`; `TestModules_OutOfScope_403_NoQueriesRun`; `TestModules_MemberNoneError` (querier returns count 2 / 0 / error for three keys → statuses member/none/error, HTTP 200); `TestModules_OneQueryTimesOut_OthersStillReturned`; `TestModules_HrefSubstitutesUserID`; `TestModules_RespectsConcurrencyCap` (track max in-flight ≤ `overviewConcurrency`); `TestModules_ResponseOrderMatchesRegistry`.
- [ ] **Step 2: Write failing registry guards** in the same file, in the style of `admin_overview_test.go`: `TestMembershipSpecs_Structure` (unique keys, non-empty fields, SQL matches `SELECT count(*), min(created_at)::text FROM public.<table> WHERE <col> = $1…`); `TestMembershipSpecs_LinksResolveToRealAdminPages` (map `{userId}` → `[id]`, require `frontend-admin/app/<href>/page.tsx` to exist; skip if the folder is absent); `TestMembershipSpecs_ColumnsExist_LiveDB` (gated on `TEST_DATABASE_URL` via the existing `overviewLivePool` helper; runs each SQL with a nil-UUID and requires no error).
- [ ] **Step 3: Run** `go test ./internal/handlers/ -run "Modules|MembershipSpecs" -count=1` → FAIL.
- [ ] **Step 4: Implement** `admin_user_modules.go` per the Interfaces block.
- [ ] **Step 5: Run** → PASS; `go build ./... && go vet ./...`. **Step 6: Commit** `feat(admin): per-user module membership endpoint`.

### Task 6: Route registration, flag, contract

**Files:**
- Modify: `backend/internal/config/config.go` (add `FeatureAdminUserModulesEnabled`, env `FEATURE_ADMIN_USER_MODULES_ENABLED`, default false; follow the neighbouring flag declarations)
- Modify: `backend/internal/app/router.go` (after `sharedPool` is created, call a new `registerAdminUserModulesRoutes`)
- Create: `backend/internal/app/admin_user_modules_routes.go`, `backend/internal/app/admin_user_modules_routes_test.go`
- Modify: `contracts/openapi.yaml`; Create: `docs/adr/ADR-PR<n>-admin-user-360.md`

**Interfaces:**
- Produces: `func registerAdminUserModulesRoutes(r *gin.Engine, cfg *config.Config, rbac services.RBACService, h *handlers.AdminUsersHandler, pool *pgxpool.Pool)` — registers `GET /api/admin/users/:id/modules` on a new `r.Group("/api/admin")` with `middleware.RequireAuthContext(...)` (same arguments the existing `rbacAdmin` group uses at `router.go:387`) and `middleware.RequirePermission(rbac, "users.view")`; no-op when `pool == nil`.
- Consumes: `AdminUsersHandler.WithModules` (Task 5).

- [ ] **Step 1: Write failing route tests**: `route absent when pool is nil`; `route present, unauthenticated → 401`; `route present, flag off → 404`; `route does not shadow GET /api/admin/users/:id` (both resolve).
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement** the flag, the register function, and the call in `router.go` immediately after `sharedPool` is assigned (hold the handler in a variable already in scope at `router.go:119`, and call `adminUsersHandler.WithModules(sharedPool, cfg.FeatureAdminUserModulesEnabled)` there).
- [ ] **Step 4:** document the endpoint + flag in `contracts/openapi.yaml`; `cd frontend-web && npm run contract:check` → PASS. **Step 5:** `go build ./... && go vet ./... && go test ./internal/app/... -count=1` → PASS. **Step 6: Commit** `feat(admin): register user modules route behind FEATURE_ADMIN_USER_MODULES_ENABLED`.

### Task 7: Modules panel (frontend)

**Files:**
- Modify: `frontend-admin/src/services/usersService.ts` (add `getUserModules`)
- Create: `frontend-admin/app/admin/users/[id]/ModulesPanel.tsx`
- Modify: `frontend-admin/app/admin/users/[id]/page.tsx` (render ModulesPanel directly under the Account/Edit cards)
- Test: `frontend-admin/src/services/usersService.test.ts`, `frontend-admin/app/admin/users/[id]/ModulesPanel.test.tsx`

**Interfaces:**
- Produces: `export type UserModule = { key: string; label: string; group: string; href: string; status: 'member' | 'none' | 'error'; count: number; since?: string }`; `export async function getUserModules(userId: string): Promise<UserModule[]>` → `GET {adminApiBase()}/admin/users/<id>/modules`, reads `modules`; `export function ModulesPanel({ userId }: { userId: string })`.

- [ ] **Step 1: Write failing tests**: service (`returns modules`, `throws AdminUsersRequestError(404)` when the flag is off); panel — members grouped by `group` with count, "since" date and an "Open" link to `href`; `none` rows collapsed under "Not onboarded (n)" (expand to list); `error` rows listed as "unavailable"; **zero members → "Not onboarded to any module"**; 403; 404 → "Module overview is not enabled in this environment."; error+Retry.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement. Step 4:** frontend checks PASS. **Step 5: Commit** `feat(admin): user profile modules panel`.

### Gate B: Open PR B
- [ ] Rebase on `origin/main`; backend + frontend checks; `gh pr create` titled `feat(admin): user 360 profile — module memberships`; ADR commit; CI green. After merge, **ask the user** before setting `FEATURE_ADMIN_USER_MODULES_ENABLED=true` on the staging backend.

---

# PR C — referral activity (branch `feat/admin-user-360-c`; start only after #753 merges)

### Task 8: Pure-read referral code endpoint (backend)

**Files:**
- Modify: `backend/internal/finance/referrals/service.go` (add `LookupCode`)
- Create: `backend/internal/finance/referrals/admin_code_handler.go`, `backend/internal/finance/referrals/admin_code_handler_test.go`, `backend/internal/finance/referrals/service_lookup_test.go`
- Modify: `backend/internal/app/finance_routes.go` (register next to #753's `/api/finance/admin/referrals/:user_id` alias, same `referral.admin.case` guard and flag conditions)
- Modify: `contracts/openapi.yaml`

**Interfaces:**
- Produces: `func (s *Service) LookupCode(ctx context.Context, userID string) (code string, source string, err error)` — **SELECT only**; order `finance_referral_codes` → `referral_links` → `platform_users.referral_code`; `source` ∈ `"finance_referral_codes" | "referral_links" | "platform_users"`; returns `ErrNoCode` (new exported sentinel) when none. Never writes.
- Handler: `GET /api/finance/admin/referrals/:user_id/code` → `200 {code, source}` | `404 {error:"no referral code"}` | `400` non-UUID | `500` sanitized.

- [ ] **Step 1: Write failing tests**: service — `finds code in finance_referral_codes first`, `falls back to referral_links`, `falls back to platform_users`, `returns ErrNoCode and performs no INSERT/UPDATE` (assert on the recorded SQL: only SELECTs); handler — `200 with code+source`, `404 on ErrNoCode`, `400 on invalid id`, `500 does not leak the DB error`.
- [ ] **Step 2: Run** `go test ./internal/finance/referrals/ -run "LookupCode|AdminCode" -count=1` → FAIL. **Step 3: Implement. Step 4:** `go build ./... && go vet ./... && go test ./internal/finance/referrals/... ./internal/app/... -count=1` → PASS; `npm run contract:check` → PASS. **Step 5: Commit** `feat(admin): read-only referral code lookup for the user profile`.

### Task 9: Referral activity panel and the referral-360 path fix (frontend)

**Files:**
- Modify: `frontend-admin/src/services/referralAdminOpsService.ts:573-576` (`getReferralUser360` path)
- Create: `frontend-admin/src/services/userReferralActivityService.ts`, `frontend-admin/src/services/userReferralActivityService.test.ts`
- Create: `frontend-admin/app/admin/users/[id]/ReferralActivityPanel.tsx`, `.../ReferralActivityPanel.test.tsx`
- Modify: `frontend-admin/app/admin/users/[id]/page.tsx` (append panel after `ReferralTierPanel`)

**Interfaces:**
- Produces in `userReferralActivityService.ts` (all via `adminApiBase`, `authHeaders`, `readOrThrow`):
  - `getUserReferralCode(id): Promise<{ code: string; source: string } | null>` (404 → `null`)
  - `getReferral360(id): Promise<{ referrer_id: string | null; referred_count: number; total_earned_kobo: number; paid_kobo: number; clawed_back_kobo: number; fraud_standing: string }>` → `GET /api/referral/admin/users/:id/referral-360` (`referral.users.view`), reading `user`
  - `getReferralLedger(id): Promise<ReferralLedgerEntry[]>` → `GET /api/referral/admin/ledger?beneficiary=<id>` (`referral.ledger.view`, max 200), reading `entries`
- `getReferralUser360` in `referralAdminOpsService.ts` must request `/users/${id}/referral-360` (the backend's only route) instead of `/users/${id}`.

- [ ] **Step 1: Write failing tests**: services (code found / 404 → null; 360 maps `user`; ledger returns `entries`; each throws `AdminUsersRequestError` with status on 403); the path fix (`getReferralUser360` calls `/users/<id>/referral-360`, asserted on the fetch URL); panel — shows code + source with a Copy button, "Referred by" when `referredBy` (from the user GET) is set, 360 summary in ₦ via `formatKobo`, ledger table labelled "most recent 200", "No referral code yet" empty state, **each of the three sections fails independently** (one 403/500 does not blank the others), error+Retry per section.
- [ ] **Step 2: Run** → FAIL. **Step 3: Implement. Step 4:** frontend checks PASS. **Step 5: Commit** `feat(admin): user profile referral activity panel; fix referral-360 path`.

### Gate C: Open PR C
- [ ] Rebase on `origin/main` (confirm #753 merged); backend + frontend checks; `gh pr create` titled `feat(admin): user 360 profile — referral code and activity`; ADR commit; CI green.

### Task 10: Staging verification (after each PR deploys)
- [ ] Confirm the deploy reached SUCCESS for the merge commit (`mcp__railway__list-deployments`, frontend-admin and backend).
- [ ] With a logged-in admin session, open `/admin/users/<known-id>` and check the panels from that PR render and a deliberately unauthorised/failed read shows the panel-local message. Report exactly what was and was not verified.
