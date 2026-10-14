# Admin User Profile — Phase 1b Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add roles (view + manage), wallet (read-only), KYC (status + approve/reject), and login/security-activity panels to the merged `/admin/users/[id]` profile page.

**Architecture:** Frontend fan-out (Approach A): the existing client-component page fires four independent reads through the admin-proxy, each panel owning its own loading/empty/error/403 state. Two new thin backend GETs (`/admin/users/:id/roles`, `/finance/admin/kyc/users/:id`); every other call reuses an existing endpoint unchanged.

**Tech Stack:** Go 1.27 / Gin (backend), Next.js 15 / TypeScript / React (frontend-admin), vitest + RTL (frontend tests), `go test` (backend tests).

**Spec:** `docs/superpowers/specs/2026-10-14-admin-user-profile-phase1b-design.md`

## Global Constraints

- Branch `feat/admin-user-profile-phase1b`, stacked on merged #746 (squash `1d59718`). Conventional Commits. PR < 400 lines where practical.
- Monetary values are integers in **kobo**; render to ₦ for display only, never do float math on money.
- No wallet mutation and no new tier logic in this phase. KYC decisions reuse the existing audited case endpoints.
- Admin console calls go through the proxy base `apiRoot()/api` (`adminApiBase()`), reusing `authHeaders()` / `readOrThrow` / `AdminUsersRequestError` from `usersService.ts`.
- Both new reads touch authz/PII → request **`security-reviewer`** on the PR. No money-path mutation added → no `ledger-auditor` gate.
- Backend permissions, verbatim: roles read `users.view`; role assign/remove `users.roles.assign`; wallet `finance.admin.transfers`; KYC read + decide `finance.admin.kyc`; audit `audit.logs.view`.

## Review Focus

- **Role id vs slug mismatch:** `GET /users/:id/roles` returns slugs, but remove needs the role **id**. A panel that passes a slug to `DELETE .../roles/:roleId` silently no-ops or 400s. Covered in Task 4 (remove fires with the catalog-resolved id).
- **KYC decision with no open case:** approve/reject must be hidden when `openCaseId` is null; rendering them would POST to `/cases//approve`. Covered in Task 6.
- **Panel failure isolation:** one panel's 500/403 must not blank the page or sibling panels. Covered per-panel in Tasks 4–7.
- **403 vs other error:** a 403 (operator lacks that permission) renders a permission placeholder, not a retry loop; other errors render retry. Covered per-panel in Tasks 4–7.
- **Empty wallet / no roles / empty activity:** empty is a normal state, distinct from error — must render an empty label, not a spinner or error. Covered in Tasks 4, 5, 7.

---

## Task 1: Backend — `GET /api/admin/users/:id/roles`

**Files:**
- Modify: `backend/internal/handlers/rbac_handler.go` (add `GetUserRoles` HTTP handler near `AssignRoleToUser:203`)
- Modify: `backend/internal/app/router.go` (add route in the `rbacAdmin` group, ~line 400 beside the existing `POST /users/:id/roles`)
- Test: `backend/internal/handlers/rbac_handler_user_roles_test.go` (new)

**Interfaces:**
- Consumes: `rbacService.GetUserRoles(ctx context.Context, userID string) ([]string, error)` (returns active role slugs).
- Produces: `GET /api/admin/users/:id/roles` → `200 {"success": true, "roles": ["<slug>", ...]}`; `users.view` permission.

- [ ] **Step 1: Write the failing test** — table test asserting: (a) happy path returns the fake service's slugs in `payload.roles`; (b) empty slice returns `{"roles": []}` not null; (c) service error → 500 `{"success": false}`. Use the existing `fakeRBACService` pattern from `admin_users_handler_test.go` (it already has `GetUserRoles`).
- [ ] **Step 2: Run to verify it fails** — `cd backend && go test ./internal/handlers/ -run UserRoles -v` → FAIL (handler undefined).
- [ ] **Step 3: Implement `func (h *RBACHandler) GetUserRoles(c *gin.Context)`** in `rbac_handler.go`: read `c.Param("id")`, call `h.svc.GetUserRoles(c.Request.Context(), id)`, on error `500 {"success": false, "error": ...}`, else `200 {"success": true, "roles": roles}` (ensure a non-nil slice so JSON emits `[]`).
- [ ] **Step 4: Add the route** in `router.go`: `rbacAdmin.GET("/users/:id/roles", middleware.RequirePermission(rbacService, "users.view"), rbacHandler.GetUserRoles)`.
- [ ] **Step 5: Run to verify it passes** — `cd backend && go test ./internal/handlers/ -run UserRoles -v` → PASS; then `go build ./...`.
- [ ] **Step 6: Commit** — `feat(admin): GET /admin/users/:id/roles returns a user's role slugs`.

