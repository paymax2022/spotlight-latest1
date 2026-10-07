# Property Role Registration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let a user self-register as Estate Manager, Property Developer or Property Agent/Marketer, submit evidence, and be verified by an admin; expose `IsVerified` for later slices.

**Architecture:** A new Go package `property/roles` (repository, service, handlers) over three additive tables, mounted next to the property suite under its own flag. Active profiles feed the existing role-context aggregator. Mobile extends the role picker; the admin console gets a review queue.

**Tech Stack:** Go 1.23 / Gin / pgx, Postgres (additive migration), React Native (Expo Router, react-query), Next.js admin console, OpenAPI.

**Spec:** `docs/superpowers/specs/2026-10-07-property-role-registration-design.md`

## Global Constraints

- Migrations are additive-only; version must be unique. Pick a version greater than every version on `origin/main`, `origin/staging` and the live `supabase_migrations.schema_migrations` (at planning time the highest known was `20270311000000`, so use `20270312000000` or later; final version is `20271009000000` because origin/main later claimed `20270312000000`) and re-check with `scripts/ci/check-migration-versions.sh` right before merge.
- New tables: RLS enabled with no policy, `anon`/`authenticated` grants revoked, in the same migration. Backend pgx pool only.
- Feature flag `FEATURE_PROPERTY_ROLES_ENABLED`, default off. Routes unregistered when off.
- Roles are exactly `estate_manager`, `developer`, `agent`. Verification states: `unverified`, `pending`, `verified`, `rejected`. Status: `draft`, `active`, `suspended`.
- Caller identity comes only from the gin key `user_id`; never from the request body or URL.
- Admin routes require RBAC permission `property.roles.review`, fail-closed.
- No money moves; the Idempotency-Key rule does not apply.
- Live-DB tests gate on `TEST_DATABASE_URL` only, seed with `t.Cleanup`, never `defer pool.Close()`.
- Conventional Commits. Frontend-admin and mobile must type-check; golden-path regression (`cd frontend-web && npm run test:regression`, 120 tests) stays green.

## Review Focus

1. Two concurrent `register` calls for the same `(user, role)` must yield one row and no error (Task 3 test).
2. `submit` with a document but missing required details must be rejected and leave state `unverified` (Task 3 test).
3. A document `storage_key` outside the caller's `property-roles/{userID}/{role}/` prefix must be refused, so a user cannot attach someone else's uploaded file (Task 3 test).
4. Approve/reject on a profile that is not `pending` must fail with no state change; approving twice must not re-stamp `verified_at` (Task 3 test).
5. Editing the licence/CAC/organisation field of a `verified` profile must reset it to `unverified`, and a `suspended` profile must be uneditable and fail `IsVerified` (Task 3 test).

---

### Task 1: API contract

**Files:**
- Modify: `contracts/property.openapi.yaml`

**Interfaces:**
- Produces: the endpoint list and the `RoleProfile` schema that Tasks 4, 6, 7 implement.

- [ ] **Step 1: Add the paths and schemas.** Member paths: `GET /api/finance/property/roles`, `POST|PATCH /api/finance/property/roles/{role}`, `POST /api/finance/property/roles/{role}/documents/presign`, `POST /api/finance/property/roles/{role}/documents`, `POST /api/finance/property/roles/{role}/submit`. Admin paths: `GET /api/property/admin/roles?status=`, `POST /api/property/admin/roles/{id}/approve|reject|suspend`. Schema `RoleProfile` has the columns in the spec's Data model section (camel-case JSON: `id, userId, role, status, verificationStatus, displayName, details, rejectionReason, verifiedAt, createdAt, updatedAt, documents[]`). Quote any description containing a comma if written in flow style.
- [ ] **Step 2: Validate.** Run: `npx --yes @redocly/cli@latest lint contracts/property.openapi.yaml`. Expected: zero errors.
- [ ] **Step 3: Commit.** `git add contracts/property.openapi.yaml && git commit -m "docs(contracts): property role registration endpoints"`

### Task 2: Migration, RBAC seed and schema test

