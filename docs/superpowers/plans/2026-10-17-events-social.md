# Events social Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give events and organisers a banner, likes, organiser follow/unfollow, a venue map, address autocomplete on the event form, and a footer nav for the events section.

**Architecture:** Additive tables for likes, follows and organiser profiles, plus new columns on `events`, behind `FEATURE_EVENTS_SOCIAL`. The Go handlers live in `backend/internal/top5events` and register through a `RegisterSocial` group, the same way `RegisterComps` does. The mobile side adds pure helpers (tested with `node:test`), fixture-mode implementations that mirror the live shapes, and screens wired to the existing `ModuleTabBar`, `AddressAutocompleteInput` and `MapView`.

**Tech Stack:** Go 1.23 + Gin v1.10 + pgx; PostgreSQL 17 (Supabase migrations); OpenAPI 3 (`contracts/openapi.yaml`); React Native / Expo Router; `node:test` for mobile unit tests.

**Spec:** [docs/superpowers/specs/2026-10-17-events-social-design.md](../specs/2026-10-17-events-social-design.md). Executors read both.

## Global Constraints

- Feature flags: backend `FEATURE_EVENTS_SOCIAL`, mobile `EXPO_PUBLIC_EVENTS_SOCIAL`. Mobile defaults to off unless the value is exactly `true`.
- Migrations are additive only: no DROP, no rename, no type narrowing. Provisional version `20271045000000`, one above the current `origin/main` head `20271043000000`. Re-run `scripts/ci/check-migration-versions.sh` immediately before merging.
- Contract first: `contracts/openapi.yaml` changes merge before any handler code.
- Likes and follows move no money: no ledger posting and no `Idempotency-Key` requirement. Both endpoints are still idempotent by construction (primary keys).
- ADR: the decision to store counters on the rows gets `docs/adr/ADR-PR<pr-number>-events-social.md`. Never choose the ADR number yourself; cite `ADR-PR<pr-number>` in every reference.
- Route parameters are `:id` everywhere in the new routes. Gin rejects sibling params with different names at the same level.
- Live-DB Go tests skip unless `TEST_DATABASE_URL` is set. Mobile tests use `node --experimental-strip-types`.
- Conventional Commits. Each PR under 400 changed lines where possible.
- Branch: create `feat/events-social` from `origin/main`. Do not build on `fix/marketplace-ai-category`, which holds an unrelated staged marketplace fix.
- Commit steps run only after the user has asked to commit (repo rule). Until then, stop at each task's verification step with changes left in the tree.
- Fixture writes (like, follow, profile edit) go to an in-memory store that lasts for the session. They do not use the `notInFixtureMode` refusal, because likes are the behaviour under test in fixture mode. The store is never presented as persisted.

## Review Focus

1. **Double-tap or concurrent like.** Two like requests for the same event from one user must leave `like_count` equal to the number of `event_likes` rows, and must not return an error. Owned by Task 3.
2. **Unfollow when not following, or unlike when not liked.** The counter must never go below zero, and the response must report the actual state. Owned by Task 3.
3. **Event with no coordinates or no banner.** The detail screen must render with no map and no banner image, without a crash or an empty broken map. Owned by Tasks 9 and 11.
4. **Like on a draft or non-public event.** Must return 404, the same as a missing event, so existence is not leaked. Owned by Task 4.
5. **Organiser following themselves.** Must be rejected with 422 and leave the counter unchanged. Owned by Task 3.

---

### Task 1: Contract and ADR

**Files:**
- Modify: `contracts/openapi.yaml` (add paths under the `Events` tag, after `/events/{id}/stewards`)
- Create: `docs/adr/ADR-PR<pr-number>-events-social.md` (name assigned on PR open; never pick the number)

**Interfaces:**
- Consumes: the spec's API table.
- Produces: operation IDs `likeEvent`, `unlikeEvent`, `followOrganiser`, `unfollowOrganiser`, `getOrganiser`, `updateMyOrganiser`, `presignOrganiserBanner`, `listFollowingEvents`. Later tasks use these names in handler method names and in the mobile API.

