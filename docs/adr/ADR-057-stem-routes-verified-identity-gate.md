# ADR-057 — STEM routes gate on a real verified identity, not `RequireAdminConsoleRole`

- **Status:** Accepted
- **Date:** 2026-09-15

## Context

ADR-056 made `RequireStemRoles` resolve the caller's real RBAC roles instead
of trusting the `x-stem-role` header, and seeded the five `public.roles` rows
(`operations-manager`, `school-admin`, `teacher-coach`, `mentor`, `sponsor`)
that were missing. It also flagged, but deliberately did not fix, a real gap
(point 6): `router.go`'s `stemRead`/`stemManage` were sub-groups of
`adminGroup`, which requires `RequireAdminConsoleRole` — gated to only
`super-admin`/`system-admin` (`consoleAdminRoleSlugs`) — *before*
`RequireStemRoles` ever ran. A real person holding only `judge` (or
`contest-manager`, `operations-manager`, etc.) and neither platform-admin role
could not reach a single STEM route, no matter how correctly
`RequireStemRoles` resolved their role. This ADR closes that gap.

## Decision

1. **Split `RequireAdminConsoleRole`'s identity check out of its role
   check.** `resolveVerifiedIdentity` (`admin_console_rbac.go`) now does the
   bearer-token verification + account-status check alone (sets
   `"adminUserID"` on the context); `RequireAdminConsoleRole` calls it and
   then additionally requires a `consoleAdminRoleSlugs` role, unchanged
   behavior for its existing routes (menu-counts, leads, chatbot transcripts,
   handoffs, analytics, competitions, reality-tv — all real PII/ops data with
   no STEM connection).
2. **New `RequireVerifiedIdentity` middleware** wraps `resolveVerifiedIdentity`
   with no role check at all — any real, non-suspended/locked/deleted
   authenticated user passes. This is deliberately weaker than
   `RequireAdminConsoleRole`: it proves *who* the caller is, not that they're
   any kind of platform admin.
3. **`router.go`: `stemRead`/`stemManage` moved to a sibling `stemGroup`, not
   a child of `adminGroup`.** Both still require `RequireAdmin` (the shared
   `x-admin-api-key`, unchanged), but `stemGroup` uses
   `RequireVerifiedIdentity` instead of `RequireAdminConsoleRole`. The actual
   role decision is now made entirely by `RequireStemRoles`'s own per-route
   allow-list, which already lists every real STEM role — it no longer sits
   downstream of a narrower gate that silently pre-filtered who could ever
   reach it.
4. **`stemGroup` is registered at the same `"/admin"` URL prefix as
   `adminGroup`**, as an independent `v1.Group("/admin")` call — Gin groups
   are just prefix + middleware-chain bundles, not exclusive namespaces, and
   none of `stemGroup`'s routes (`/stem/*`, `/schools*`, `/stem-*`) collide
   with `adminGroup`'s own directly-registered paths (`/menu-counts`,
   `/leads`, `/chatbot/*`, `/handoffs`, `/analytics/*`, `/competitions/*`,
   `/reality-tv/*`). Verified by booting the server locally — no Gin
   route-registration panic — and by the full route table in `router.go`.
5. **Did NOT broaden `consoleAdminRoleSlugs`** to include the STEM roles.
   That would have been the one-line fix, but it would also grant every STEM
   role (including narrow ones like `sponsor` or `mentor`) access to
   `adminGroup`'s unrelated PII routes (leads, chatbot transcripts,
   handoffs) — a real privilege escalation for those roles, not a narrowing.
   Splitting the identity check out keeps `consoleAdminRoleSlugs` exactly as
   narrow as it was.
6. **Did NOT change what any given STEM role can do** — `RequireStemRoles`'s
   allow-lists per route are unchanged. `judge` still can't reach
   `stemManage`; only the ability to reach `stemRead` (and any STEM role's
   own permitted routes) at all changed. See the new
   `TestRequireAdmin_AndStemRole_JudgeOnly*` tests in
   `admin_stem_auth_test.go`, which pin both halves of this.

## Consequences

- A real STEM staff member (school admin, teacher/coach, judge, mentor,
  sponsor, contest manager, operations manager) can now reach the STEM
  console routes their role permits, without also needing `super-admin` or
  `system-admin`.
- `adminGroup`'s other routes (leads, chatbot, handoffs, analytics,
  competitions, reality-tv) are unaffected — still gated to platform admins
  only.
- Two middlewares now share `resolveVerifiedIdentity`; a future change to
  identity verification (e.g. token-refresh handling, additional account
  checks) only needs to happen once.
- Live-verified against local Supabase: a real user holding only `judge`
  (freshly assigned that single role, no platform-admin role) reaches
  `GET /api/v1/admin/stem/overview` (200) and is refused
  `POST /api/v1/admin/stem-sponsors` (403, not in `stemManage`'s allow-list).