**Files:**
- Create: `supabase/migrations/<version>_property_role_registration.sql`
- Create: `backend/tests/propertyroles/fixtures_test.go`, `backend/tests/propertyroles/schema_live_db_test.go`

**Interfaces:**
- Produces: tables `property_role_profiles`, `property_role_documents`, `property_role_events` exactly as in the spec; permission `property.roles.review` granted to the `super-admin` role. Task 3 repository queries rely on these column names.

- [ ] **Step 1: Write the failing schema test** in `schema_live_db_test.go`: `TestSchema_UniquePerUserAndRole` (second insert of the same `(user_id, role)` fails with unique violation), `TestSchema_RejectsUnknownRole` (role `'landlord'` violates the CHECK), `TestSchema_RejectsUnknownVerificationStatus`, `TestSchema_DocumentsCascadeWithProfile`. `fixtures_test.go` provides `propertyPool(t) *pgxpool.Pool` (skips without `TEST_DATABASE_URL`, registers `t.Cleanup(pool.Close)` first) and `anyUser(t, ctx, pool) string` (borrows an existing `auth.users` id, same as `backend/tests/voting/fixtures_test.go`).
- [ ] **Step 2: Run to verify failure.** `cd backend && TEST_DATABASE_URL=postgres://postgres:postgres@localhost:54322/postgres go test ./tests/propertyroles/ -run TestSchema -v`. Expected: FAIL, relation does not exist.
- [ ] **Step 3: Write the migration.** Tables, CHECKs, UNIQUE `(user_id, role)`, indexes on `(verification_status, updated_at)` and on `profile_id` for both child tables, RLS enable and revokes (guarded by `pg_roles` existence like `20270170000000_restaurant_likes_rls_lockdown.sql`), and the permission insert into `public.permissions` with `module='property', resource='roles', action='review', is_system_permission=true` plus the `role_permissions` grant to `super-admin` (same shape as `20260703000000_property_suite_rbac.sql`). Whole file in one `BEGIN/COMMIT`.
- [ ] **Step 4: Apply locally and re-run.** `psql postgres://postgres:postgres@localhost:54322/postgres -f supabase/migrations/<version>_property_role_registration.sql`, then the Step 2 command. Expected: PASS.
- [ ] **Step 5: Collision check.** `bash scripts/ci/check-migration-versions.sh`. Expected: "all versions unique".
- [ ] **Step 6: Commit.** `git add supabase/migrations backend/tests/propertyroles && git commit -m "feat(property): role registration schema + review permission"`

### Task 3: Domain, validation, repository and service

**Files:**
- Create: `backend/internal/property/roles/model.go`, `validate.go`, `validate_test.go`, `repo.go`, `service.go`
- Test: `backend/tests/propertyroles/service_live_db_test.go`

**Interfaces:**
- Consumes: Task 2 tables.
- Produces (package `roles`):
  - Constants `RoleEstateManager = "estate_manager"`, `RoleDeveloper = "developer"`, `RoleAgent = "agent"`; `func ValidRole(role string) bool`.
  - `type Profile struct` mirroring the columns, plus `Documents []Document`; `type Document struct{ ID, Kind, StorageKey string; CreatedAt time.Time }`.
  - Errors: `ErrInvalidRole`, `ErrNotFound`, `ErrSuspended`, `ErrIncomplete` (carries missing field names), `ErrNoDocument`, `ErrBadTransition`, `ErrForeignKey` (document key outside caller prefix), `ErrDetailsInvalid`.
  - `func ValidateDetails(role string, details map[string]any) error` (unknown keys, 8 KB cap, types; returns `ErrDetailsInvalid`) and `func MissingForSubmit(role string, details map[string]any) []string` (required keys from the spec table: agent `licenceNumber`, `operatingStates`; developer `companyName`, `cacNumber`; estate_manager `organisationName`).
  - `func NewRepository(db *pgxpool.Pool) *Repository`, `func NewService(repo *Repository) *Service`.
  - Service methods (all take `ctx context.Context`): `Register(userID, role, displayName string) (*Profile, error)`, `Update(userID, role string, displayName *string, details map[string]any) (*Profile, error)`, `AddDocument(userID, role, kind, storageKey string) (*Profile, error)`, `Submit(userID, role string) (*Profile, error)`, `MyRoles(userID string) ([]Profile, error)`, `ListByVerification(status string, limit, offset int) ([]Profile, error)`, `Approve(adminID, profileID string) (*Profile, error)`, `Reject(adminID, profileID, reason string) (*Profile, error)`, `Suspend(adminID, profileID, reason string) (*Profile, error)`, `IsVerified(userID, role string) (bool, error)`.
  - `func DocumentKeyPrefix(userID, role string) string` returning `property-roles/{userID}/{role}/`.

