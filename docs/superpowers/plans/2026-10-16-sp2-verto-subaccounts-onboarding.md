# SP-2: Verto Sub-Accounts, KYB Onboarding & Wallet Provisioning — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax. This is a brownfield financial-system module: tests first, additive-only migration, feature-flag everything, request `security-reviewer` before merge (auth/PII), PRs < 400 lines where possible, ADR for the non-obvious design choice.

**Goal:** Backend lifecycle for a Spotlight user's Verto "Global Account": activate → submit KYB/KYC → accept T&C → provisioned & ACTIVE with USD/EUR/GBP/NGN wallets, reusing the existing Spotlight KYC layer and the SP-1 VertoFX client, dark behind `FEATURE_SPOTLIGHT_GLOBAL`.

**Architecture:** New domain `backend/internal/crossborder/onboarding/` (ports-and-adapters: model/state/ports/mapper/service/repository/http) behind the flag. The SP-1 `vertofx` client gains sub-account/onboarding/wallet methods; a thin adapter satisfies the domain's `SubAccountProvider`/`WalletProvisioner` ports so no Verto types leak into the domain. Webhook `account.*`/T&C events are *applied* (not just mapped) through `onboarding.Service`.

**Tech Stack:** Go 1.27 / Gin; pgx pool; PostgreSQL via Supabase (additive migration); `net/http`+`httptest` tests; reuse `internal/finance/tiers`, `internal/finance/kyc`, `internal/finance/kycverify`.

**Spec:** [`docs/superpowers/specs/2026-10-16-sp2-verto-subaccounts-onboarding-design.md`](../specs/2026-10-16-sp2-verto-subaccounts-onboarding-design.md) · Program: [`2026-10-16-vertofx-spotlight-global-program.md`](2026-10-16-vertofx-spotlight-global-program.md)

## Global Constraints

- `FEATURE_SPOTLIGHT_GLOBAL` (default **false**): flag-off means the `/v1/global/*` routes are not mounted and nothing in this module is reachable. Follows `getEnvBool` + conditional-mount pattern (`finance_routes.go`).
- **Fail-closed:** activation requires Spotlight **Tier ≥ 2** (`tiers.Service.GetUserTier`); a tier error or DB error refuses, never proceeds. No account reaches `ACTIVE` and no wallet is provisioned without a provider approval **confirmed by a `GetSubAccount` GET**.
- **Idempotent:** activation (same user → same account, one Verto sub-account), document submit, and wallet provisioning are idempotent; webhook redelivery never double-provisions. Idempotency key on `provider_accounts` = our account id.
- **No Verto types outside `backend/internal/provider/vertofx/`** and the adapter; the domain speaks Spotlight types across `ports.go`.
- **Money:** int64 minor units where amounts appear (none move in SP-2 — wallet rows are metadata; no `ledger_accounts`/`ledger_entries` changes).
- **Migration additive-only** (no DROP/rename/type-narrow); unique 14-digit timestamp; re-check the stamp for collisions immediately before merge.
- **PII:** account numbers / ID fields encrypted at rest; never log secrets/PII; consent log append-only. Object-level authz on every endpoint (caller must own the `provider_account`).
- Subject types: `individual` (sole-prop: self = sole director + 100% UBO + controlling officer) and `business` (full company + UBO ≥ 25%). Both serialize to Verto's company/shareholder schema. Verto doc-type IDs / risk-question IDs are **config, not hard-coded**.

## Review Focus

- **Double activation** (user taps activate twice, or retries after a network blip): must return the existing account and create exactly one Verto sub-account, never a second. → Task 5 test.
- **Approval webhook redelivered / out of order:** wallets provisioned exactly once; a late/duplicate/stale event never regresses state or re-provisions. → Task 6 test.
- **Tier < 2 or KYC incomplete at activation:** refused fail-closed with a clear reason, no sub-account created. → Task 5 test.
- **Object-level authz:** user A cannot read `status`/`wallets`/`funding-details` or submit documents/T&C for user B's account (not just route-level auth). → Task 7 test.
- **Rejected → resubmit:** a REJECTED account can resubmit documents (ADD/UPDATE/DELETE) and return to SUBMITTED — never a dead end. → Task 5/Task 2 tests.

