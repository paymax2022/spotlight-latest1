# Events social: organiser profile, likes, follows, venue map, footer nav

Status: draft for review (not committed)
Date: 2026-10-17
Scope: `mobile-app/reactnative` (events screens), `backend/internal/top5events`, `supabase/migrations`, `contracts/openapi.yaml`

## Goal

Event and organiser pages should read like a real listing: a banner, a like button, follow/unfollow for organisers, a map of the venue, and a footer nav for the events section. Addresses captured by organisers should be autocompleted and resolved to coordinates.

## Current state (verified)

- `/events/organiser` has no page. It falls through to `app/events/[id].tsx` with `id = "organiser"`, which shows "Couldn't load event".
- The organiser dashboard is `app/events/organiser/dashboard.tsx`.
- The live `public.events` table (`20260726000200_events.sql`) has no banner, coordinates or venue place id. `organiser_id` references `auth.users(id)` directly, so there is no separate organiser table.
- The legacy `events` table (`20260616240000_events.sql`) has `banner_url` and `venue_address`. Any migration must use `ADD COLUMN IF NOT EXISTS` because the two definitions can collide.
- No like or follow tables exist for events. The social module (`20260716000200_social.sql`) covers payments and bills only.
- Address lookup already exists: `src/lib/addressLookup.ts` goes through the backend Maps proxy (Google autocomplete, geocoding, reverse) with an offline fallback. `AddressAutocompleteInput` is built on it.
- The venue map already exists: `src/features/mobility/components/MapView.tsx`, a MapLibre renderer.
- The footer already exists: `src/components/ModuleTabBar.tsx`, which shows only on its own tab paths.
- Feature flags follow `FEATURE_EVENTS_<NAME>` in Go and `EXPO_PUBLIC_EVENTS_<NAME>` in mobile. Mobile also reads both `EXPO_PUBLIC_EVENT_USE_MOCK` and `EXPO_PUBLIC_EVENTS_USE_MOCK`, which is an existing inconsistency this work does not fix.

## Decisions

1. **Full stack, live.** Migrations, Go endpoints, OpenAPI contract and mobile wiring all ship. Fixture mode mirrors the same response shapes.
2. **Organiser page at `/events/organiser/[id]`.** `/events/organiser` itself redirects to the dashboard for organisers, or to the events list otherwise.
3. **Stored counters.** `events.like_count` and `organiser_profiles.follower_count` are updated in the same transaction as each write. Like and follow rows have primary keys, so duplicate writes are no-ops.
4. **Footer tabs:** Following, Discover, My tickets, Organiser.
   - **Following** lists upcoming events from organisers the user follows.
   - There is no separate "liked events" list.
5. Likes and follows do not move money. They skip the ledger and idempotency-key rules that apply to money mutations.

## Data model (additive only)

```sql
-- Likes: one row per (event, user). PK makes a repeat like a no-op.
CREATE TABLE IF NOT EXISTS public.event_likes (
  event_id   uuid NOT NULL REFERENCES public.events(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- Follows: one row per (organiser, follower).
CREATE TABLE IF NOT EXISTS public.organiser_follows (
  organiser_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  follower_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organiser_id, follower_id)
);

-- Organiser profile, created lazily on first edit.
CREATE TABLE IF NOT EXISTS public.organiser_profiles (
  organiser_id   uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name   text,
  bio            text NOT NULL DEFAULT '',
  banner_url     text,
  follower_count int  NOT NULL DEFAULT 0 CHECK (follower_count >= 0),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

-- Event columns (all nullable or defaulted; no CHECK that could fail on legacy rows).
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS banner_url      text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_lat       double precision;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_lng       double precision;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS venue_place_id  text;
ALTER TABLE public.events ADD COLUMN IF NOT EXISTS like_count      int NOT NULL DEFAULT 0;
```

- **Profile upsert on follow:** a follow creates the `organiser_profiles` row if it does not exist, in the same transaction that inserts the follow and bumps `follower_count`. Without this, a first follow has no counter to update.
- **Row-level security:** the three new tables are readable by any signed-in user. A user can insert or delete only their own `event_likes` and `organiser_follows` rows. `organiser_profiles` is writable only by its organiser. Do not `FORCE` RLS without a write policy.
- **Migration stamp:** check for version collisions immediately before merging, per the repo rule.
- **Indexes:** `organiser_follows (follower_id)` for the Following query; `events (organiser_id, state, starts_at)` if it is not already present.