- [ ] **Step 1: Add the seven operations.** Each request and response uses the envelope `{ success: boolean, data: ... }` already used by `getEvent`. Response schemas:
  - `LikeState`: `{ liked: boolean, like_count: integer }`
  - `FollowState`: `{ following: boolean, follower_count: integer }`
  - `OrganiserProfile`: `{ organiser_id, display_name, bio, banner_url, follower_count, following, events: EventSummary[] }`
  - `OrganiserPatch`: `{ display_name?, bio?, banner_url? }`

- [ ] **Step 2: Add the event fields.** `Event` gains `banner_url`, `venue_lat`, `venue_lng`, `venue_place_id` (all nullable), `like_count` (integer), `liked` (boolean, for the caller).

- [ ] **Step 3: Validate the YAML.** Run the check the openapi lane runs (see `.github/workflows/_reusable-openapi-validate.yml`). Expected: the lane passes and no existing operation ID changed.

- [ ] **Step 4: Write the ADR.** Context: counters are stored, not counted on read. Decision: update counters in the same transaction as the row. Consequence: a reconciliation query exists if drift is suspected.

- [ ] **Step 5: Open the spec PR** with the contract and ADR only. Wait for the openapi lane to pass before Task 2.

---

### Task 2: Migration

**Files:**
- Create: `supabase/migrations/20271045000000_events_social.sql`

**Interfaces:**
- Produces: tables `event_likes(event_id, user_id)`, `organiser_follows(organiser_id, follower_id)`, `organiser_profiles(organiser_id PK, display_name, bio, banner_url, follower_count)`. Columns on `events`: `banner_url`, `venue_lat`, `venue_lng`, `venue_place_id`, `like_count`.

- [ ] **Step 1: Write the schema test first.** Add a SQL assertion file that the migration test harness runs after `supabase db reset`. It checks each table exists with its primary key, each new `events` column exists and is nullable (except `like_count`, which defaults to 0), and that `follower_count` cannot be negative.

- [ ] **Step 2: Run it and confirm it fails.** Expected: FAIL, the tables do not exist yet.