---

### Task 1: Extend the VertoFX client with onboarding + wallet methods

**Files:**
- Modify: `backend/internal/provider/vertofx/vertofx.go`
- Modify/Create: `backend/internal/provider/vertofx/vertofx_onboarding_test.go`

**Interfaces:**
- Produces (all on `*Client`, idempotent writes carry a stable key where the API supports it): `CreateSubAccount(ctx, in SubAccountInput) (SubAccount, error)` → `SubAccount{CompanyID, Status string}`; `SubmitOnboarding(ctx, companyID string, data OnboardingData) error`; `GetSubAccount(ctx, companyID string) (SubAccount, error)`; `EnsureWallet(ctx, companyID, currency string) (Wallet, error)` → `Wallet{WalletID, Currency, Status string}`; `GetFundingDetails(ctx, companyID, currency string) (Funding, error)`; `GenerateUploadLink(ctx, companyID string, in UploadLinkInput) (UploadLink, error)`. Types live in `package vertofx` only.

- [ ] **Step 1: Write failing tests** (httptest, mirroring the SP-1 `vertofx_test.go` pattern): `TestClient_CreateSubAccount_SendsIdentityAndType`, `TestClient_SubmitOnboarding_PostsPayloadToCompany`, `TestClient_GetSubAccount_ParsesStatus`, `TestClient_EnsureWallet_Idempotent` (same currency twice → one logical wallet), `TestClient_GetFundingDetails_ParsesDedicatedAndPooled`, `TestClient_GenerateUploadLink`. Include the offline-mock path (no creds → deterministic stub, zero HTTP).
- [ ] **Step 2: Run tests, verify fail** — `cd backend && go test ./internal/provider/vertofx/ -run 'SubAccount|Onboarding|Wallet|Funding|UploadLink' -v` → FAIL.
- [ ] **Step 3: Implement** the methods on `*Client`, reusing the existing token/`do`/`live()` machinery. Model request/response structs on the vision spec's Appendix B (`sub-accounts`, `companies/{companyId}/onboarding-data`, `wallets`, funding methods, Document Link Generation). Sub-account scoping (companyId in path vs header, V8) is isolated here.
- [ ] **Step 4: Run tests, verify pass** → PASS; `go build ./... && go vet ./internal/provider/vertofx/`.
- [ ] **Step 5: Commit** — `feat(vertofx): add sub-account, onboarding and wallet client methods`

---

### Task 2: Onboarding domain model + state machine

**Files:**
- Create: `backend/internal/crossborder/onboarding/model.go`
- Create: `backend/internal/crossborder/onboarding/state.go`
- Create: `backend/internal/crossborder/onboarding/state_test.go`

**Interfaces:**
- Produces: `SubjectType` (`Individual|Business`); `Status` (`NotStarted|Submitted|InReview|AwaitingTnC|Active|Rejected|Suspended`); `GlobalAccount` struct (id, userID, provider, subjectType, providerCompanyID, status, timestamps, rejectionReason); `ProviderWallet`, `FundingDetail`, `Consent`; `CanTransition(from, to Status) bool` and `MapProviderStatus(vertoStatus string) Status` (maps both Verto vocabularies). No Verto imports.

