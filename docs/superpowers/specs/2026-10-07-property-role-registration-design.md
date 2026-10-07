# Property marketplace role registration — design

**Date:** 2026-10-07
**Status:** Draft, awaiting review
**Slice:** 1 of 3 (role registration). Slice 2 (Estate Manager enrollment + targeted invites) and slice 3 (membership-driven access to the estate and visitor modules) get their own specs.

## Goal

Let a signed-in user register on the property marketplace as an **Estate Manager**, **Property Developer** or **Property Agent/Marketer**, hold any combination of those roles, and get each one verified. Registration is self-serve; verification is a separate step that unlocks the actions that affect other people or money.

## Decisions made with the product owner

| Question | Decision |
|---|---|
| First slice | All three role registrations before estate enrollment/invites |
| Approval model | Self-serve; verified later |
| What verification gates | Draft freely. Publishing, enrolling an estate, inviting residents and collecting dues require verification |
| Multiple roles per user | Yes, any combination |

## Current state (relevant findings)

- The realtor backend (`backend/internal/realtor/`) is admin-only. No agent, developer or manager registration or profile table exists.
- The mobile role picker `app/property/roles.tsx` offers tenant, landlord and host. Its `onContinue` handler navigates and persists nothing.
- Any authenticated user can create an estate today (`CreateEstate`, `estate/service.go`) with no role or KYC gate. This spec does not change that. Slice 2 puts the gate in place using `IsVerified`.
- A role-context aggregator exists behind `FEATURE_PROPERTY_SUITE_ENABLED` (`property/context.go`). It merges estate, property, agency and organisation roles into one context list. `GET /api/v1/me/capabilities` is merchant-centric and not property-aware.
- Platform RBAC slugs for property exist (`property.manage`, `estate.admin`, `estate.manage`, `agency.manage`), granted to super-admin only.

## Approach

One generic role-profile table keyed by `(user_id, role)`, with role-specific details validated in Go. Three typed per-role tables were rejected as roughly three times the code for a shared lifecycle. Reusing the `onboarding` merchant application pipeline was rejected because it is approval-first and the chosen model is self-serve.

## Data model (additive migration)

The version must not collide with any existing migration. It is chosen at implementation time and re-checked against `main`, `staging` and the live `schema_migrations` table immediately before merge.

`property_role_profiles`
- `id uuid pk`
- `user_id uuid not null` (cross-module reference, no FK, same convention as `restaurant_likes`)
- `role text not null`, CHECK in (`estate_manager`, `developer`, `agent`)
- `status text not null default 'draft'`, CHECK in (`draft`, `active`, `suspended`)
- `verification_status text not null default 'unverified'`, CHECK in (`unverified`, `pending`, `verified`, `rejected`)
- `display_name text not null`
- `details jsonb not null default '{}'`
- `rejection_reason text`
- `verified_at timestamptz`, `verified_by uuid`
- `created_at`, `updated_at`
- UNIQUE `(user_id, role)`

`property_role_documents`
- `id uuid pk`, `profile_id uuid not null references property_role_profiles(id) on delete cascade`
- `kind text not null` (e.g. `agent_licence`, `cac_certificate`, `authority_letter`, `id_document`)
- `storage_key text not null` (object key, uploaded through the existing presigned-URL flow)
- `created_at`

`property_role_events` (audit trail; the existing audit writers are module-specific, so this feature owns its own)
- `id uuid pk`, `profile_id uuid not null references property_role_profiles(id) on delete cascade`
- `actor_id uuid not null`, `action text not null` (`registered`, `updated`, `submitted`, `approved`, `rejected`, `suspended`, `reset_to_unverified`)
- `from_verification text`, `to_verification text`, `reason text`, `created_at`

RLS is enabled with no policy and `anon`/`authenticated` grants are revoked on all three tables in the same migration. Access is only through the Go backend pool.

### Role details (validated in Go, stored in `details`)

| Role | Required to submit for verification | Optional |
|---|---|---|
| `agent` | licence/FRCN number, operating state(s) | agency name, bio, specialisations |
| `developer` | company name, CAC registration number | website, past project summary |
| `estate_manager` | organisation or management-company name | number of estates managed, authority-letter document |

Drafting needs only `display_name`. `details` accepts only the keys listed above for the role (unknown keys are rejected) and is capped at 8 KB.

## Lifecycle

