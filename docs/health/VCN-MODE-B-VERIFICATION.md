# VCN Mode B (document + assisted) verification — vet module

A vet is verified **without ever seeing the VCN portal**: they submit details +
documents inside Paymax, an ops reviewer confirms out-of-band and records a
decision, and the vet capability is granted **only on approval**. This is the
first concrete `CredentialVerifier` implementation; a future Mode A (official
VCN API) or PCN/MLSCN adapter slots in with **no change to the vet flow**.

## Reused (by import — never copied)

- **`health/providers` ProviderApplication state machine** — DRAFT→SUBMITTED→
  UNDER_REVIEW↔NEEDS_INFO→APPROVED↔SUSPENDED|REJECTED already existed with guarded
  `transition`/`transitionAdmin`, `Decision`, and the **idempotent capability
  grant** on approve + audit. No new states needed.
- **`health/providers` credential vault** (`health_credential_docs` + `AddCredential`)
  — evidence docs (`VCN_CERT`, `ANNUAL_LICENCE`, `GOV_ID`) attach here; storage key
  only, never a blob (HL-8).
- **`health/providers.SuspendExpired`** — the HL-2 auto-suspend sweep keyed on
  credential `expires_at`; we mirror the approved licence expiry onto the
  `ANNUAL_LICENCE` doc so this existing sweep auto-suspends on expiry.
- **`internal/scheduler`** — schedules the per-licence expiry sweep job (HL-2).
- **`finance/kyc` + `user_profiles`** — identity snapshot (name / tier) for the
  name/DOB cross-check.
- **`middleware.RequirePermission`, RBAC, `is_admin()`** — admin gating.
- **RN vet feature lib** (`src/features/health/vet/*`, mock-first `api`/`hooks`,
  onboarding screen, design tokens) and **admin `_ui.tsx` + `VetTabs` +
  `healthVetAdminService` request/auth pattern**.

## Created (new)

- **`backend/internal/health/credential/`** — source-agnostic `CredentialVerifier`
  interface + `VCNAdapter` (`method=ASSISTED`); `VerificationRecord` model with a
  guarded status SM (`PENDING→VERIFIED|NEEDS_INFO|REJECTED`, `NEEDS_INFO→PENDING`);
  repository (atomic guarded `DecideRecord`, access-logged doc reads); service
  (submit→UNDER_REVIEW + PENDING + KYC cross-check flags; decide→VERIFIED +
  licence expiry + idempotent capability grant; expiry auto-suspend); member +
  admin handlers.
- **Migration** `20260815000500_health_vcn_verification.sql` — `health_verification_records`
  + `health_credential_doc_access_log` (additive, RLS, `health.vet.review` RBAC seed).
- **Wiring** `app/health_credential_routes.go` (`RegisterHealthVCNVerification`),
  registered in the health block under `FeatureHealthVetEnabled`.
- **Tests** `credential/service_test.go` — record SM (allow+reject), identity
  cross-check, submit (consent/owner/flags/audit), decide (no-self-approve,
  expiry-required, idempotency, illegal transition, capability grant), HL-2
  auto-suspend, NDPA doc access-log + signed-URL gating.
- **Mobile** — `app/health/vet/provider/verification.tsx` (submit: reg no + name +
  DOB + 3 docs + NDPA consent) and `verification-status.tsx` (coarse stage only).
- **Admin** — `app/admin/health/vet/verification/page.tsx` (PENDING queue, identity
  flags, access-logged signed-URL doc views, approve/need-info/reject with required
  licence expiry) + service/types + `VetTabs`/sidebar entries.

## Invariants enforced

- **HL-2** — vet not discoverable/active until VERIFIED; licence-expiry auto-suspend
  via the scheduler + `SuspendExpired`.
- **HL-12 / NDPA** — immutable audit on submit, document access, decision, capability
  grant, suspension; explicit consent captured; documents delivered as access-logged
  signed URLs; only **result + reference** stored, never a register copy.
- **Object-level authZ** — a vet reads only their own application/status; only
  `health.vet.review` can review/decide; a vet can **never self-approve** (service
  rejects `reviewer == owner`); capability grant is idempotent; double-submit safe.
- **Guarded transitions only** — record SM transitions go through an atomic
  `WHERE status=$from` update; application SM through the providers package.

## Vet-facing status — never leaks register data

The status screen + API return only one of: `pending_review` / `more_info_needed` /
`verified` / `not_verified`. Reg number, matched-field detail, reviewer identity,
and notes are never exposed to the vet.

## Assumptions

- **Mode B only.** Mode A (official VCN API) and Mode C (scraping), and PCN/MLSCN/
  NAFDAC verifiers, are out of scope — the interface accommodates them later.
- **DOB cross-check is `unverifiable`** today: `user_profiles` stores no DOB and KYC
  exposes only NIN/BVN hashes, so name + KYC-tier are matched and DOB is surfaced as
  unverifiable for the reviewer (not a hard block).
- **System auto-advance** SUBMITTED→UNDER_REVIEW is recorded with a `system` actor.
- **R2 signer** is injected by the orchestrator (nil today → empty URL, but the doc
  read is still access-logged).
- **Go toolchain unavailable in this sandbox** — backend verified by structural
  review (balanced braces, import/signature resolution against the real packages);
  `go vet/build/test` and the frontend `tsc` runs are deferred to CI.