- [ ] **Step 1: Write failing tests** in `state_test.go`: `TestCanTransition_LegalPaths` (NotStarted→Submitted→InReview→AwaitingTnC→Active; InReview→Active; InReview→Rejected→Submitted; *→Suspended→prior), `TestCanTransition_RejectsRegression` (Active→InReview false, etc.), `TestMapProviderStatus_BothVocabularies` (Pending/Active/Suspended and CREATED/APPROVED/REJECTED).
- [ ] **Step 2: Run, verify fail** — `cd backend && go test ./internal/crossborder/onboarding/ -run 'Transition|MapProvider' -v` → FAIL (package/symbols undefined).
- [ ] **Step 3: Implement** the enums, structs, the legal-transition table and `MapProviderStatus`. Monotonic: `CanTransition` returns false for any non-forward move except the explicit Suspended/resubmit edges.
- [ ] **Step 4: Run, verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat(onboarding): global-account model and state machine`

---

### Task 3: Ports + onboarding payload mapper

**Files:**
- Create: `backend/internal/crossborder/onboarding/ports.go`
- Create: `backend/internal/crossborder/onboarding/mapper.go`
- Create: `backend/internal/crossborder/onboarding/mapper_test.go`

**Interfaces:**
- Consumes: `SubjectType` (Task 2); a `KYCReader` view of existing KYC (legal name, DOB, address, BVN/NIN presence) — define the small interface here and back it in Task 5 with `kyc`/`kycverify`.
- Produces: ports `SubAccountProvider` (CreateSubAccount/SubmitOnboarding/GetSubAccount/GenerateUploadLink), `WalletProvisioner` (EnsureWallet/GetFundingDetails), `KYCReader`, `Clock` — all in domain types; `BuildOnboardingData(subjectType, profile Profile, kyc KYCView, extras ActivateExtras) (OnboardingPayload, error)` where `OnboardingPayload` is a domain-side representation the adapter translates to `vertofx.OnboardingData`.

- [ ] **Step 1: Write failing golden tests** in `mapper_test.go`: `TestBuildOnboardingData_Individual` (one INDIVIDUAL shareholder = user, ownership 100%, controllingOfficer true, role director; selectedProducts Collect/Convert/Pay/Hold; the user's documents) and `TestBuildOnboardingData_Business` (company + UBO ≥ 25% shareholders, company documents). Assert the exact produced structure.
- [ ] **Step 2: Run, verify fail** — `cd backend && go test ./internal/crossborder/onboarding/ -run BuildOnboardingData -v` → FAIL.
- [ ] **Step 3: Implement** `ports.go` interfaces and `mapper.go`. Doc-type / risk-question IDs read from a config/struct passed in `extras` (not literals).
- [ ] **Step 4: Run, verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat(onboarding): ports and Verto onboarding payload mapper (individual + business)`

---

### Task 4: Repository + additive migration

**Files:**
- Create: `backend/internal/crossborder/onboarding/repository.go`
- Create: `supabase/migrations/<ts>_crossborder_onboarding.sql`
- Create: `backend/internal/crossborder/onboarding/repository_live_db_test.go` (gated on `TEST_DATABASE_URL`)

**Interfaces:**
- Consumes: domain structs (Task 2).
- Produces: `Repository` with `CreateAccount`, `GetAccountByUser`, `GetAccountByCompanyID`, `UpdateStatus(id, from, to Status, …)` (compare-and-set on `from` for monotonic safety), `UpsertWallet`, `UpsertFundingDetail`, `RecordSubmission`, `RecordConsent`. Idempotency via unique `(user_id, provider)` for in-flight/active accounts and `idempotency_key UNIQUE`.

- [ ] **Step 1: Write failing live-DB test** (skips unless `TEST_DATABASE_URL`): create account, read by user + companyID, conditional `UpdateStatus` (rejects a stale `from`), upsert wallet/funding idempotently, record consent.
- [ ] **Step 2: Run, verify fail/skip** — `cd backend && go test ./internal/crossborder/onboarding/ -run Repo -v` (FAIL to compile, or SKIP without DB — note which).
- [ ] **Step 3: Write the additive migration** (tables from spec §8; PII columns encrypted-at-rest per existing convention; unique indexes) and implement `repository.go` on the pgx pool, following `internal/finance/*/repository.go` patterns. Conditional `UpdateStatus` uses a `WHERE status = $from` guard.
- [ ] **Step 4: Verify** — `go build ./... && go vet ./internal/crossborder/onboarding/`; run the live-DB test if `TEST_DATABASE_URL` is set, else confirm it skips cleanly. Re-check the migration timestamp for collisions.
- [ ] **Step 5: Commit** — `feat(onboarding): repository and additive migration`