- [ ] **Step 1: Write the validation unit tests** in `validate_test.go`: unknown key rejected; 8 KB+ payload rejected; `MissingForSubmit` lists exactly the required keys per role; valid agent details pass.
- [ ] **Step 2: Write the failing live-DB service tests** in `service_live_db_test.go` named after the Review Focus items: `TestRegister_ConcurrentCallsYieldOneRow`, `TestSubmit_RejectedWhenRequiredDetailsMissingEvenWithDocument`, `TestSubmit_RejectedWithoutDocument`, `TestAddDocument_RefusesKeyOutsideCallersPrefix`, `TestApprove_OnlyFromPendingAndNotRestamped`, `TestReject_RequiresReason`, `TestUpdate_IdentityFieldOnVerifiedResetsToUnverified`, `TestUpdate_DisplayNameOnVerifiedKeepsVerification`, `TestSuspended_CannotEditAndIsNotVerified`, `TestIsVerified_FalseForDraftPendingRejectedSuspended_TrueOnlyForVerifiedActive`, `TestEvents_WrittenForEveryTransition`.
- [ ] **Step 3: Run both to verify failure** (`go test ./internal/property/roles/ ./tests/propertyroles/ -v`). Expected: FAIL, package missing.
- [ ] **Step 4: Implement** `model.go`, `validate.go`, `repo.go`, `service.go`. Register uses `INSERT ... ON CONFLICT (user_id, role) DO UPDATE SET updated_at = property_role_profiles.updated_at RETURNING ...` so the second call returns the existing row. Every state change and its `property_role_events` row run in one transaction; `Approve`/`Reject`/`Suspend` lock the row with `SELECT ... FOR UPDATE` before checking the transition. `IsVerified` returns `(false, err)` on any error.
- [ ] **Step 5: Run both to verify they pass.** Expected: PASS for the unit tests, PASS (or SKIP without `TEST_DATABASE_URL`) for the live tests; run once with the env var set so they actually execute.
- [ ] **Step 6: Commit.** `git add backend/internal/property/roles backend/tests/propertyroles && git commit -m "feat(property): role profile service with verification lifecycle"`

### Task 4: HTTP handlers, flag and route wiring

**Files:**
- Create: `backend/internal/property/roles/handler.go`, `backend/internal/property/roles/handler_test.go`
- Modify: `backend/internal/config/config.go` (add `FeaturePropertyRolesEnabled bool` beside `FeaturePropertySuiteEnabled`, env `FEATURE_PROPERTY_ROLES_ENABLED`, default false), `backend/internal/app/finance_routes.go` (register after the property suite block near line 1397)

**Interfaces:**
- Consumes: Task 3 `Service`; `r2.Presigner` from `backend/internal/platform/r2` (`Configured() bool`, `PresignPut(key, contentType string, expiry time.Duration) (string, error)`), constructed the way `estate.Handler.WithPresigner` is wired.
- Produces: `func NewHandler(svc *Service, presigner *r2.Presigner) *Handler`; `func RegisterMember(g gin.IRouter, h *Handler)` and `func RegisterAdmin(g gin.IRouter, h *Handler, perm gin.HandlerFunc)`; the route table in the spec.