---

## Task 2: Backend — `GET /api/finance/admin/kyc/users/:id`

**Files:**
- Modify: `backend/internal/finance/kycverify/repo.go` (add `LatestReviewSessionID`)
- Modify: `backend/internal/finance/kycverify/service.go` (add `OpenReviewCaseID`)
- Modify: `backend/internal/app/finance_routes.go` (new handler closure + route in the `kvAdmin` group, ~line 1086, using the in-scope `kycSvc` and `kvSvc`)
- Test: `backend/internal/finance/kycverify/review_session_test.go` (new; service/repo-level)

**Interfaces:**
- Consumes: `kyc.Service.GetProfile(ctx, userID) (*kyc.Profile, error)` → `Profile.Tier`, `Profile.Status` (JSON `kyc_tier`, `kyc_status`). A KYC "case" is a `verification_session` row (`id, user_id, target_tier, status`); the admin review queue surfaces sessions in status `NEEDS_REVIEW`; `ApproveCase`/`RejectCase` act on a session id.
- Produces:
  - `func (r *Repository) LatestReviewSessionID(ctx context.Context, userID string) (string, bool, error)` — `SELECT id FROM verification_session WHERE user_id=$1 AND status='NEEDS_REVIEW' ORDER BY created_at DESC LIMIT 1`; `("", false, nil)` when none.
  - `func (s *Service) OpenReviewCaseID(ctx context.Context, userID string) (string, bool, error)` — delegates to the repo method.
  - `GET /api/finance/admin/kyc/users/:id` → `200 {"tier": <int>, "status": "<string>", "openCaseId": "<uuid>"|null}`; `finance.admin.kyc` permission.

- [ ] **Step 1: Write the failing test** — against a live-DB `*Repository` (gated on `TEST_DATABASE_URL`, `t.Cleanup` to delete seeded rows): seed a `verification_session` in `NEEDS_REVIEW` → `LatestReviewSessionID` returns its id, `found=true`; with only a terminal-status session → `found=false`; with two `NEEDS_REVIEW` rows → returns the newest by `created_at`. Follow `backend/tests` live-DB conventions.
- [ ] **Step 2: Run to verify it fails** — `cd backend && go test ./internal/finance/kycverify/ -run ReviewSession -v` → FAIL (method undefined). (Skips cleanly without `TEST_DATABASE_URL`; set it to actually exercise.)
- [ ] **Step 3: Implement** `LatestReviewSessionID` (repo) and `OpenReviewCaseID` (service) with the query above.
- [ ] **Step 4: Add the route + handler** in `finance_routes.go` `kvAdmin` group: `kvAdmin.GET("/users/:id", middleware.RequirePermission(rbac, "finance.admin.kyc"), <handler>)`. Handler reads `id := c.Param("id")`, calls `kycSvc.GetProfile(ctx, id)` for tier/status and `kvSvc.OpenReviewCaseID(ctx, id)` for the case id, returns `gin.H{"tier": prof.Tier, "status": prof.Status, "openCaseId": caseIDorNil}` (nil when not found). On `GetProfile` error → 500.
- [ ] **Step 5: Run to verify it passes** — `cd backend && go test ./internal/finance/kycverify/ -run ReviewSession -v` (with `TEST_DATABASE_URL`) → PASS; then `go build ./...` and `go vet ./...`.
- [ ] **Step 6: Commit** — `feat(admin): GET /finance/admin/kyc/users/:id returns tier/status + open review case`.

---

## Task 3: Frontend — service methods for the four panels

**Files:**
- Modify: `frontend-admin/src/services/usersService.ts` (roles view/assign/remove; login activity; security events — all on the `/admin/users` prefix)
- Create: `frontend-admin/src/services/userFinanceService.ts` (wallet balance/transactions; KYC user status; KYC approve/reject — the `/finance/admin` prefix). First check for an existing wallet/kyc admin service in `frontend-admin/src/services/` and extend it instead if one exists (DRY).
- Test: `frontend-admin/src/services/usersService.test.ts` (extend) and `frontend-admin/src/services/userFinanceService.test.ts` (new)