---

### Task 5: Service — activate, documents, T&C, provisioning

**Files:**
- Create: `backend/internal/crossborder/onboarding/service.go`
- Create: `backend/internal/crossborder/onboarding/service_test.go`

**Interfaces:**
- Consumes: Tasks 2–4 (model/state, ports/mapper, repository), `tiers.Service` (via a small `TierReader` interface), the `SubAccountProvider`/`WalletProvisioner`/`KYCReader` ports.
- Produces: `Service` with `Activate(ctx, userID string, in ActivateInput) (GlobalAccount, error)`, `SubmitDocuments(ctx, userID string, docs []DocumentRef) error`, `AcceptTnC(ctx, userID string, in TnCAcceptance) error`, `GetStatus(ctx, userID string) (StatusView, error)`, and internal `ensureWallets(ctx, acct) error` (idempotent, used by Task 6 on ACTIVE). `NewService(Deps{...})`.

- [ ] **Step 1: Write failing tests** with a fake provider + in-memory/stub repo + stub tier reader:
  - `TestActivate_RefusesBelowTier2` (Tier < 2 → refused, no sub-account created). (Review Focus)
  - `TestActivate_Idempotent` (two calls → one account, one `CreateSubAccount`). (Review Focus)
  - `TestActivate_IndividualAndBusiness` (maps subjectType → correct payload via the mapper).
  - `TestEnsureWallets_ProvisionsOncePerCurrency` (USD/EUR/GBP/NGN; re-run provisions nothing new). (Review Focus)
  - `TestRejectedResubmit_ReturnsToSubmitted` (REJECTED + SubmitDocuments → SUBMITTED). (Review Focus)
  - `TestAcceptTnC_MovesAwaitingTnCToActive`.
- [ ] **Step 2: Run, verify fail** — `cd backend && go test ./internal/crossborder/onboarding/ -run 'Activate|EnsureWallets|Resubmit|TnC' -v` → FAIL.
- [ ] **Step 3: Implement** `service.go`: tier-gate fail-closed; idempotent activate (look up existing account first); build payload (mapper) from `KYCReader`+profile; create sub-account + persist + submit onboarding; `ensureWallets` provisions the D4 currency set and stores funding details idempotently; `AcceptTnC`/`SubmitDocuments` drive state via the repository's conditional `UpdateStatus`.
- [ ] **Step 4: Run, verify pass** → PASS.
- [ ] **Step 5: Commit** — `feat(onboarding): activation, documents, T&C and wallet provisioning service`

---

### Task 6: Apply Verto account webhooks through the onboarding service

**Files:**
- Modify: `backend/internal/orchestration/webhooks_vertofx.go` (or the vertofx webhook dispatch) to call the onboarding applier
- Create: `backend/internal/crossborder/onboarding/webhook.go` (the `HandleProviderStatus` applier) + `webhook_test.go`

**Interfaces:**
- Consumes: `Service` (Task 5), `MapProviderStatus`/`CanTransition` (Task 2), `SubAccountProvider.GetSubAccount` (Task 1/3).
- Produces: `Service.HandleProviderStatus(ctx, companyID string, ev NormalizedAccountEvent) error` — resolves the account by companyID, GET-confirms the provider status, applies a monotonic transition, and on entry to ACTIVE calls `ensureWallets` (idempotent). The orchestration vertofx handler routes `account.*`/T&C normalized events here.