## API (contract first)

Spec PR updates `contracts/openapi.yaml` before any handler code. All routes are behind `FEATURE_EVENTS_SOCIAL`.

| Method | Path | Purpose | Notes |
|---|---|---|---|
| POST | `/events/:id/like` | Like an event | Idempotent. Returns `{ liked: true, like_count }` |
| DELETE | `/events/:id/like` | Unlike | Idempotent. Returns `{ liked: false, like_count }` |
| POST | `/events/organisers/:id/follow` | Follow an organiser | Idempotent. Returns `{ following: true, follower_count }` |
| DELETE | `/events/organisers/:id/follow` | Unfollow | Idempotent. Returns `{ following: false, follower_count }` |
| GET | `/events/organisers/:id` | Organiser profile | Display name, bio, banner, follower count, `following` for the caller, upcoming events |
| PUT | `/events/organisers/me` | Edit own profile | Display name, bio, banner URL |
| GET | `/events/following` | Following tab feed | Upcoming events from followed organisers |

- Event detail (`GET /events/:id`) adds `banner_url`, `venue_lat`, `venue_lng`, `venue_place_id`, `like_count` and `liked` for the caller.
- The route `/events/organisers/...` must be registered before any `/events/:id` param route, to avoid the same radix-router conflict the marketplace hit with `/listings/media`.
- Banner upload uses the existing R2 presigned flow. The bucket name comes from `R2_BUCKET`, with no default.

## Mobile

- **Event detail (`app/events/[id].tsx`):** banner image (falls back to the existing colour block), a like button with count, an organiser name that links to `/events/organiser/[id]`, and a MapLibre pin when coordinates exist. With no coordinates there is no map, rather than a broken one.
- **Organiser profile (`app/events/organiser/[id].tsx`, new):** banner, follow/unfollow, bio, and upcoming events.
- **`app/events/organiser/index.tsx` (new):** redirects to `dashboard` for organisers, or to `/events` otherwise.
- **Event create:** `AddressAutocompleteInput` supplies the address. `resolveCoordinate` fills `venue_lat`, `venue_lng` and `venue_place_id`.
- **Footer:** `ModuleTabBar` with Following, Discover, My tickets and Organiser. It shows on the events list and tab screens only, not on pushed detail screens.
- **Optimistic updates:** like and follow buttons update immediately and roll back on failure.
- **Fixture mode:** `src/features/events/api.ts` mirrors the same shapes, so the UI works without the backend.

## Flags

- Backend: `FEATURE_EVENTS_SOCIAL`.
- Mobile: `EXPO_PUBLIC_EVENTS_SOCIAL`.
- With the flag off, the banner, like, follow and footer surfaces are hidden and the existing screens behave as before.
- Verify the flag name in the Next proxy too, because the Next and Go sides can read different names.

## Error handling

- A like or follow on an unknown event or organiser returns 404. A duplicate returns the current state, not an error.
- Count drift is avoided by updating the counter in the same transaction as the row. A reconciliation query can recount if drift is ever suspected.
- Mobile shows a plain message on failure and rolls back the optimistic state.

## Testing

- **Go:** live-DB tests gated on `TEST_DATABASE_URL`, covering idempotent like and follow, counter accuracy under repeated calls, and RLS (a user cannot write another user's row).
- **Contract:** the spec PR must pass the OpenAPI validation in CI.
- **Mobile:** pure-logic unit tests under `tests/unit/events/`, for the Following feed mapping, coordinate handling and the no-coordinates fallback.
- **Manual:** verify the event page, organiser page and footer on the web preview, using fixture mode and then the live backend.

## Delivery

Split into PRs, each under 400 lines where possible:
1. Spec: OpenAPI contract plus this document. Adds an ADR under `ADR-PR<n>-events-social.md`, using the ADR naming rule.
2. Migrations: the schema above, with the collision check.
3. Go endpoints and tests, behind `FEATURE_EVENTS_SOCIAL`.
4. Mobile: fixture mode, then the live wiring.

## Risks and open items

- `events.organiser_id` references `auth.users`, so an organiser profile cannot be created for a user who has no auth row. This is expected.
- The legacy `events` table and the live one can differ. Every column add must be idempotent.
- The mobile flag inconsistency (`EVENT_USE_MOCK` vs `EVENTS_USE_MOCK`) is pre-existing. I will use the one the events API reads and note the other.
- Banner image moderation is out of scope. The design does not add a review step.
