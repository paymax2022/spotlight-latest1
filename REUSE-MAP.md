# REUSE-MAP.md

**Task:** T0.1 — Brownfield audit for the "School Fees, Payments & Cross-School Competition" EdTech module.
**Status:** Source of truth. Where this file and `docs/prd/school/PAYMAX-EDTECH-FEES-BUILD.md` / `TASKS.md` disagree, **this file wins** (per build-spec §0.1). Every signature, path, and table name below was verified by opening the file.

> **Repo reality in one line:** the PRD's assumed layout (`/services/edtech-fees/`, `/apps/mobile/parent/`, `/apps/admin-school/`, `/apps/admin-super/`) **does not exist**. This is a single Go monolith (`backend/`, Gin, module `spotlight/backend`) + a Next.js admin (`frontend-admin/`) + an Expo RN app (`mobile-app/reactnative/`). **Critically, a large `academy` module already exists and already implements ~70% of the "new" fees/vault/scholarship/leaderboard/school domain.** The EdTech module is a **brownfield EXTENSION of `academy`, not a greenfield service.**

---

## 0. TL;DR for the swarm

- **There is no `edtech`/`schools` top-level backend package to create.** There is `backend/internal/academy/` with sub-packages `schools/`, `edupay/`, `gamification/`, `curriculum/`, `assessment/`, `exam/`, `identity/`, `parent/`, `rewards/`, `credentials/`, `tutor/`, `commerce/`, `content/`, `progression/`, `live/`, `trade/`.
- **Two different "schools" things already exist and must not be confused:**
  - `academy/schools/` = **B2B2C institution licensing** (seats, licences, `academy_institution_billing`). NOT guardian invoices.
  - `academy/edupay/` = **guardian-facing school fees**: `School`, `FeeSchedule`, `EduPayAccount` (guardian↔student), `SavingsPot` (= the PRD's "FeesVault"), `Disbursement`, `Scholarship`. This is the closest match to the PRD's fee domain.
- **The wallet ledger, payment gateway, KYC tiers, guardian/consent identity, NERDC curriculum, and cross-school leaderboards all already exist and are wired.** Reuse them.
- **New target home:** put net-new EdTech-fees code in **`backend/internal/academy/fees/`** (a new sub-package under academy), reuse the ledger/edupay/gamification/identity/curriculum services, and register it inside the existing `RegisterAcademy(...)` in `backend/internal/app/academy_routes.go` behind a new sub-flag `FEATURE_ACADEMY_FEES_ENABLED` (following the existing `eduPayEnabled`/`schoolsEnabled` pattern).

---

## 1. Capability reuse table (verified interfaces)

| Capability | Real location (file:symbol) | Real signature / table | How EdTech reuses it | Do-NOT-duplicate |
|---|---|---|---|---|
| **Double-entry ledger** | `backend/internal/finance/ledger/service.go:Service.PostJournal` | `func (s *Service) PostJournal(ctx, j JournalEntry) error` where `JournalEntry{Reference, IdempotencyKey, AmountKobo int64, DebitAccountID, CreditAccountID, Description}` (`ledger/model.go`) | Post any balanced fees transfer between two ledger account IDs. Redis fast-path + DB unique `idempotency_key` (suffixed `:debit`/`:credit`) enforce idempotency (SF-2). | Do not create a second ledger or a balance column. Balance is a projection (`balanceProjectionSQL`), never `UPDATE`d. |
| **Wallet debit/credit (TOCTOU-safe)** | `backend/internal/finance/ledger/service.go:Service.Debit` / `.Credit` | `Debit(ctx, userID, reference, idempotencyKey, creditAccountID string, amountKobo int64) error`; `Credit(ctx, userID, reference, idempotencyKey, debitAccountID string, amountKobo int64) error` | Move guardian wallet → school/vault. `Debit` checks sufficiency under a pg advisory lock (`repository.go:DebitWithBalanceCheck`) — fail-closed `ErrInsufficientFunds`. | Do not read balance then debit on separate calls. Use `Debit`. |
| **Wallet service (higher level)** | `backend/internal/finance/wallet/service.go:Service.Credit`/`.Debit` | `Credit(ctx, userID, reference, idempotencyKey string, amountKobo int64) error` | Convenience over ledger for user-wallet money-in/out. | — |
| **Standing / sub-accounts + purpose tag (SF-5 FeesVault)** | `backend/internal/finance/ledger/service.go:Service.GetOrCreateStandingAccount`; `ledger/model.go:AccountType` | `GetOrCreateStandingAccount(ctx, accountType AccountType) (*Account, error)`. `AccountType` is a const enum (`user_wallet`, `escrow`, `placement_escrow`, …). | **Segregated FeesVault (SF-5):** add a new `AccountType` const e.g. `AccountEdtechFeesVault AccountType = "edtech_fees_vault"` in `ledger/model.go` (additive) and route all vault legs through a standing account of that type, so vault funds reconcile separately from general float. The `reference` string carries the human-readable purpose. **NOTE:** ledger has *no* free-form `purpose` column — segregation is by dedicated `AccountType`, verified in `model.go`. | Do not invent a shadow vault balance. The existing `edupay.SavingsPot` already does append-only pot contributions with `SavedMinor` as a projection — prefer extending that (see EduPay row). |
| **Reversal (corrections only)** | `backend/internal/finance/ledger/service.go:Service.PostReversal` | `PostReversal(ctx, restoreAccountID, releaseAccountID string, amountKobo int64, reference, idempotencyKey string) error` | Refunds/reversed fee payments. | No `DELETE`/`UPDATE` of entries — reversing entries only. |
| **Payment provider (gateway-agnostic)** | `backend/internal/provider/interfaces.go:PaymentProvider` | `InitializePayment(ctx, InitializePaymentRequest) (*InitializePaymentResponse, error)` (req carries `Email, AmountKobo, Reference, CallbackURL, IdempotencyKey`); `VerifyPayment(ctx, reference) (*PaymentStatus, error)`; `VerifyWebhookSignature([]byte, sig) bool`; `Name()`. Paystack impl: `backend/internal/provider/paystack/paystack.go`. | Record a payment **intent** by calling `InitializePayment`; the auth URL is returned to the parent app. | Do not `import` Paystack/Flutterwave SDKs inside the fees module. Always go through this interface. |
| **Payment webhook → reconcile** | `backend/internal/webhooks/paystack.go:PaystackHandler.Handle` / `.handleChargeSuccess` | `handleChargeSuccess` routes `charge.success` → `va.CreditInbound` / `wallet.Credit(ctx, userID, reference, idempotencyKey, amountKobo)`. HMAC verified via `VerifyWebhookSignature`. Live handler mounted in router. | Charge-success reconciliation for fee payments piggybacks on this pipeline; new fee events should follow the same idempotent credit path. For academy-specific async settlement there is also `backend/internal/app/academy_webhooks.go` (`/internal/webhooks/academy/*`). | Do not build a second webhook receiver/verifier. |
| **Academy money rails (already abstracted)** | `backend/internal/app/academy_rails_external.go`; `academy/schools/rails.go:BillingRail`; `academy/edupay/rails.go` (`CollectRail`, `DisburseRail`, `BNPLRail`) | `schools.BillingRail.Charge(ctx, institutionRef, reference, idemKey string, amountMinor int64) (ref string, err error)` — HTTP adapter `httpBillingRail` selected by `RAILS_MODE`, `nil` ⇒ `StubBillingRail`. EduPay collect/disburse/bnpl rails work the same way. | The fees module already has provider-agnostic rails wired via `RAILS_MODE` + per-rail base URL/API key in config. Reuse the same injected-rail pattern; don't add new provider integrations. | Do not integrate a gateway directly — inject a rail interface, compose at the root (`RegisterAcademy`). |
| **KYC tiers (gate money, fail-closed)** | `backend/internal/finance/kyc/service.go:Service.GetProfile`; `backend/internal/finance/tiers/service.go:Service.EnforceWalletDebitLimit` | `GetProfile(ctx, userID) (*Profile, error)` → `Profile.Tier`; `EnforceWalletDebitLimit(ctx, userID string, amountKobo int64) error`; `GetUserTier(ctx, userID) (Tier, error)`. Academy already adapts KYC via `academyKYC{svc}.Tier(...)` in `academy_routes.go`. | Gate escrow custody / high-value fee movement behind tier checks; reuse `academyKYC` adapter shape. | No parallel tier system. |
| **Auth + user_id in gin** | `backend/internal/middleware/auth_context.go:RequireAuthContext` | `RequireAuthContext(supabase *integrations.SupabaseRestClient, rbac services.RBACService) gin.HandlerFunc`. Sets `c.Set("user_id", id)`, `c.Set("user_email", email)`, and `authUser` (`domain.AuthenticatedUser{ID,Email,Status,Roles,Permissions}`) **before** `c.Next()`. Bearer token validated via `supabase.AuthUser(token)`. | Every fees endpoint mounts under a group with `RequireAuthContext`; read `c.GetString("user_id")`. Same pattern as `connect_routes.go`. | Don't re-implement auth or read the token manually. |
| **RBAC permission gate** | `backend/internal/middleware/authorization.go:RequirePermission` / `RequireScopedPermission` | `RequirePermission(rbac, permission string) gin.HandlerFunc` (checks `rbac.CheckPermission(uid, perm, "global", "")`); `RequireScopedPermission(rbac, permission, scopeType, scopeIDParam)` for per-school scoping. | Gate admin/bursar/teacher endpoints with slugs like `academy.fees.invoice.issue`; use scoped variant for per-school (`scope_type='school'`). | Don't invent a new authz layer. |
| **Guardian/student identity (reuse — SF-7)** | `backend/internal/academy/identity/model.go:GuardianLink`, `ConsentRecord`; table `academy_guardian_links` (status `pending→active→revoked`) + `academy_consent_records` (immutable) | `LinkGuardianRequest{MinorUserID}`, `RecordConsentRequest`. Purchase gate reads `academy_guardian_links WHERE minor_user_id=$1 AND status='active'` (`academy_routes.go:academyApprovalGate`). Users anchor to `auth.users` / `platform_users` / `user_profiles`. | Guardian = existing identity; one guardian identity spans all children. Minor-safe leaderboard (SF-7) reuses `academy_consent_records` for the "recorded guardian consent" flag. | Do not build a parallel guardian/student identity or consent store. |
| **NERDC curriculum spine** | `backend/internal/academy/curriculum/model.go` + `curriculum/seed.go:Seed` | Tables `academy_curriculum_versions` (seeded `NERDC-2025`, `LEGACY`), `academy_classes` (P1..SSS3), `academy_subjects` (with `exam_relevance` CCE/BECE/WASSCE/NECO/UTME), `academy_topics`, `academy_learning_objectives`. `Seed(ctx, pool) error` is idempotent, runs on startup. | Competition/quiz subject mapping references these version/subject IDs. | Do not fork the curriculum spine or re-seed NERDC. |
| **Quiz / question-bank / exam engine** | `backend/internal/academy/assessment/` (question bank + scoring, has `statemachine.go`), `backend/internal/academy/exam/` (CBT arenas, `statemachine.go`) | Registered via `assessment.RegisterAcademyAssessment(...)` and `exam.RegisterAcademyExam(...)` (gated `FEATURE_ACADEMY_EXAM_ENABLED`). | Cross-school competition (E7) drives quiz attempts through the existing assessment/exam engine. | Do not duplicate the question bank or scoring. |
| **Leaderboard (EXTEND, don't replace — E7)** | `backend/internal/academy/gamification/model.go:Leaderboard`,`LeaderboardEntry` | Tables `academy_leaderboards(scope CHECK IN ('class','school','national','friends'), scope_ref, period, reset_policy)` and `academy_leaderboard_entries(leaderboard_id, user_id, period_key, score, PK(leaderboard_id,user_id,period_key))` (migration `20260815000900_academy_engagement_commerce.sql`). Gamification is engagement-only — **no money**. | E7 must ADD scopes `city` and `state` (PRD wants class/school/city/state/national). The existing CHECK already covers `class`,`school`,`national`; add `city`,`state` via an **additive CHECK-relaxing migration** (see Gaps §4). Extend serializer for SF-7. | Do not create a new leaderboard table. Extend `academy_leaderboards`/`_entries`. |
| **EduPay fees domain (the big one — EXTEND)** | `backend/internal/academy/edupay/model.go` + `service.go` + `statemachine.go` | Tables (migration `20260815001100_academy_spine_edupay.sql`): `academy_schools`, `academy_fee_schedules`, `academy_edupay_accounts` (guardian↔student link), `academy_savings_pots` (+ `academy_pot_contributions`, append-only, `SavedMinor` projected), `academy_disbursements` (guarded SM `fee_due→funding→collected→disbursed→reconciled`), `academy_scholarships` (+ `academy_scholarship_awards`). DTOs: `PayFeesRequest`, `CreateFeeScheduleRequest`, `CreatePotRequest`, `FundPotRequest`, `AwardScholarshipRequest`. | **This already covers Invoice-adjacent fees, FeesVault (=SavingsPot), Scholarship (=ScholarshipPledge/Sponsor-a-Student), disbursement reconciliation.** The new Invoice entity + two-approval Promotion + Competition are the genuinely-new parts; layer them on top of these tables. | **Do not build a second fee-schedule/vault/scholarship system.** Extend EduPay. |
| **B2B2C institution licensing (adjacent, keep separate)** | `backend/internal/academy/schools/service.go` | Tables `academy_institutions`, `academy_licences`, `academy_class_groups`, `academy_enrollments`, `academy_institution_billing` (migration `20260815001300_academy_schools_tutor.sql`). Seat-capped idempotent `BulkEnroll`, guarded licence SM. | Reuse `academy_class_groups`/`academy_enrollments` for Class/Student roster if convenient, or add a fees-specific `Class`/`Student`. `BillingRail` here bills the *school*, not the guardian. | Don't confuse institution-billing with guardian invoices. |
| **Audit trail** | `academy/schools/service.go:repo.WriteAudit(...)` → `public.audit_logs`; `backend/internal/platform/audit/` | Every guarded academy transition writes to `public.audit_logs` with a `module` tag (e.g. `academy.schools`). | Fees module writes audit events (`module='academy.fees'`) for every money mutation and state transition (ComplianceExport SF-11 leans on this). | Do not build a parallel audit store. |
| **Feature flags + route registration** | `backend/internal/config/config.go:getEnvBool`; `backend/internal/app/academy_routes.go:RegisterAcademy`; template `backend/internal/app/connect_routes.go:registerConnectRoutes` | `getEnvBool(key string, fallback bool) bool`; flags already include `FeatureAcademyEduPayEnabled`, `FeatureAcademySchoolsEnabled` (loaded from `FEATURE_ACADEMY_EDUPAY_ENABLED` etc.). `RegisterAcademy` sub-gates each phase with a bool arg. | Add `FeatureAcademyFeesEnabled` (`FEATURE_ACADEMY_FEES_ENABLED`, default false) + a `feesEnabled bool` param to `RegisterAcademy`, and `if feesEnabled { fees.RegisterAcademyFees(memberAcad, adminAcad, pool, rbac, collectRail, ...) }`. | Don't add a new top-level `edtech_routes.go` — extend the academy registration. (See §5 for the exact pattern.) |
| **RBAC seeding** | migrations `supabase/migrations/20260527100000_enterprise_auth_rbac.sql` (tables), `20260627000000_connect_rbac.sql` (canonical seed template), `20260904000000_rbac_identity_bridge.sql` (auth.users→platform_users + default role grant) | Tables `public.roles(name,slug,...)`, `public.permissions(name,slug,module,resource,action,...)`, `public.role_permissions(role_id,permission_id)`, `public.user_roles(user_id→platform_users, role_id, scope_type CHECK includes 'school','cohort','season', scope_id)`. Slug convention: **`module.resource.action`** (e.g. `connect.audit.view`). | Seed the 7 new capabilities via one migration copying the connect_rbac pattern (see §3). `scope_type='school'` already exists for per-school scoping. | Do not invent a new RBAC schema. |

---

## 2. PRD-layout → real-layout mapping

Every `file_scope` in `docs/prd/school/TASKS.md` re-pointed to a real target. **The PRD `/services/edtech-fees/…` prefix maps to `backend/internal/academy/fees/…`** (new sub-package under the existing academy module). PRD `/apps/*` maps as below.

### Backend (Go) — module `spotlight/backend`

| PRD file_scope | Real target |
|---|---|
| `/services/edtech-fees/internal/statemachine/` (T0.3) | `backend/internal/academy/fees/statemachine/` (mirror the existing per-package `statemachine.go` style in `academy/edupay`, `academy/schools`, `academy/exam`) |
| `/services/edtech-fees/internal/*/migrations/` (T0.2) | `supabase/migrations/` (single migrations dir — see §3; there is NO per-package migrations folder) |
| `/services/edtech-fees/internal/school/` (T1.1) | `backend/internal/academy/fees/school/` — but reuse `academy/edupay` `School` + `academy/schools` `Institution`; add only verification-tier fields |
| `/services/edtech-fees/internal/session/`, `/internal/class/` (T1.2) | `backend/internal/academy/fees/session/`, `.../class/` (reuse `academy_class_groups` where possible) |
| `/services/edtech-fees/internal/fee-schedule/` (T1.3) | `backend/internal/academy/fees/feeschedule/` — extend `academy_fee_schedules`; add immutability guard (SF-1) |
| `/services/edtech-fees/internal/student/`, `/internal/guardian/` (T2.1) | `backend/internal/academy/fees/student/` — reuse `academy/identity` GuardianLink/Consent + `academy_edupay_accounts`; **do not create a new guardian identity** |
| `/services/edtech-fees/internal/student/import/` (T2.2) | `backend/internal/academy/fees/student/import/` |
| `/services/edtech-fees/internal/invoice/` (T2.3) | `backend/internal/academy/fees/invoice/` — **new entity**; balance derived from payment events (SF-2) |
| `/services/edtech-fees/internal/payment/` (+ `/reconcile/`) (T3.x) | `backend/internal/academy/fees/payment/` — thin adapter over `provider.PaymentProvider` + `edupay.CollectRail`; reconcile job under `.../payment/reconcile/` |
| `/services/edtech-fees/internal/fees-vault/` (+ `/apply/`) (T4.x) | `backend/internal/academy/fees/vault/` — **prefer extending `edupay.SavingsPot`**; segregate via new ledger `AccountType edtech_fees_vault` (SF-5) |
| `/services/edtech-fees/internal/invoice/hardship/` (T5.1) | `backend/internal/academy/fees/invoice/hardship/` — human review queue only (SF-9) |
| `/services/edtech-fees/internal/promotion/` (+ `/approval/`, `/rollover/`) (T6.x) | `backend/internal/academy/fees/promotion/` — **new**; two-approval guard in `statemachine` (SF-3) |
| `/services/edtech-fees/internal/competition/` (+ `/leaderboard/`, `/serializer/`) (T7.x) | `backend/internal/academy/fees/competition/` — extend `academy/gamification` leaderboard + drive `academy/assessment`+`exam` engine |
| `/services/edtech-fees/internal/export/` (T8.1) | `backend/internal/academy/fees/export/` — ComplianceExport (SF-11), append-only, writes `public.audit_logs` |
| `/services/edtech-fees/internal/school/trust-score/` (T9.1) | `backend/internal/academy/fees/school/trustscore/` |
| `/services/edtech-fees/internal/scholarship/` (T9.2) | `backend/internal/academy/fees/scholarship/` — **reuse `academy/edupay` Scholarship/ScholarshipAward** |
| `/services/edtech-fees/internal/school/roles/` (T11.1) | `backend/internal/academy/fees/roles/` — thin wrapper over existing RBAC `user_roles` with `scope_type='school'` |
| `/services/edtech-fees/internal/competition/broadcast-export/` (T12.3) | `backend/internal/academy/fees/competition/broadcast/` |
| Route registration for all of the above | Extend `backend/internal/app/academy_routes.go` (`RegisterAcademy`) behind `FEATURE_ACADEMY_FEES_ENABLED`; new file `backend/internal/app/academy_fees_routes.go` holding `fees.RegisterAcademyFees(...)` is acceptable if kept called from `RegisterAcademy` |

### Admin console — `frontend-admin/` (Next.js 15, App Router, `app/admin/**`)

There is **one** admin app (`frontend-admin/`); nav is a hardcoded `NavItem[]` in `src/components/layouts/AdminSidebar.tsx` (section `'Academy'` already exists). API base: `src/config/env.ts` → `NEXT_PUBLIC_ADMIN_API_BASE_URL` (default `http://localhost:8080/api/v1`); calls go to `${apiBaseUrl}/admin/<module>/...` via service files in `src/services/*.ts`. There is **no structural super-admin vs school-admin separation today** — both are the same app, gated only by RBAC permission on each `NavItem`.

| PRD file_scope | Real target |
|---|---|
| `/apps/admin-school/modules/fees/...` `[ADM-S]` (SC-29..SC-40: T1.4, T2.5, T3.4, T5.3, T6.4, T7.5, T8.2, T11.2) | `frontend-admin/app/admin/academy/fees/<sub>/page.tsx` (e.g. `setup-wizard/`, `onboarding/`, `collections/`, `hardship/`, `promotion/`, `competition/`, `gov-export/`, `roles/`). Add `NavItem`s in `src/components/layouts/AdminSidebar.tsx` under section `'Academy'` with `permissions: ['academy.fees.*']`. Service files: `frontend-admin/src/services/academyFeesService.ts`. Per-school scoping is runtime (RBAC `scope_type='school'`), not a separate app. |
| `/apps/admin-super/modules/edtech/...` `[ADM-SU]` (SU-01..SU-12: T10.x, T12.x) | Same app, new routes `frontend-admin/app/admin/academy/platform/<sub>/page.tsx` (directory, verification, collections, fraud, audit, config, schools-cup, support), gated `permissions: ['platform_edtech_admin']`. The **role separation** (school role → zero super-admin access, Checkpoint E) is enforced by the distinct `platform_edtech_admin` permission slug + `AuthSidebar` filter, NOT a separate deployment. |

*(Note: `frontend-web/app/admin/(dashboard)/...` is a legacy secondary admin surface for Open-Mic/STEM only — do not build EdTech there.)*

### Mobile — `mobile-app/reactnative/` (Expo Router, `app/<module>/`)

Existing educational area lives under **`app/learn/academy/`** with feature logic in **`src/features/academy/`**. Parent fees already partly exist at `app/learn/academy/parent/edupay/` (`index.tsx`, `pay/[feeId].tsx`, `pots.tsx`). API pattern: `src/features/academy/api.ts` + `constants.ts` with `ACADEMY_API_BASE = '/api/finance/academy'` and mock toggle `EXPO_PUBLIC_ACADEMY_USE_MOCK` (default `'true'`); hooks in `hooks.ts`; mock data in `api/academy.mock.ts`; `Challenge` type + `getChallenges()`/`useChallenges()` already stubbed (no screen yet). Money in kobo, offline queue in `offlineQueue.ts`.

| PRD file_scope | Real target |
|---|---|
| `/apps/mobile/parent/screens/fees/...` `[FE-M]` (PA-01..PA-16: T2.4, T3.3, T4.3, T5.2, T9.3) | `mobile-app/reactnative/app/learn/academy/parent/fees/...` (extend the existing `parent/edupay/` area) + logic in `mobile-app/reactnative/src/features/academy/` (extend `api.ts`/`hooks.ts`/`types.ts`), OR a new `src/features/edtech/` if separation is preferred. Register each screen in `app/learn/academy/_layout.tsx`. |
| `/apps/mobile/student/screens/competition/...` `[FE-M]` (SA-121..SA-126: T7.4) | `mobile-app/reactnative/app/learn/academy/competition/...` (new dir; wire the already-stubbed `useChallenges()`). |
| edtech feature api client | `mobile-app/reactnative/src/features/academy/` (extend existing) or new `src/features/edtech/api.ts` mirroring the `USE_MOCK`/`ACADEMY_API_BASE` pattern. |

---

## 3. Migrations — convention + copyable header

**Location:** `supabase/migrations/` (single flat dir; **no per-package migrations folder** exists — override the PRD's `/services/edtech-fees/internal/*/migrations/`).
**Filename:** `YYYYMMDDhhmmss_snake_case_name.sql` (14-digit timestamp). Real examples: `20260815001100_academy_spine_edupay.sql`, `20260703225152_rls_backend_only_lockdown.sql`, `20260627000000_connect_rbac.sql`.
**Rules (iron):** additive-only (no DROP/rename/type-narrow); wrap in `BEGIN;`/`COMMIT;`; guard everything with `to_regclass`; enable RLS with no policy (deny-all for anon/authenticated — backend reaches tables as owner and bypasses RLS); `REVOKE` guarded on role existence.

**Copyable header (matches the academy + lockdown migrations):**
```sql
-- <YYYYMMDDhhmmss>_academy_fees_<thing>.sql
-- EdTech School Fees — <thing>. Additive-only (no DROP / rename / type-narrow).
-- Reuses Paymax rails: finance/ledger (money), academy/edupay (fee schedules/pots),
-- academy/identity (guardian links), academy/gamification (leaderboards).
-- Every money mutation posts a balanced ledger entry + audit_logs row (module 'academy.fees').
BEGIN;

CREATE TABLE IF NOT EXISTS public.academy_fees_invoices (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- ... columns; money as bigint minor units; status via CHECK constraint ...
  created_at    timestamptz NOT NULL DEFAULT now()
);

-- Backend-only RLS lockdown (deny-all for anon/authenticated; owner/service_role bypass).
DO $rls$ BEGIN
  IF to_regclass('public.academy_fees_invoices') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.academy_fees_invoices ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN
      EXECUTE 'REVOKE ALL ON public.academy_fees_invoices FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.academy_fees_invoices FROM authenticated';
    END IF;
  END IF;
END $rls$;

COMMIT;
```

**RBAC seed migration (copy `20260627000000_connect_rbac.sql`):** seed roles + permissions + role_permissions for the 7 new capabilities. Slugs use `module.resource.action`.
```sql
-- <ts>_academy_fees_rbac.sql   (additive; idempotent via ON CONFLICT DO NOTHING)
BEGIN;
INSERT INTO public.roles (name, slug, description, role_type, is_system_role) VALUES
  ('School Owner',            'school-owner',           'Owns a school tenant',                 'admin', true),
  ('Bursar',                  'bursar',                 'Manages fees/collections for a school','admin', true),
  ('Class Teacher',           'class-teacher',          'Enters scores, proposes promotions',   'admin', true),
  ('Head Teacher',            'head-teacher',           'Second promotion approval',            'admin', true),
  ('Guardian',                'guardian',               'Parent/guardian capability',           'user',  true),
  ('Student',                 'student',                'Minor-safe learner capability',        'user',  true),
  ('Platform EdTech Admin',   'platform-edtech-admin',  'Paymax platform operator for EdTech',  'admin', true)
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission) VALUES
  ('Issue Invoice',     'academy.fees.invoice.issue',   'academy', 'invoice',    'issue',   'Issue a fee invoice',        true),
  ('Approve Promotion', 'academy.fees.promotion.approve','academy', 'promotion',  'approve', 'Approve a promotion step',   true),
  ('View Platform EdTech','platform_edtech_admin',      'academy', 'platform',   'view',    'Platform EdTech super-admin',true)
  -- ... one row per endpoint ...
ON CONFLICT (slug) DO NOTHING;

-- grant to super-admin (universal) then to the specific role (subset) — see connect_rbac.sql pattern
COMMIT;
```
Roles are granted to users via `public.user_roles` (`user_id`→`platform_users`, `role_id`, `scope_type` — use `'school'` + `scope_id=<school_id>` for per-school roles). Identity bridge (`20260904000000_rbac_identity_bridge.sql`) already backfills `platform_users` from `auth.users` and grants a default role.

---

## 4. Feature-flag + route-registration pattern (exact)

1. **Add flag** in `backend/internal/config/config.go`:
   - struct field: `FeatureAcademyFeesEnabled bool` (next to `FeatureAcademyEduPayEnabled`)
   - in `Load()`: `FeatureAcademyFeesEnabled: getEnvBool("FEATURE_ACADEMY_FEES_ENABLED", false),`
2. **Wire into `RegisterAcademy`** (`backend/internal/app/academy_routes.go`): add a `feesEnabled bool` param (caller passes `cfg.FeatureAcademyFeesEnabled`), then:
   ```go
   if feesEnabled {
       fees.RegisterAcademyFees(memberAcad, adminAcad, pool, rbac, collectRail, disburseRail, ledgerSvc)
   }
   ```
   `memberAcad` = `finance.Group("/academy")` (→ `/api/finance/academy/...`); `adminAcad` = `adminGroupTop5(r, "/api/academy/admin")`. Member group already has `RequireAuthContext`; admin endpoints add `middleware.RequirePermission(rbac, "academy.fees.*")` per route (same as `connect_routes.go`).
3. **Handler** (`backend/internal/academy/fees/handler.go`) exposes `RegisterAcademyFees(member, admin *gin.RouterGroup, pool *pgxpool.Pool, rbac services.RBACService, ...)` mirroring every other `academy/*` package's `RegisterAcademyXxx`.
4. **No flag, no merge** (CLAUDE.md). Default OFF.

---

## 5. Gaps / spec-vs-reality flags (the swarm MUST read)

1. **NO greenfield service. It's `academy`.** The PRD's `/services/edtech-fees/` and the notion of a fresh module are wrong. The fees domain is a **sub-package of the existing `backend/internal/academy/` monolith module**. Roughly 70% of the entities already exist:
   - **FeeSchedule** → `academy_fee_schedules` (edupay) already exists. Add SF-1 immutability guard.
   - **FeesVault** → `academy_savings_pots` + `academy_pot_contributions` (append-only, projected balance) already exists = SF-5's segregated purpose-tagged store, minus the dedicated ledger `AccountType` (add `edtech_fees_vault`).
   - **Guardian/Student** → `academy_edupay_accounts` + `academy_guardian_links` + `academy_consent_records` already exist. **Reuse; do not build a parallel identity/consent system.**
   - **Scholarship/Sponsor-a-Student** → `academy_scholarships` + `academy_scholarship_awards` already exist.
   - **Disbursement/reconciliation** → `academy_disbursements` guarded SM already exists.
   - **Genuinely new:** `Invoice` (with derived-balance SF-2), two-approval `Promotion` (SF-3), `Competition` state machine, `ComplianceExport` (SF-11), verification-tier on School.
2. **Two "schools" — don't merge them.** `academy/schools/` (institution *licensing/seats/billing*, `academy_institutions`) is a different concern from `academy/edupay/`'s `academy_schools` (guardian-fee schools). The PRD's `School` entity aligns with **edupay's** `academy_schools`, NOT the institution table. Pick one anchor (recommend edupay `academy_schools`, extend with `verification_tier`, `owner_identity_id`, `campuses`).
3. **Leaderboard: EXTEND, confirmed.** `academy_leaderboards.scope` CHECK is `('class','school','national','friends')`. PRD wants `class/school/city/state/national`. Need an **additive migration to relax the CHECK** to add `city`,`state` (drop-and-recreate a CHECK constraint is allowed as it doesn't narrow/lose data). Do NOT create a new `LeaderboardEntry` table (the PRD even says "extends… does not replace"). The gamification package is **money-free by design** — competition rewards must go through the sibling `rewards.IssueReward`, never the leaderboard.
4. **Ledger has no free-form `purpose` column.** SF-5 "purpose-tagged sub-account" is implemented by a dedicated `ledger.AccountType` (verified enum in `finance/ledger/model.go`), not a tag column. Add `AccountEdtechFeesVault`. The `reference` string is the only free-form field.
5. **Model A only (regulatory).** BNPL rails (`commerce.BNPLRail`/`edupay.BNPLRail`) already exist and are wired — but the PRD §4 bars Paymax from *fronting* fees (receivables factoring). Installments must be guardian-pays-school-over-time only. **Flag:** do not repurpose the BNPL rail to advance fees to a school; SU-12 compliance dashboard must watch for this drift.
6. **Router is Gin, not Chi; layout is a monolith, not `apps/`/`packages/`.** (Matches CLAUDE.md, contradicts playbook v2 / PRD assumptions.) There is no Turborepo. `backend/tests/` has no framework configured — money-path tests follow the in-package `_test.go` convention already used across `academy/*` and `finance/ledger` (`service_test.go`, `toctou_test.go`, `reversal_test.go`).
7. **Admin: one app, RBAC-separated (not two apps).** `[ADM-S]` and `[ADM-SU]` both live in `frontend-admin/`; the school-vs-platform boundary (Checkpoint E) is the `platform_edtech_admin` permission slug + per-school `scope_type='school'`, not separate deployments. There is no existing per-tenant school-admin console to extend — it must be built as RBAC-scoped routes.
8. **Mobile: parent fees already partly built.** `app/learn/academy/parent/edupay/` exists (pay screen, pots, hub). Extend it; the student competition screen does **not** exist yet though `useChallenges()`/`Challenge`/`MOCK_CHALLENGES` are stubbed. Use `EXPO_PUBLIC_ACADEMY_USE_MOCK` and `ACADEMY_API_BASE='/api/finance/academy'`.
9. **SF-4 (academic access never gated by payment) is architecturally clean today:** gamification (leaderboard/quiz) and edupay (money) are separate packages that share no service — keep it that way; never import a fees/payment check into an academic-content authorization path.