1. **Register:** `POST` creates a profile in `draft` / `unverified`. Idempotent per `(user, role)`; a second register call returns the existing row.
2. **Edit:** the owner can update `display_name` and `details` while the profile is not `suspended`. Changing an identity-bearing field (agent licence number, developer CAC number, estate-manager organisation) on a `verified` or `pending` profile resets it to `unverified` and logs `reset_to_unverified`, so a verified badge cannot be kept after swapping the number it was verified against. Changing `display_name` or optional fields does not reset.
3. **Submit for verification:** requires the role's required fields and at least one document. Moves `unverified` or `rejected` to `pending`. Rejected users can resubmit.
4. **Review (admin):** an admin approves (`verified`, `status` becomes `active`, `verified_at/by` set) or rejects with a reason (`rejected`). Every transition writes an audit event.
5. **Suspend (admin):** sets `status = suspended`. A suspended profile fails `IsVerified`.

## Backend

New Go package `backend/internal/property/roles`, wired in the same place as the property suite, behind a new flag `FEATURE_PROPERTY_ROLES_ENABLED` (default off).

Member endpoints, mounted under the existing finance group next to the property suite (`/api/finance/property/...`), authenticated; the caller's id comes only from the auth context, so a caller can only touch their own rows:
- `GET /api/finance/property/roles` — my role profiles
- `POST /api/finance/property/roles/:role` — register
- `PATCH /api/finance/property/roles/:role` — update profile
- `POST /api/finance/property/roles/:role/documents/presign` — presigned PUT for a verification document; the server chooses the object key `property-roles/{userID}/{role}/{random}`
- `POST /api/finance/property/roles/:role/documents` — record an uploaded document; the `storage_key` must start with the caller's own `property-roles/{userID}/{role}/` prefix
- `POST /api/finance/property/roles/:role/submit` — submit for verification

Admin endpoints (new RBAC permission `property.roles.review`):
- `GET /api/property/admin/roles?status=pending`
- `POST /api/property/admin/roles/:id/approve`
- `POST /api/property/admin/roles/:id/reject` (reason required)
- `POST /api/property/admin/roles/:id/suspend`

Exported check for later slices: `IsVerified(ctx, userID, role) (bool, error)`. It is true only when `verification_status = 'verified'` and `status = 'active'`, and it fails closed on any error.

The role-context aggregator in `property/context.go` includes active role profiles as entities of a new context type `role` (id = profile id, name = `display_name`, roles = the role slug), They are listed read-only: `role` is deliberately NOT added to `validContextTypes`, because `property_active_context.context_type` has a CHECK limited to estate/property/agency/org and widening it needs a DROP, which the additive-only rule forbids. Switching into a role profile is therefore not supported in this slice (`SwitchContext` refuses type `role`); a later slice can add it with its own migration. This only happens when `FEATURE_PROPERTY_ROLES_ENABLED` is on, so the suite keeps working before the migration is applied. The context list shows them with no second role system; the mobile switcher must render `role` entities as non-selectable. `GET /api/v1/me/capabilities` is not changed in this slice.

No money moves in this slice. The Idempotency-Key rule applies only to money mutations and does not apply here.

## Mobile

- `app/property/roles.tsx` gains Estate Manager, Developer and Agent/Marketer options. Selecting one calls register, so the choice is saved.
- A per-role profile form, a document upload step and a "submit for verification" step, with a status banner (unverified, pending, verified, rejected with reason).
- Mock mode follows the repo policy: live by default, never mock on staging or production.

## Admin console

A review queue in `frontend-admin` showing pending profiles with their details and documents, and approve, reject and suspend actions. The page is hidden for users without `property.roles.review`.

## Out of scope for this slice

- Estate enrollment, targeted invites and any change to who may create an estate (slice 2)
- Estate and visitor module access driven by membership (slice 3)
- Estate subscription or billing model
- Developer projects, off-plan sales and fractional offerings
- Linking an agent profile to `realtor_portfolios` or publishing listings; the gate (`IsVerified`) ships here, the callers do not

## Testing

- Live-DB tests (gated on `TEST_DATABASE_URL`): register idempotency; unique per user and role; submit blocked until required fields and a document exist; approve and reject transitions; suspend makes `IsVerified` false; a user cannot read or modify another user's profile.
- Unit tests for per-role `details` validation.
- Admin permission test: a caller without `property.roles.review` gets 403 on every admin route.
- Mobile type-check and the golden-path regression suite stay green.

## Rollout

1. Apply the migration to staging first, then deploy the backend, then set `FEATURE_PROPERTY_ROLES_ENABLED` in `staging-module-flags.yml`. Queries must never reference these tables before the migration is applied.
2. Add `property.roles.review` to the admin RBAC seed.
3. Write the ADR as `ADR-PR<pr-number>-property-role-registration.md` once the PR number exists.
4. Add the new paths to `contracts/property.openapi.yaml` in the spec-first PR.

## Open questions

None blocking. Document retention and who may view role documents are covered by the admin permission above; any finer-grained policy can be decided when the first real documents arrive.