**Interfaces:**
- Consumes: `adminApiBase()`, `authHeaders()`, `readOrThrow`, `AdminUsersRequestError` (all in `usersService.ts`); the two new backend GETs from Tasks 1–2; existing `rbacAdminService.listRoles(): Promise<Role[]>` (catalog, `Role` has `id`, `slug`, `name`).
- Produces (exact signatures later tasks rely on):
  - `getUserRoles(id: string): Promise<string[]>` — GET `/admin/users/:id/roles`, returns `payload.roles`.
  - `assignUserRole(id: string, roleId: string): Promise<boolean>` — POST `/admin/users/:id/roles`, body `{ roleId }`.
  - `removeUserRole(id: string, roleId: string): Promise<boolean>` — DELETE `/admin/users/:id/roles/:roleId`.
  - `getLoginActivity(id: string): Promise<Record<string, unknown>[]>` — GET `/admin/users/login-activity?actorUser=:id&limit=50`, returns `payload.activity`.
  - `getSecurityEvents(id: string): Promise<Record<string, unknown>[]>` — GET `/admin/users/security-events?actorUser=:id&limit=50`, returns `payload.events`.
  - `getWalletBalance(id: string): Promise<{ balanceKobo: number }>` — GET `/finance/admin/wallets/:id/balance`, maps `balance_kobo`.
  - `getWalletTransactions(id: string): Promise<Array<{ id: string; type: string; amount_kobo: number; reference: string; created_at: string }>>` — GET `/finance/admin/wallets/:id/transactions`, returns `payload.transactions` (define this row type locally in `userFinanceService.ts` and export it for the panel).
  - `getUserKyc(id: string): Promise<{ tier: number; status: string; openCaseId: string | null }>` — GET `/finance/admin/kyc/users/:id`.
  - `approveKycCase(caseId: string): Promise<boolean>` — POST `/finance/admin/kyc/cases/:caseId/approve`.
  - `rejectKycCase(caseId: string, reason: string): Promise<boolean>` — POST `/finance/admin/kyc/cases/:caseId/reject`, body `{ reason }`.
  - All reads throw `AdminUsersRequestError` (carrying HTTP status) via `readOrThrow` so callers can distinguish 403 from other failures.

- [ ] **Step 1: Write the failing tests** — mock `fetch`; for each read assert the exact URL + method + that a 403 throws `AdminUsersRequestError` with `.status === 403` and a 200 returns the mapped field; for each write assert URL/method/body and that `res.ok && payload.success` → `true`. Mirror the existing `usersService.test.ts` fetch-mock style.
- [ ] **Step 2: Run to verify they fail** — `cd frontend-admin && npx vitest run src/services/usersService.test.ts src/services/userFinanceService.test.ts` → FAIL (methods undefined).
- [ ] **Step 3: Implement** the methods with the signatures above, reusing `readOrThrow` for reads and the `statusAction`-style `Boolean(res.ok && payload?.success)` for writes.
- [ ] **Step 4: Run to verify they pass** — same vitest command → PASS; then `cd frontend-admin && npm run type-check`.
- [ ] **Step 5: Commit** — `feat(admin): service methods for user roles, wallet, KYC, activity`.

---

## Task 4: Frontend — Roles panel (view + manage)

**Files:**
- Create: `frontend-admin/app/admin/users/[id]/RolesPanel.tsx`
- Modify: `frontend-admin/app/admin/users/[id]/page.tsx` (render `<RolesPanel userId={id} />` below #746's account section)
- Test: `frontend-admin/app/admin/users/[id]/profile.test.tsx` (extend)

**Interfaces:**
- Consumes: `getUserRoles`, `assignUserRole`, `removeUserRole` (Task 3); `rbacAdminService.listRoles()` for the catalog (`Role { id, slug, name }`). Resolves each current slug to its catalog `Role` to get the `id` (for remove) and `name` (for display).
- Produces: `<RolesPanel userId={string} />`.

- [ ] **Step 1: Write the failing tests** — in `profile.test.tsx`, mock both services: (a) loaded → renders a chip per current role showing its catalog `name`; (b) empty roles → renders an empty label, no error; (c) read error (non-403) → inline error + Retry that refetches; (d) 403 → permission placeholder, no Retry; (e) remove ✕ calls `removeUserRole(userId, <resolved id>)` — asserting the **id**, not the slug — then refetches; (f) assign from the dropdown calls `assignUserRole(userId, roleId)` then refetches; (g) the remove ✕ is absent when a `canManageRoles` prop/permission is false.
- [ ] **Step 2: Run to verify they fail** — `cd frontend-admin && npx vitest run app/admin/users/[id]/profile.test.tsx` → FAIL.
- [ ] **Step 3: Implement `RolesPanel`** — fetch roles + catalog in parallel on mount; own loading/empty/error/403 state (distinguish 403 via `AdminUsersRequestError.status`); render chips with catalog-resolved name + id-keyed remove, and an "Assign role" dropdown of catalog roles not already held. Gate management controls behind the console's permission check (match how #746's account panel gates its actions).
- [ ] **Step 4: Run to verify they pass** — same vitest command → PASS.
- [ ] **Step 5: Commit** — `feat(admin): roles panel on user profile (view + assign/remove)`.

