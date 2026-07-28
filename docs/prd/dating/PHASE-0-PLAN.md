# Paymax Connect — Phase 0 Plan (awaiting approval)

**Goal:** scaffold the Connect module + the safety/config backbone everything else depends on.
**No feature screens, no matching logic.** Build to the brownfield stack (`architecture.md`).
Acceptance: `acceptance.md` → Phase 0.

> Per `BUILD-PLAN.md` working rhythm: this is the plan. **I will not write code until you approve
> (or adjust) it.** After approval, Phase 0 is built as small, independently verifiable slices.

## Slices

### P0-A — DB foundation (1 migration)
New additive migration `supabase/migrations/2026XXXXXXXXXX_connect_foundation.sql`:
- `connect_config`, `connect_audit_log` (immutable), `connect_cases`, `connect_underage_flags`.
- RLS on all (auth.uid() / is_admin() / service_role), `handle_updated_at()` triggers, indexes.
- Seed baseline `connect_config` rows (feature flags, discovery limits, matching weights,
  verification requirements, `verification.retention_days`).
- **Additive-only; no changes to existing tables.** Verify: `supabase db reset` replays clean.

### P0-B — Backend module skeleton + config service
- New packages under `backend/internal/connect/{config,safety,verification,admin}` with health +
  module boundaries only (no business logic).
- `connect_routes.go` registering `/api/v1/connect/{health,config}` + `age-gate` + admin audit/cases,
  gated on `FeatureConnectEnabled`, all behind `RequireAuthContext`.
- `config` service reads `connect_config` and returns backend-owned config to mobile.
- Verify: `go build ./...`, `go vet ./...`, route returns seeded config.

### P0-C — Audit + case scaffold
- `audit` helper in `connect` wrapping `audit_service.LogAction` + writing `connect_audit_log`.
- `cases` service: `OpenCase()` (transactional) + admin list/update; wired so any future report
  path can open a case. Verify: unit test opens a case + writes an audit row.

### P0-D — 18+ age-gate + underage pathway
- `POST /api/v1/connect/onboarding/age-gate`: DOB capture, fail-closed age computation, suspected
  minors → `connect_underage_flags` + audit. Verify: unit tests for boundary DOBs (17/18) and
  that a flagged record appears in the admin queue.

### P0-E — Verification encryption + retention hooks
- Encryption hook interface + no-op/dev impl for `connect_verification.evidence_ref`; logger
  redaction so PII is never logged; retention config key wired (job stubbed). Verify: test asserts
  no plaintext PII persists and redaction holds.

### P0-F — Admin + mobile shells
- Admin: `frontend-admin/app/admin/connect/{page,cases,audit}/page.tsx` + `connectAdminService.ts`
  (mock-first), mirroring Realtor. Read-only views of audit log + case queue.
- Mobile: `app/connect/_layout.tsx` + `index.tsx` shell and `src/features/connect/{api,types,
  constants,hooks}` reading `/connect/config`. No feature screens. Verify: typecheck/lint pass.

### P0-G — CI gate
- Ensure lint + `go build`/`go vet` + migration replay run in CI for changed paths; block on red.

## Files touched (net-new unless noted)
- `supabase/migrations/2026XXXX_connect_foundation.sql`
- `backend/internal/connect/**` (new), `backend/internal/app/connect_routes.go` (new),
  `backend/internal/app/router.go` (1 registration line — additive)
- `frontend-admin/app/admin/connect/**` (new), `frontend-admin/src/services/connectAdminService.ts` (new)
- `mobile-app/reactnative/app/connect/**` (new), `mobile-app/reactnative/src/features/connect/**` (new)
- `docs/adr/` — 1 ADR recording the brownfield reconciliation decision

## Guardrails honored
- No existing Spotlight/finance files modified except 1 additive route registration line.
- Additive-only migration. Feature-flagged. Backend owns config. Audit on state changes.
- Tests cover age-gate boundaries, case creation, PII redaction.

## Open questions for you
1. **RBAC perms:** OK to introduce `connect.audit.read`, `connect.cases.manage`,
   `connect.moderation.review`, `connect.verification.review` now (seeded to admin role)?
2. **Encryption backend:** is there an existing KMS/secret the verification hook should target, or
   use an app-level key from env for Phase 0 and revisit before Phase 1 stores real selfies?
3. **Migration timestamp:** any release-train convention for the next migration number, or take the
   current UTC timestamp?
4. **Slice cadence:** build P0-A→G in one go for review, or PR slice-by-slice?