- [ ] **Step 1: Write failing handler tests** (httptest, fake service via a small interface): 401 when `user_id` is empty; `:role` not in the three roles gives 400; presign returns 503 when the presigner is not `Configured()` (fail closed, same wording style as the association logo presign); body `userId` fields are ignored; admin routes return 403 when the permission middleware denies.
- [ ] **Step 2: Run to verify failure.** `go test ./internal/property/roles/ -run TestHandler -v`. Expected: FAIL.
- [ ] **Step 3: Implement the handlers and `RegisterMember/RegisterAdmin`.** Presign endpoint accepts `{fileName, contentType}`, allows `image/png`, `image/jpeg`, `image/webp`, `application/pdf`, builds the key with `DocumentKeyPrefix` plus a random token, and returns `{uploadUrl, objectKey, contentType, expiresIn, method}`. Map service errors to 400/404/409/422/403.
- [ ] **Step 4: Wire it.** In `finance_routes.go`, when `cfg.FeaturePropertyRolesEnabled && pool != nil`: build the service/handler, `RegisterMember(finance.Group("/property/roles", mapsAuth()), h)`, and `RegisterAdmin(r.Group("/api/property/admin/roles", mapsAuth()), h, middleware.RequirePermission(rbac, "property.roles.review"))`. Log a skip line when the flag is off, like the other modules.
- [ ] **Step 5: Verify.** `cd backend && go build ./... && go vet ./... && go test ./internal/property/... -count=1`. Expected: all pass.
- [ ] **Step 6: Commit.** `git commit -am "feat(property): role registration routes behind FEATURE_PROPERTY_ROLES_ENABLED"`

### Task 5: Role entities in the context aggregator

**Files:**
- Modify: `backend/internal/property/context.go` (`validContextTypes`, `GetContext`, add `func (s *Service) WithRoles(enabled bool) *Service`), `backend/internal/app/finance_routes.go` (call `WithRoles(cfg.FeaturePropertyRolesEnabled)` where `property.NewService(pool)` is built)
- Test: `backend/tests/propertyroles/context_live_db_test.go`

**Interfaces:**
- Consumes: Task 2 table. Produces: context entities `{Type:"role", ID:<profile id>, Name:<display_name>, Roles:[<role>]}` for profiles with `status='active'`, only when `WithRoles(true)`.

- [ ] **Step 1: Write failing tests:** `TestContext_IncludesActiveRoleProfiles` (verified+active profile appears; draft and suspended do not), `TestContext_OmitsRolesWhenDisabled` (same data, `WithRoles(false)` returns no `role` entities and does not touch the new table), `TestSwitchContext_AcceptsOwnRoleProfileAndRefusesOthers`.
- [ ] **Step 2: Run to verify failure.**
- [ ] **Step 3: Implement** the extra query and add `"role": true` to `validContextTypes`.
- [ ] **Step 4: Run to verify pass,** plus `go test ./internal/property/... ./tests/propertyroles/ -count=1`.
- [ ] **Step 5: Commit.** `git commit -am "feat(property): surface active role profiles in role context"`

### Task 6: Mobile registration screens

**Files:**
- Create: `mobile-app/reactnative/src/features/property/roles/{types.ts,api.ts,hooks.ts,requirements.ts,requirements.test.ts}`, `mobile-app/reactnative/app/property/role-profile.tsx`
- Modify: `mobile-app/reactnative/app/property/roles.tsx`

**Interfaces:**
- Consumes: Task 4 routes. Produces: `type ProfessionalRole = 'estate_manager' | 'developer' | 'agent'`; `requiredFieldsFor(role: ProfessionalRole): string[]` (same keys as the Go `MissingForSubmit`); hooks `useMyRoleProfiles()`, `useRegisterRole()`, `useUpdateRoleProfile(role)`, `useSubmitRoleForVerification(role)`, `useUploadRoleDocument(role)`; route `/property/role-profile?role=<ProfessionalRole>`.

