# ADR-PR — Property role registration: one generic profile table, self-serve then verified later

**Date:** 2026-10-07
**Status:** Accepted
**Scope:** `backend/internal/property/roles/`, `supabase/migrations/20271009000000_*.sql`,
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
3. **Identity-field edits reset verification.** Changing agent `licenceNumber`, developer
   `cacNumber` or `companyName`, or estate manager `organisationName` on a verified or pending
   profile resets verification and sets status `draft`. No other field does (`displayName` is not
   identity-bearing). A pending or verified profile cannot blank a required key (422); draft,
   unverified and rejected profiles can.
4. **Own `property_role_events` audit table.** Existing audit writers are module-specific.
5. **Documents:** keys are prefix-bound to the caller and presign keys are chosen by the server.
   `authorityLetterKey` was dropped; an authority letter is just a document.
6. **No self-review:** an admin cannot approve or reject their own profile (`ErrSelfReview`).
   **No stale review:** approve and reject carry the `updatedAt` the reviewer loaded and are refused
   with 409 if the profile changed since (any edit or document upload bumps `updatedAt`). The queue
   excludes suspended profiles.
   **Viewing documents:** reviewers get a 300 s presigned GET URL per document
   (`GET /api/property/admin/roles/:id/documents/:docId/url`), scoped to that profile.
7. **Role contexts are listed read-only.** `property_active_context.context_type` has a CHECK
   (`estate|property|agency|org`) that can only be widened by a DROP, which the additive-only
   migration rule forbids. Role profiles therefore appear in the context list but cannot be
   activated as a context.
8. Behind `FEATURE_PROPERTY_ROLES_ENABLED`; staging flag wiring added to `staging-module-flags.yml`.
   The rollout order is enforced in code: at boot the backend probes
   `to_regclass('public.property_role_profiles')` and, if the table is missing or the probe fails,
   logs loudly and registers no role routes and no role context entities even with the flag on.

## Consequences

- Adding a role is a data/validation change, not a migration.
- `IsVerified` has no callers yet; nothing is gated until a later slice wires it.
- Out of scope: estate enrollment, targeted invites, membership-driven module access, estate
  subscription billing, developer projects and unsuspend.
- Rollout order: apply migration, deploy backend, then set the flag (a flag set early is inert
  until the table exists, but the backend only re-probes on restart). Before merge, re-check the
  migration version against live `schema_migrations` and `scripts/ci/check-migration-versions.sh`.