---

## Task 5: Frontend — Wallet panel (read-only)

**Files:**
- Create: `frontend-admin/app/admin/users/[id]/WalletPanel.tsx`
- Modify: `frontend-admin/app/admin/users/[id]/page.tsx`
- Test: `frontend-admin/app/admin/users/[id]/profile.test.tsx` (extend)

**Interfaces:**
- Consumes: `getWalletBalance`, `getWalletTransactions` (Task 3).
- Produces: `<WalletPanel userId={string} />`.

- [ ] **Step 1: Write the failing tests** — (a) loaded → balance rendered as ₦ from `balance_kobo` (assert the kobo→₦ formatting, e.g. `150000` → `₦1,500.00`) and a row per transaction; (b) empty transactions → empty label; (c) error → inline error + Retry; (d) 403 → permission placeholder; (e) **no mutation controls exist** (assert absence of any button/input in the panel).
- [ ] **Step 2: Run to verify they fail** — vitest → FAIL.
- [ ] **Step 3: Implement `WalletPanel`** — parallel fetch balance + transactions; format kobo→₦ for display only; render a read-only transactions table (type, amount, reference, created_at); own loading/empty/error/403 state.
- [ ] **Step 4: Run to verify they pass** — vitest → PASS.
- [ ] **Step 5: Commit** — `feat(admin): read-only wallet panel on user profile`.

---

## Task 6: Frontend — KYC panel (status + approve/reject)

**Files:**
- Create: `frontend-admin/app/admin/users/[id]/KycPanel.tsx`
- Modify: `frontend-admin/app/admin/users/[id]/page.tsx`
- Test: `frontend-admin/app/admin/users/[id]/profile.test.tsx` (extend)

**Interfaces:**
- Consumes: `getUserKyc`, `approveKycCase`, `rejectKycCase` (Task 3).
- Produces: `<KycPanel userId={string} />`.

- [ ] **Step 1: Write the failing tests** — (a) loaded → renders tier + status; (b) `openCaseId` present → Approve/Reject render and call `approveKycCase(openCaseId)` / `rejectKycCase(openCaseId, reason)`, then refetch status; (c) `openCaseId` null → Approve/Reject **absent**; (d) error → inline error + Retry; (e) 403 → permission placeholder.
- [ ] **Step 2: Run to verify they fail** — vitest → FAIL.
- [ ] **Step 3: Implement `KycPanel`** — fetch status on mount; show tier/status; render decision buttons only when `openCaseId` is non-null, targeting that case id (reject prompts for a reason); refetch on success; own loading/error/403 state.
- [ ] **Step 4: Run to verify they pass** — vitest → PASS.
- [ ] **Step 5: Commit** — `feat(admin): KYC panel on user profile (status + approve/reject)`.

---

## Task 7: Frontend — Login & security activity panel

**Files:**
- Create: `frontend-admin/app/admin/users/[id]/ActivityPanel.tsx`
- Modify: `frontend-admin/app/admin/users/[id]/page.tsx`
- Test: `frontend-admin/app/admin/users/[id]/profile.test.tsx` (extend)

**Interfaces:**
- Consumes: `getLoginActivity`, `getSecurityEvents` (Task 3).
- Produces: `<ActivityPanel userId={string} />`.

- [ ] **Step 1: Write the failing tests** — (a) loaded → renders a row per login-activity entry and per security-event entry, newest first; (b) both empty → empty labels, no error; (c) error → inline error + Retry; (d) 403 → permission placeholder.
- [ ] **Step 2: Run to verify they fail** — vitest → FAIL.
- [ ] **Step 3: Implement `ActivityPanel`** — parallel fetch both lists; render two read-only sub-lists; own loading/empty/error/403 state.
- [ ] **Step 4: Run to verify they pass** — vitest → PASS; then `cd frontend-admin && npm run type-check` and `npx vitest run app/admin/users/[id]/profile.test.tsx` (whole file green).
- [ ] **Step 5: Commit** — `feat(admin): login & security activity panel on user profile`.

---

## Final verification (before PR)

- [ ] `cd backend && go build ./... && go vet ./...` and the new Go tests pass (live-DB test exercised with `TEST_DATABASE_URL` set).
- [ ] `cd frontend-admin && npm run type-check` clean; `npx vitest run app/admin/users app/admin/users/[id]` green.
- [ ] `cd frontend-web && npm run test:regression` still green (golden-path unaffected, but confirm).
- [ ] Open PR stacked on `main` (rebase already done). Request `security-reviewer`. Body links the spec and this plan.
