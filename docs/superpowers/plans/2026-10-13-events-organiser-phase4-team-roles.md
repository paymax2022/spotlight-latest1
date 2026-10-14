# Phase 4 — Events organiser team roles (implementation plan)

Spec: docs/superpowers/specs/2026-10-11-events-organiser-self-service-design.md (§Phase 4 — Team roles)
Branch: feat/events-team-roles (off origin/main AFTER #733/Phase 3 merges — see "Branch base")
Flag: `FEATURE_EVENTS_TEAM_ROLES` (Go) / `EXPO_PUBLIC_EVENTS_TEAM_ROLES` (mobile), default OFF.

## Branch base
Phase 4 is independent of the Phase-3 code (different files), but `event_team_members` + `authorizeManage` already exist on main (shipped Phase 1). **No migration** — the table, indexes and RLS were created in `20271032000000_events_organiser_lifecycle.sql` (role CHECK IN ('MANAGER','FINANCE'), unique (event_id,user_id,role), granted_by, RLS mirroring stewards). Cut the branch from current origin/main; it does not need #733 merged first.

## Design decisions (from spec + user)
- **Team grant/revoke is OWNER-ONLY** (`assertOwner`, NOT `authorizeManage`). Spec authz matrix line 174: only the organiser grants/revokes team & stewards — a MANAGER granting MANAGER is privilege propagation and is disallowed. ListTeam is also owner-only (mirrors ListStewards).
- **MANAGER only for now** (user). The table CHECK allows FINANCE, but FINANCE is inert (no backend behavior until the payout slice). The grant endpoint accepts role and validates it is `MANAGER`; a FINANCE (or any other) role → ErrValidation ("role not yet available"). Keep the role param in the API shape for forward-compat.
- **Grant by handle/@cashtag** (`s.tags.Resolve`, like comps), per spec `POST /events/:id/team {user_handle, role}`. Revoke by userId path param (like steward).
- **Idempotent, not money.** No Idempotency-Key header (team grants move no money). Natural idempotency via the unique (event_id,user_id,role) index + `ON CONFLICT DO NOTHING`.
- **Can't grant the organiser to their own team** (they already own it) — reject with ErrValidation, or no-op; choose reject for clarity.
- Mobile writes throw `notInFixtureMode` (#698). Screen `app/events/organiser/team/[id].tsx` mirrors steward management. Dialogs via `src/lib/confirm.ts` (alertAsync/confirmAsync), tokens per design.md.

## Pre-flight conflict scan
| Tasks | Produces → Consumes | Finding |
|---|---|---|
| T1 → T2 | team.go (AddTeamMember/RemoveTeamMember/ListTeam, TeamMemberRow) → handlers | clean |
| T2 → T3,T4 | handler_team.go + routes + FEATURE_EVENTS_TEAM_ROLES → contract + mobile | clean |
| T3 → T4 | contract shapes → mobile types | clean (contract is syntax-gated only for events) |
| T4 | mobile api/hooks/types + screen | clean (mobile-only dir) |
No shared-file contention between T1 (service.go/new team.go) and later tasks if sequential. No migration. Mobile (T4) is backend-independent and may run parallel to T2/T3 review (but respect the single-committer/shared-index rule).

## Tasks

### Task 1: Service layer — team.go + tests
**Files:** create `backend/internal/top5events/team.go`; test `backend/internal/top5events/team_live_db_test.go`. (May add a `TeamMemberRow` type here or in model.go.)
**Produces:**
- `type TeamMemberRow struct { UserID, Handle, Name, Role, GrantedBy string; CreatedAt time.Time }` (enriched for the UI; Handle/Name via LEFT JOIN cashtag_handles/user_profiles like AttendeesForEvent).
- `func (s *Service) AddTeamMember(ctx, callerID, eventID, userHandle, role string) (TeamMemberRow, error)`: `assertOwner`; validate `role=="MANAGER"` else `ErrValidation`; resolve handle (`s.tags.Resolve`; unknown → ErrValidation naming the handle, per the comps pattern); reject granting the organiser themselves (ErrValidation); `INSERT ... ON CONFLICT (event_id,user_id,role) DO NOTHING`; return the enriched row (re-select so a replay returns the existing row too); audit `events.team.add`.
- `func (s *Service) RemoveTeamMember(ctx, callerID, eventID, userID string) error`: `assertOwner`; `DELETE FROM event_team_members WHERE event_id=$1 AND user_id=$2 AND role='MANAGER'`; audit `events.team.remove`. (Scope delete to MANAGER so a future FINANCE grant isn't collaterally removed.)
- `func (s *Service) ListTeam(ctx, callerID, eventID string) ([]TeamMemberRow, error)`: `assertOwner`; SELECT team rows (role='MANAGER' for now, or all roles — list all so FINANCE shows if ever present) enriched, ORDER BY created_at DESC.
- [ ] Step 1: failing live-DB tests `TestLiveDB_Team_*`: owner grants MANAGER by handle → row present + enriched; non-owner (incl. a MANAGER) grant → ErrForbidden; grant unknown handle → ErrValidation; grant FINANCE → ErrValidation; grant the organiser → ErrValidation; duplicate grant idempotent (one row); ListTeam owner-only (non-owner → ErrForbidden); Remove revokes + authorizeManage then fails for that user.
- [ ] Step 2: RED.  Step 3: implement.  Step 4: GREEN + full top5events suite; build/vet/gofmt clean.
- [ ] Step 5: commit `feat(events): per-event team-member grants (MANAGER) — service layer`.

### Task 2: Handlers, routes, flag
**Files:** `backend/internal/config/config.go` + `.env.example`; new `backend/internal/top5events/handler_team.go`; `backend/internal/app/top5_routes.go`; test `handler_team_live_db_test.go`.
**Produces:** `FeatureEventsTeamRoles` / `FEATURE_EVENTS_TEAM_ROLES` (default false), mirroring FeatureEventsComps. `RegisterTeam(member)` behind the flag:
- `POST /:id/team` `{user_handle, role}` → 201 {success,data:member}; ErrValidation→400, ErrForbidden→403, ErrNotFound→404.
- `GET /:id/team` → 200 {success,data:[members]}.
- `DELETE /:id/team/:userId` → 200 {success:true}.
- A `teamStatus` mapper (ErrNotFound 404 / ErrForbidden 403 / ErrValidation 400 / else 500) or reuse an existing one that covers these. Mirror handler_ticketing.go.
- [ ] TDD: flag on — owner POST 201, non-owner 403, bad role 400, GET 200, DELETE 200; flag off — all three 404. Then build/vet/gofmt.
- [ ] commit `feat(events): team-role routes behind FEATURE_EVENTS_TEAM_ROLES`.

### Task 3: OpenAPI contract
**Files:** `contracts/openapi.yaml`.
- [ ] `POST /events/{id}/team` ({user_handle, role}, 201/400/403/404), `GET /events/{id}/team` (200 list), `DELETE /events/{id}/team/{userId}` (200/403/404). Quote any description containing a comma (redocly flow-map lesson). Validate (python yaml parse; contract:check if node_modules present).
- [ ] commit `docs(contract): events team-role endpoints`.

### Task 4: Mobile api/types/hooks + screen
**Files:** `mobile-app/reactnative/src/features/events/{api,types,hooks,constants/events.constants.ts}`; new `mobile-app/reactnative/app/events/organiser/team/[id].tsx`.
**Produces:** `EVENTS_TEAM_ROLES_ENABLED` (env EXPO_PUBLIC_EVENTS_TEAM_ROLES, default off); `listTeam(eventId)`, `addTeamMember(eventId,{user_handle,role})` (throws notInFixtureMode), `removeTeamMember(eventId,userId)` (throws notInFixtureMode); types; hooks useTeam/useAddTeamMember/useRemoveTeamMember invalidating the team query; a team-management screen mirroring the steward screen — list members, add by handle, remove with a confirmAsync. Dialogs via src/lib/confirm.ts; tokens per design.md.
- [ ] tsc (`--stack-size=10000` if it crashes; if node_modules absent, say so + self-review). commit `feat(events-mobile): organiser team management (grant/revoke MANAGER)`.

## After all tasks
Final whole-branch review (authz owner-only on all writes, flag coverage, no money path, contract↔impl, no accidental FINANCE enablement), then PR. No migration ⇒ no stamp check needed, but re-fetch main before PR.
