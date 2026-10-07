# ADR-PR — Property role registration: one generic profile table, self-serve then verified later

**Date:** 2026-10-07
**Status:** Accepted
**Scope:** `backend/internal/property/roles/`, `supabase/migrations/20270312000000_*.sql`,
`backend/tests/propertyroles/`, `contracts/property.openapi.yaml`,
`mobile-app/reactnative/src/features/property/roles/`, admin verification queue in `frontend-admin/`,
`.github/workflows/staging-module-flags.yml`.
**Spec:** `docs/superpowers/specs/2026-10-07-property-role-registration-design.md`
**Plan:** `docs/superpowers/plans/2026-10-07-property-role-registration.md`

## Context

Property users need to register in a professional role (agent, landlord, developer, and similar)
and later be verified by an admin. Verification gates later features (estate enrollment, invites,
module access). The repo already has a merchant onboarding pipeline and per-module audit writers,
none shaped for this.

## Decision

1. **One generic `property_role_profiles` table keyed `(user_id, role)`**, not per-role tables and
   not the onboarding merchant pipeline. Roles share the same lifecycle; role-specific fields live
   in a `details` map. `Update` merges details; a `null` value deletes a key.
2. **Self-serve first, verified later.** A user registers and submits; an admin approves or rejects.
   The gate is exported as `IsVerified` and ships WITHOUT callers; later slices call it.
3. **Identity-field edits reset verification.** Changing `licenceNumber`, `cacNumber` or
   `organisationName` on a verified or pending profile resets verification and sets status `draft`.
   No other field does.
4. **Own `property_role_events` audit table.** Existing audit writers are module-specific.
5. **Documents:** keys are prefix-bound to the caller and presign keys are chosen by the server.
   `authorityLetterKey` was dropped; an authority letter is just a document.
6. **No self-review:** an admin cannot approve or reject their own profile (`ErrSelfReview`).
7. **Role contexts are listed read-only.** `property_active_context.context_type` has a CHECK
   (`estate|property|agency|org`) that can only be widened by a DROP, which the additive-only
   migration rule forbids. Role profiles therefore appear in the context list but cannot be
   activated as a context.
8. Behind `FEATURE_PROPERTY_ROLES_ENABLED`; staging flag wiring added to `staging-module-flags.yml`.

## Consequences

- Adding a role is a data/validation change, not a migration.
- `IsVerified` has no callers yet; nothing is gated until a later slice wires it.
- Out of scope: estate enrollment, targeted invites, membership-driven module access, estate
  subscription billing, developer projects, unsuspend, and a view-document feature.
- Rollout order: apply migration, deploy backend, then set the flag. Before merge, re-check the
  migration version against live `schema_migrations` and `scripts/ci/check-migration-versions.sh`.