- [ ] **Step 1: Write failing unit tests** in `requirements.test.ts` (node:test runner, see `docs`/memory "RN Unit Test Runner" pattern in other `*.test.ts` files): per-role required fields match the spec table exactly; `requiredFieldsFor` returns a copy.
- [ ] **Step 2: Run to verify failure.** Use the repo's existing mobile unit-test command (grep `package.json` `test:unit`). Expected: FAIL.
- [ ] **Step 3: Implement** `requirements.ts`, then `api.ts` following `features/property/api.ts` (live by default; mock only via `mockAllowed(process.env.EXPO_PUBLIC_PROPERTY_USE_MOCK, ...)`), with the upload flow modelled on `features/association/api/logoUpload.api.ts` (presign, then PUT, then record). Treat the presign 503 as an explicit "uploads not configured" state, not a retryable error.
- [ ] **Step 4: Add the screens.** In `roles.tsx`, keep the existing tenant/landlord/host list and add a second section "Register as a professional" with the three roles; selecting one calls register then routes to `role-profile`. `role-profile.tsx` shows the form for the role's fields, document picker/upload, a Submit button disabled until `requiredFieldsFor` is satisfied and a document exists, and a status banner for the four verification states including the rejection reason. Follow `mobile-app/reactnative/design.md` tokens and use `confirmAsync` from `src/lib/confirm.ts`, never raw `Alert.alert`, for any confirmation.
- [ ] **Step 5: Verify.** `cd mobile-app/reactnative && node --stack-size=10000 ./node_modules/.bin/tsc --noEmit` (exit 0) and the unit tests pass.
- [ ] **Step 6: Commit.** `git add mobile-app && git commit -m "feat(mobile): register and verify property roles"`

### Task 7: Admin review queue

**Files:**
- Create: `frontend-admin/src/services/propertyRolesAdminService.ts`, `frontend-admin/app/admin/property-roles/page.tsx`
- Modify: the admin navigation config that lists `merchant-onboarding` (grep for it) to add "Property roles", visible only with `property.roles.review`

**Interfaces:**
- Consumes: Task 4 admin routes via the existing `adminApiClient` conventions (`apiV1()`/`adminAuthHeaders()` pattern). Produces: `listPendingRoles(): Promise<RoleProfile[]>`, `approveRole(id)`, `rejectRole(id, reason)`, `suspendRole(id, reason)`.

- [ ] **Step 1: Write the service and a failing test** that a non-2xx response rejects (not a silent empty list), mirroring `adminSimulatedWrites.test.ts` expectations that writes never fake success.
- [ ] **Step 2: Build the page:** table of pending profiles with details and document links, approve/reject (reason required)/suspend actions.
- [ ] **Step 3: Verify.** `cd frontend-admin && npm run type-check`. Expected: exit 0.
- [ ] **Step 4: Commit.** `git add frontend-admin && git commit -m "feat(admin): property role verification queue"`

### Task 8: Rollout wiring and ADR

**Files:**
- Modify: `.github/workflows/staging-module-flags.yml` (add `FEATURE_PROPERTY_ROLES_ENABLED=true` to the backend variable list and `"PROPERTY_ROLES"` to the verify array)
- Create: `docs/adr/ADR-PR<pr-number>-property-role-registration.md` (use the real PR number once the PR exists; never invent one)

- [ ] **Step 1: Edit the workflow** and validate: `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/staging-module-flags.yml'))"` and `actionlint .github/workflows/staging-module-flags.yml`. Expected: no output / exit 0.
- [ ] **Step 2: Write the ADR** covering: generic table over per-role tables, self-serve then verify, edit-resets-verification, own events table, `role` context type, why `IsVerified` ships without callers.
- [ ] **Step 3: Full verification.** `cd backend && go build ./... && go vet ./... && go test ./internal/property/... -count=1`; with `TEST_DATABASE_URL` set, `go test ./tests/propertyroles/ -v`; `cd frontend-web && npm run test:regression`; `bash scripts/ci/check-migration-versions.sh`.
- [ ] **Step 4: Commit.** `git add .github docs && git commit -m "chore(property): rollout flag wiring and ADR for role registration"`

## Rollout (not executed without explicit approval)

Order matters because the aggregator and routes assume the tables exist: (1) apply the migration to the staging project, re-checking the version against the live `schema_migrations` first; (2) deploy the backend; (3) run `staging-module-flags.yml` with `confirm=SET`. Each is a shared-infrastructure action and needs the owner's go-ahead at the time.