- [ ] **Step 1: Write failing tests** in `webhook_test.go`: `TestHandleProviderStatus_ApprovalProvisionsOnce` (approved → ACTIVE + wallets once; redelivered approval → no second provision) (Review Focus); `TestHandleProviderStatus_Monotonic` (stale/older event does not regress ACTIVE); `TestHandleProviderStatus_RejectedSetsReason`; `TestHandleProviderStatus_GetConfirmBeforeApply` (applies the GET-confirmed status, not the raw event, when they differ); `TestHandleProviderStatus_UnknownNoop`.
- [ ] **Step 2: Run, verify fail** — `cd backend && go test ./internal/crossborder/onboarding/ -run HandleProviderStatus -v` → FAIL.
- [ ] **Step 3: Implement** `webhook.go` applier (GET-confirm → `CanTransition` → repository conditional update → `ensureWallets` on ACTIVE) and wire the orchestration vertofx webhook handler to call it for `account.*`/T&C events (dedupe on event id already exists). Keep the V6 GET-confirm comment.
- [ ] **Step 4: Run, verify pass** → PASS; `go test ./internal/orchestration/... ./internal/crossborder/... -count=1`.
- [ ] **Step 5: Commit** — `feat(onboarding): apply Verto account lifecycle webhooks (provision on active)`

---

### Task 7: HTTP endpoints, authz, flag + wiring

**Files:**
- Create: `backend/internal/crossborder/onboarding/http.go` + `http_test.go`
- Modify: `backend/internal/config/config.go` (+ `.env.example`) — add `FeatureSpotlightGlobalEnabled` ← `FEATURE_SPOTLIGHT_GLOBAL` (default false)
- Modify: `backend/internal/app/finance_routes.go` — mount the group behind the flag
- Modify: `frontend-web/src/lib/feature-flags.ts` — add `FEATURE_SPOTLIGHT_GLOBAL`

**Interfaces:**
- Consumes: `Service` (Task 5), existing auth/RBAC middleware (`RequireAuthContext` + the money-action step-up policy), `cfg.FeatureSpotlightGlobalEnabled`.
- Produces: the `/v1/global/*` handlers from spec §10, each enforcing object-level ownership of the `provider_account`.

- [ ] **Step 1: Write failing tests** in `http_test.go` (httptest + a stub service): `TestStatus_RequiresOwnership` (user B gets 403/404 for user A's account — **not** a route-level-only check) (Review Focus); `TestActivate_StepUpRequired`; `TestRoutes_UnmountedWhenFlagOff`; happy-path status/activate/funding-details shape.
- [ ] **Step 2: Run, verify fail** — `cd backend && go test ./internal/crossborder/onboarding/ -run 'Status|Activate|Routes' -v` → FAIL.
- [ ] **Step 3: Implement** handlers + DTO validation + object-level authz (resolve the caller's own account; reject cross-user access), add the config flag + `.env.example` + Next flag entry, and mount the group inside `if cfg.FeatureSpotlightGlobalEnabled { ... }` in `finance_routes.go` (mirror the FX-orchestration mount).
- [ ] **Step 4: Verify** — `cd backend && go build ./... && go vet ./... && go test ./internal/crossborder/... ./internal/app/... ./internal/config/ -count=1`; flag-off path mounts nothing. `cd frontend-web && npx tsc --noEmit` for the flag change.
- [ ] **Step 5: Commit** — `feat(global): mount Global Account onboarding API behind FEATURE_SPOTLIGHT_GLOBAL`

---

## Done when
- Tier ≥ 2 user activates (individual or business), payload submits to the modeled Verto API, approval webhooks drive the state machine and provision USD/EUR/GBP/NGN wallets + funding details exactly once, object-level authz holds, all dark behind `FEATURE_SPOTLIGHT_GLOBAL`; `go build/vet` clean, affected tests green (live-DB repo test passes with `TEST_DATABASE_URL` or skips cleanly), additive migration stamp re-checked; `security-reviewer` requested; `ADR-PR<pr#>-global-account-onboarding.md` records the sole-prop modeling decision (placeholder number, assigned at merge).

## Deliberately NOT in SP-2
Pricing/platform fee, fee sweep/treasury, balances & money movement (SP-3); FX/convert/send wiring to Verto (SP-3/SP-4); mobile activation screens (SP-4); admin KYC queue (SP-5); manual non-default wallet currencies (later).