- [ ] **Step 3: Write the migration** with `CREATE TABLE IF NOT EXISTS` and `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Use the exact DDL in the spec's Data model section. Add the index `organiser_follows (follower_id)` and `events (organiser_id, state, starts_at)` only if the second is absent.

- [ ] **Step 4: Enable RLS and add policies.** Read: any signed-in user. Write: a user inserts or deletes only their own `event_likes` and `organiser_follows` rows. `organiser_profiles` is writable only by its own organiser. Do not `FORCE` RLS without a write policy.

- [ ] **Step 5: Run the test and the version check.** Expected: schema test PASS; `scripts/ci/check-migration-versions.sh` reports no collision.

---

### Task 3: Store and service (likes, follows, profile)

**Files:**
- Create: `backend/internal/top5events/social_store.go`
- Create: `backend/internal/top5events/social_service.go`
- Test: `backend/internal/top5events/social_live_db_test.go`

**Interfaces:**
- Produces:
  - `type LikeState struct { Liked bool \`json:"liked"\`; LikeCount int \`json:"like_count"\` }`
  - `type FollowState struct { Following bool \`json:"following"\`; FollowerCount int \`json:"follower_count"\` }`
  - `func (s *Service) LikeEvent(ctx context.Context, userID, eventID string) (LikeState, error)`
  - `func (s *Service) UnlikeEvent(ctx context.Context, userID, eventID string) (LikeState, error)`
  - `func (s *Service) FollowOrganiser(ctx context.Context, userID, organiserID string) (FollowState, error)`
  - `func (s *Service) UnfollowOrganiser(ctx context.Context, userID, organiserID string) (FollowState, error)`
- Errors: a missing or non-public event returns the package's existing not-found error (find it in `service.go` before writing). Self-follow returns the package's existing 422-style validation error.

- [ ] **Step 1: Write the failing live-DB tests.** Gate them on `TEST_DATABASE_URL` like `ticket_token_live_db_test.go`. Required tests:
  - `TestLikeEvent_TwiceCountsOnce`: call `LikeEvent` twice with one user. Assert `LikeCount == 1` both times and exactly one `event_likes` row.
  - `TestUnlikeEvent_NeverBelowZero`: unlike an event never liked. Assert `LikeCount == 0` and `Liked == false`.
  - `TestFollowOrganiser_CreatesProfileRow`: follow an organiser with no profile row. Assert an `organiser_profiles` row now exists with `follower_count == 1`.
  - `TestFollowOrganiser_SelfRejected`: organiser follows themselves. Assert the validation error and `follower_count` unchanged.
  - `TestLikeEvent_DraftIsNotFound`: like a DRAFT event. Assert not-found and no row written.

- [ ] **Step 2: Run them and confirm they fail.** Command: `cd backend && TEST_DATABASE_URL=$TEST_DATABASE_URL go test ./internal/top5events -run 'Like|Follow' -count=1 -v`. Expected: FAIL, the methods are undefined.

- [ ] **Step 3: Implement the store.** Each like or follow is one transaction: insert the row with `ON CONFLICT DO NOTHING`, and bump the counter only when a row was inserted (`RowsAffected() == 1`). Unlike and unfollow delete the row and decrement only when a row was deleted, with `GREATEST(count - 1, 0)` as a second guard. Follow upserts the `organiser_profiles` row before the counter update.

- [ ] **Step 4: Implement the service methods** on `*Service` so they use the same pool as the existing methods. Check the event state (`LIVE`, `APPROVED`, or `CLOSED` are public) before writing a like.

- [ ] **Step 5: Run the tests and confirm they pass.** Same command as Step 2. Expected: PASS for all five. Then `go vet ./internal/top5events`.

---

### Task 4: Handlers and the gated route group

**Files:**
- Create: `backend/internal/top5events/social_handler.go`
- Modify: `backend/internal/app/top5_routes.go` (gate the group on `FEATURE_EVENTS_SOCIAL`, the same way `RegisterComps` is gated)
- Test: `backend/internal/top5events/social_routes_test.go`

**Interfaces:**
- Consumes: the `Service` methods from Task 3.
- Produces: `func (h *Handler) RegisterSocial(member *gin.RouterGroup)`, plus handler methods `LikeEvent`, `UnlikeEvent`, `FollowOrganiser`, `UnfollowOrganiser`.

- [ ] **Step 1: Write the failing route test.** Build a Gin engine, call `RegisterSocial`, and assert:
  - `engine.Routes()` contains `POST /:id/like`, `DELETE /:id/like`, `POST /organisers/:id/follow` and `DELETE /organisers/:id/follow`.
  - Registration does not panic. This is the regression check for the sibling-param rule.
  - Without the flag, `RegisterSocial` is not called, so the routes are absent.

- [ ] **Step 2: Run it and confirm it fails.** Expected: FAIL, `RegisterSocial` is undefined.

- [ ] **Step 3: Implement the handlers.** Parse `:id` and the caller's user ID the same way the existing handlers do. Map the service's not-found error to 404 and the self-follow error to 422. Return the state structs as the response `data`.

- [ ] **Step 4: Gate the registration** in `top5_routes.go`, next to the existing `RegisterComps` call, on `FEATURE_EVENTS_SOCIAL`.

- [ ] **Step 5: Run the route test and confirm it passes.** Then `go build ./...` from `backend/`. Expected: PASS and a clean build.

---

### Task 5: Event reads carry the social fields

**Files:**
- Modify: `backend/internal/top5events/model.go` (add `BannerURL`, `VenueLat`, `VenueLng`, `VenuePlaceID`, `LikeCount`, `Liked`, all JSON-tagged snake_case)
- Modify: the event select used by `GetEvent` and `ListEvents`. Locate it in `backend/internal/top5events/service.go` before editing.
- Modify: `backend/internal/top5events/social_service.go` (add `ListFollowingEvents`)
- Test: `backend/internal/top5events/social_live_db_test.go` (extend)

**Interfaces:**
- Produces: `func (s *Service) ListFollowingEvents(ctx context.Context, userID string) ([]Event, error)`. Returns upcoming LIVE or APPROVED events whose organiser the user follows, ordered by `starts_at`.

- [ ] **Step 1: Write the failing tests.**
  - `TestGetEvent_LikedFlagIsPerCaller`: user A likes an event; `GetEvent` for A returns `Liked == true`, and for B returns `Liked == false`. Both see `LikeCount == 1`.
  - `TestListFollowingEvents_OnlyFollowedOrganisers`: a user follows organiser X but not Y. The feed contains X's upcoming events and none of Y's.
  - `TestGetEvent_NoCoordinatesIsValid`: an event with NULL `venue_lat` and `venue_lng` returns 200 with null fields, not an error.

- [ ] **Step 2: Run and confirm FAIL.**

- [ ] **Step 3: Add the columns to the select** and the struct fields. `Liked` comes from a `LEFT JOIN` on `event_likes` for the caller, with `COALESCE(..., false)`. Keep the existing query shape.

- [ ] **Step 4: Implement `ListFollowingEvents`** as one query joining `organiser_follows` to `events` on `organiser_id = organiser_id`, filtered to the upcoming LIVE or APPROVED states.

- [ ] **Step 5: Run and confirm PASS.** Then the existing `top5events` test suite, to confirm the select change broke nothing: `go test ./internal/top5events -count=1`.

---

### Task 6: Organiser profile and banner upload

**Files:**
- Create: `backend/internal/top5events/organiser_profile.go` (`GetOrganiser`, `UpdateMyOrganiser`, `PresignOrganiserBanner`)
- Modify: `backend/internal/top5events/social_handler.go` (add handlers, register in `RegisterSocial`)
- Test: `backend/internal/top5events/organiser_profile_live_db_test.go`

**Interfaces:**
- Produces:
  - `type OrganiserProfile struct { OrganiserID string; DisplayName string; Bio string; BannerURL *string; FollowerCount int; Following bool; Events []Event }`, JSON snake_case.
  - `func (s *Service) GetOrganiser(ctx context.Context, viewerID, organiserID string) (*OrganiserProfile, error)`
  - `func (s *Service) UpdateMyOrganiser(ctx context.Context, userID string, in OrganiserPatch) (*OrganiserProfile, error)`
  - `func (s *Service) PresignOrganiserBanner(ctx context.Context, userID, fileName, contentType string) (*BannerPresign, error)`

- [ ] **Step 1: Write the failing tests.**
  - `TestGetOrganiser_FallsBackToFullName`: an organiser with no profile row returns `DisplayName` equal to `user_profiles.full_name`.
  - `TestUpdateMyOrganiser_RejectsForeignBannerKey`: a banner URL key owned by another user is rejected, the same check `validateStoreImageRefs` makes for restaurants.
  - `TestPresignOrganiserBanner_RejectsBadContentType`: a non-image content type is rejected before a URL is issued.

- [ ] **Step 2: Run and confirm FAIL.**

- [ ] **Step 3: Implement the banner presign by mirroring `backend/internal/restaurant/store_images.go` step for step.** Key prefix `organiser/<id>/banner/`. The presigned PUT expires in the same window as the restaurant presign. Reuse the `R2_BUCKET` configuration with no default. Do not hard-code a bucket name.

- [ ] **Step 4: Implement `GetOrganiser`, which joins the profile, the follower count and the caller's follow state, then loads upcoming events.** `UpdateMyOrganiser` upserts the row and refuses any banner key not under the caller's prefix.

- [ ] **Step 5: Run and confirm PASS.** Then `go vet ./internal/top5events`.

---

### Task 7: Mobile types and fixture mirror

**Files:**
- Modify: `mobile-app/reactnative/src/features/events/types.ts` (add `OrganiserProfile`, `LikeState`, `FollowState`, `OrganiserPatch`; extend `EventDetail` with the new fields)
- Modify: `mobile-app/reactnative/src/features/events/api.ts` (add the functions below; fixture branches under the existing `USE_MOCK` switch)
- Create: `mobile-app/reactnative/src/features/events/social.ts` (pure helpers, Task 8 tests them)

**Interfaces:**
- Produces, in `api.ts`:
  - `likeEvent(id: string): Promise<LikeState>` → `POST /events/:id/like`
  - `unlikeEvent(id: string): Promise<LikeState>` → `DELETE /events/:id/like`
  - `followOrganiser(id: string): Promise<FollowState>` → `POST /events/organisers/:id/follow`
  - `unfollowOrganiser(id: string): Promise<FollowState>` → `DELETE /events/organisers/:id/follow`
  - `getOrganiser(id: string): Promise<OrganiserProfile>`
  - `updateMyOrganiser(patch: OrganiserPatch): Promise<OrganiserProfile>`
  - `listFollowingEvents(): Promise<EventSummary[]>`
- Produces, in `social.ts`: `applyLikeToggle(state: { liked: boolean; count: number }, next: boolean): { liked: boolean; count: number }` and `applyFollowToggle` with the same signature shape.

- [ ] **Step 1: Write the failing unit test** `tests/unit/events/social.spec.ts`. Required assertions:
  - `applyLikeToggle({liked:false,count:0}, true)` → `{liked:true,count:1}`.
  - `applyLikeToggle({liked:true,count:1}, false)` → `{liked:false,count:0}`.
  - `applyLikeToggle({liked:false,count:0}, false)` → `{liked:false,count:0}`, the count never goes negative.
  - `applyFollowToggle` obeys the same three rules.

- [ ] **Step 2: Run and confirm FAIL.** Command: `cd mobile-app/reactnative && npm run test:events`. Expected: FAIL, the module is missing.

- [ ] **Step 3: Implement `social.ts`** with the two toggle functions. Each returns a new object and never mutates its input.

- [ ] **Step 4: Add the types and the API functions.** Live branches call the paths above through the existing client. Fixture branches read and write an in-memory `Map` keyed by event or organiser ID, seeded from `MOCK_EVENTS`, and return the shapes above. Add no `notInFixtureMode` guard to these.

- [ ] **Step 5: Run the unit test and confirm PASS.** Then the typecheck: `npm run typecheck` (it sets `--stack-size=15000`). Expected: no new errors in the changed files.

---

### Task 8: Hooks with optimistic updates

**Files:**
- Modify: `mobile-app/reactnative/src/features/events/hooks.ts` (add `useLikeEvent`, `useFollowOrganiser`, `useOrganiser`, `useFollowingEvents`)

**Interfaces:**
- Consumes: the Task 7 API functions and `applyLikeToggle` / `applyFollowToggle`.
- Produces:
  - `useLikeEvent(eventId: string)` and `useFollowOrganiser(organiserId: string)`, each returning `{ state, toggle }`. `toggle` applies the change optimistically, calls the API, and rolls back to the previous state if the call fails.
  - `useOrganiser(organiserId: string)` returning the react-query result for `getOrganiser` (used by Task 10).
  - `useFollowingEvents()` returning the react-query result for `listFollowingEvents` (used by Task 12).

- [ ] **Step 1: Add a rollback test** to `social.spec.ts`. Assert that `applyLikeToggle` applied and then reversed with the previous `liked` value returns the original state.

- [ ] **Step 2: Run and confirm PASS** (the helper already exists, so this pins the rollback contract). Then implement the hooks.

- [ ] **Step 3: Implement the hooks** on `react-query`, the same way the existing event hooks are written. Keep rollback in `onError` by restoring the snapshot from `onMutate`.

- [ ] **Step 4: Run `npm run test:events` and `npm run typecheck`.** Expected: both pass.

---

### Task 9: Event detail screen

**Files:**
- Modify: `mobile-app/reactnative/app/events/[id].tsx`
- Create: `mobile-app/reactnative/src/features/events/venue.ts` (pure: `venueMapState`)
- Test: `mobile-app/reactnative/tests/unit/events/venue.spec.ts`

**Interfaces:**
- Produces: `venueMapState(e: { venue_lat?: number | null; venue_lng?: number | null }): 'pin' | 'none'`. Returns `'pin'` only when both values are finite numbers.
- Consumes: `useLikeEvent` (Task 8), and `MapView` from `@/features/mobility/components/MapView`. The organiser name links to `/events/organiser/[id]` using the event's `organiser_id`.

- [ ] **Step 1: Write the failing test** `venue.spec.ts`. Assert `venueMapState` returns `'pin'` for finite coordinates, and `'none'` for `null`, `undefined`, `NaN` and `Infinity` in either field.

- [ ] **Step 2: Run and confirm FAIL.** Command: `npm run test:events`.

- [ ] **Step 3: Implement `venue.ts`**, then update the screen:
  - Banner: `banner_url` as an image when set, with the existing colour block as the fallback.
  - Like button with `like_count`, using `useLikeEvent`.
  - Organiser name as a link to `/events/organiser/[organiser_id]`.
  - Map: render `MapView` with one marker only when `venueMapState` returns `'pin'`. Otherwise render nothing for the map.
  - Everything behind `EXPO_PUBLIC_EVENTS_SOCIAL`: when the flag is off, the screen matches today's layout.

- [ ] **Step 4: Run the unit test and confirm PASS.** Then verify in the browser preview in fixture mode (see Task 13). Expected: the banner, like button and map render, and an event without coordinates shows no map and does not crash.

---

### Task 10: Organiser profile and the organiser index

**Files:**
- Create: `mobile-app/reactnative/app/events/organiser/[id].tsx` (profile: banner, follow/unfollow, bio, upcoming events)
- Create: `mobile-app/reactnative/app/events/organiser/index.tsx` (redirect)
- Test: `mobile-app/reactnative/tests/unit/events/organiser.spec.ts`

**Interfaces:**
- Produces: `organiserIndexTarget(isOrganiser: boolean): '/events/organiser/dashboard' | '/events'`.
- Consumes: the organiser gate that `app/events/organiser/dashboard.tsx` already uses to decide who may see the dashboard (copy that check, do not invent a new one).

- [ ] **Step 1: Write the failing test.** `organiserIndexTarget(true)` returns the dashboard path, and `organiserIndexTarget(false)` returns `/events`. Run `npm run test:events` and confirm FAIL.

- [ ] **Step 2: Implement `organiser.ts`** (or add the function to `social.ts`, whichever keeps the file focused) and the index redirect with `<Redirect />` from `expo-router`.

- [ ] **Step 3: Implement the profile screen.** It uses `getOrganiser` through a `useOrganiser(id)` hook and `useFollowOrganiser`. It shows the banner, follower count, the follow button, the bio and the upcoming events. A missing organiser shows the existing `StateView` error.

- [ ] **Step 4: Run the unit test and confirm PASS.** Verify in the preview: `/events/organiser` redirects and `/events/organiser/<id>` shows the profile.

---

### Task 11: Event form address autocomplete

**Files:**
- Modify: `mobile-app/reactnative/app/events/organiser/create.tsx` (replace the plain `venue` text field with `AddressAutocompleteInput`)
- Create: `mobile-app/reactnative/src/features/events/venuePatch.ts` (pure: `venuePatchFromSelection`)
- Test: `mobile-app/reactnative/tests/unit/events/venuePatch.spec.ts`

**Interfaces:**
- Produces: `venuePatchFromSelection(sel: { label: string; lat: number; lng: number; placeId?: string | null } | null): { venue: string; venue_lat: number | null; venue_lng: number | null; venue_place_id: string | null }`. A null selection clears all four fields.
- Consumes: `AddressAutocompleteInput` (its `onSelect` carries the geocoded coordinate) and `resolveCoordinate` when a hit has no coordinates yet.

- [ ] **Step 1: Write the failing test.** Assert a full selection maps all four fields, and a null selection returns `venue: ''` and three nulls.

- [ ] **Step 2: Run and confirm FAIL.**

- [ ] **Step 3: Implement `venuePatch.ts`**, then wire the screen. When the user picks a place, call `venuePatchFromSelection` and merge the result into the form. Include the three coordinate fields in the create and update payloads. Keep the plain text input as the fallback when lookup is disabled.

- [ ] **Step 4: Run the unit test and confirm PASS.** Verify in the preview: typing an address shows suggestions, and picking one fills the venue.

---

### Task 12: Footer nav and the Following screen

**Files:**
- Create: `mobile-app/reactnative/app/events/following.tsx`
- Modify: `mobile-app/reactnative/app/events/index.tsx`, `mobile-app/reactnative/app/events/my-tickets.tsx` (add the footer)
- Create: `mobile-app/reactnative/src/features/events/tabs.ts` (pure: `EVENTS_TAB_HREFS`)
- Test: `mobile-app/reactnative/tests/unit/events/tabs.spec.ts`

**Interfaces:**
- Produces: `EVENTS_TAB_HREFS: readonly ['/events/following', '/events', '/events/my-tickets', '/events/organiser']`.
- Consumes: `ModuleTabBar` with `ModuleTab` items (`href`, `label`, `icon`, `matchPrefixes`). The order of the tabs follows `EVENTS_TAB_HREFS`.

- [ ] **Step 1: Write the failing test.** Assert the array has exactly those four entries in that order, and that each entry has a matching route file under `app/events/`. The test reads the file system, so it fails if a route is renamed.

- [ ] **Step 2: Run and confirm FAIL.**

- [ ] **Step 3: Implement `tabs.ts`**, the Following screen (`listFollowingEvents` through a hook, with the existing `StateView` for empty and error states), and the footer on the events index and my-tickets screens. `ModuleTabBar` stays hidden on pushed detail screens, as its own comment specifies.

- [ ] **Step 4: Run the unit test and confirm PASS.** Verify in the preview that the footer shows on the events list and my-tickets, and is absent on an event detail screen.

---

### Task 13: Flags, verification and PR split

**Files:**
- Modify: `mobile-app/reactnative/package.json` (add the `test:events` script, matching the other `test:*` scripts)

- [ ] **Step 1: Add the script:** `"test:events": "node --experimental-strip-types --import ./tests/unit/register-ts-paths.mjs --test \"tests/unit/events/*.spec.ts\""`.

- [ ] **Step 2: Verify the flags off.** With `FEATURE_EVENTS_SOCIAL` unset, the social routes are absent (Task 4 test). With `EXPO_PUBLIC_EVENTS_SOCIAL` unset, the event screen matches the current layout. Expected: both hold.

- [ ] **Step 3: Run the full local gate.**
  - Backend: `cd backend && go vet ./... && go build ./... && TEST_DATABASE_URL=$TEST_DATABASE_URL go test ./internal/top5events -count=1`
  - Mobile: `cd mobile-app/reactnative && npm run test:events && npm run typecheck`
  - Expected: all pass with no new failures.

- [ ] **Step 4: Verify in the browser preview** (fixture mode first, then live). Check `/events/organiser` redirects, the event page shows the banner, like and map, the organiser page follows and unfollows, the address field autocompletes, and the footer appears on the events tabs. Record a screenshot for each.

- [ ] **Step 5: Split the PRs** in this order, each under 400 changed lines where possible: (1) contract and ADR, Task 1; (2) migration, Task 2; (3) Go, Tasks 3 to 6 (plus the flag in Task 4); (4) mobile, Tasks 7 to 13. Run the migration version check again before merging (2) and (3).
