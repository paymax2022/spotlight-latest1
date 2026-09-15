# ADR-056 — `RequireStemRoles` resolves real RBAC roles instead of trusting `x-stem-role`

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

AUTH-020 (`c401662d`) closed the live exposure in `RequireStemRoles`
(`backend/internal/middleware/stem_authz.go`): it made the middleware fail
closed unless a real, verified admin identity (`RequireAdminConsoleRole`) had
already run, so an unauthenticated caller could no longer reach it at all. It
deliberately left the header itself unverified — `x-stem-role` still decided
*which* STEM sub-role (`JUDGE`, `CONTEST_MANAGER`, …) the already-trusted
caller was treated as, with no RBAC backing — and none of the STEM role names
router.go allow-lists (`OPERATIONS_MANAGER`, `SCHOOL_ADMIN`, `TEACHER_COACH`,
`MENTOR`, `SPONSOR`) had a `public.roles` row to resolve to even if we wanted
to check. That follow-up is this ADR.

## Decision

1. **`RequireStemRoles` now takes `services.RBACService`** and resolves the
   caller's real roles via `rbac.GetUserRoles(adminUserID)` — the same shape
   `RequireAdminConsoleRole` already uses, keyed off the `adminUserID` that
   middleware set on the Gin context. The `x-stem-role` header is no longer
   read for authorization at all.
2. **Role-slug → STEM-name mapping is a mechanical conversion**
   (`normalizeStemRoleSlug`): kebab-case slug → `UPPER_SNAKE_CASE`
   (`contest-manager` → `CONTEST_MANAGER`, `judge` → `JUDGE`, etc.), with one
   explicit alias: `system-admin` → also `ADMIN`, because `system-admin` is
   this repo's existing "general platform admin" role
   (`admin_console_rbac.go`'s `consoleAdminRoleSlugs`) and `ADMIN` is the name
   router.go's STEM allow-lists use for that same concept. No other aliases
   exist — adding one silently for every future STEM role name would make the
   allow-list unauditable by inspection.
3. **New migration `20270205000000_stem_admin_rbac_roles.sql`** adds the five
   `public.roles` rows that didn't exist: `operations-manager`, `school-admin`,
   `teacher-coach`, `mentor`, `sponsor`. `contest-manager`, `judge`,
   `super-admin` and `system-admin` already existed
   (`20260527100000_enterprise_auth_rbac.sql`) and are reused as-is.
4. **Deliberately did NOT reuse `school-representative` / `sponsor-representative`**
   (pre-existing roles with matching real-world names). Those are a school's or
   sponsor's own external account role — granting STEM admin-console access to
   whoever holds them would be a privilege escalation for an unrelated account
   type, not a narrowing. New, distinct slugs were seeded instead.
5. **Deliberately did NOT seed `public.permissions` rows or role assignments
   for real STEM staff.** `RequireStemRoles` is a role-slug check, not a
   permission check — there is no `stem.*` permission slug anywhere for a
   migration to seed. And this migration ships to every environment alike;
   it cannot know which real user IDs are STEM staff in each. Assigning roles
   to actual accounts is the existing operational flow (`POST
   /api/admin/users/:id/roles`, `AssignRoleToUser`, gated behind
   `users.roles.assign`) once those accounts are known — same precedent as
   `20260919000200_restaurant_admin_rbac.sql`'s `restaurant-ops` role.
6. **Did NOT touch `adminGroup`'s gating.** `router.go` nests `stemRead`/
   `stemManage` under `adminGroup`, which requires `RequireAdminConsoleRole`
   — itself gated to only `super-admin`/`system-admin`
   (`consoleAdminRoleSlugs`) — *before* `RequireStemRoles` ever runs. That
   means today, a user holding only e.g. `judge` (and neither `super-admin`
   nor `system-admin`) cannot reach the STEM admin endpoints at all, no matter
   what `RequireStemRoles` decides — the fine-grained STEM role names below
   `ADMIN`/`SUPER_ADMIN` are real now, but currently unreachable in practice.
   Broadening `consoleAdminRoleSlugs`, or moving the STEM routes out from
   under the strict admin-console gate, is a separate authorization-surface
   decision with its own blast radius (it would let non-admin-console STEM
   staff reach `/api/v1/admin/*` routing at all) and is out of scope here.
7. **Frontend (`frontend-admin/src/config/stemAccess.ts`,
   `.../services/stemService.ts`) left unchanged in behavior**, beyond a doc
   comment. They still derive the "current" STEM role from a build-time env
   var rather than a real per-user lookup — this is a UI nav/button-visibility
   concern only (the backend enforces the real check regardless), and wiring a
   live fetch touches render-path assumptions in `AdminDashboard.tsx` /
   `AdminSidebar.tsx` that deserve their own change, not a footnote here.

## Consequences

- `SUPER_ADMIN` and `ADMIN` (`system-admin`) are the only STEM roles reachable
  in practice until the `adminGroup`/`consoleAdminRoleSlugs` question (point 6)
  is separately decided — this is a real, known gap, not a regression: it was
  already true before this change (see AUTH-020's own commit message) and is
  now explicit rather than implicit.
- A request carrying a spoofed `x-stem-role` header no longer has any effect;
  only the caller's real RBAC roles decide.
- Granting a real person `JUDGE`/`CONTEST_MANAGER`/etc. access still requires
  them to also hold `super-admin` or `system-admin` today, per point 6.
