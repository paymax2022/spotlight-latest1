# ADR-PR833: Stored counters for events social (likes and organiser follows)

Status: accepted with this PR. The ADR number is assigned on merge.

## Context

Events need likes and organiser follows, with counts on the event and organiser pages and a "Following" feed. The read path is hot (every event page view), and counts are shown on every card. Likes and follows do not move money, so the ledger and idempotency-key rules do not apply.

## Decision

- Likes and follows are stored as rows with composite primary keys: `event_likes(event_id, user_id)` and `organiser_follows(organiser_id, follower_id)`. A repeated write is a no-op by construction.
- The counters `events.like_count` and `organiser_profiles.follower_count` are stored and updated in the same transaction as the row. Each counter moves only when a row is actually inserted or deleted, and decrements are clamped at zero.
- The counters are not writable through the API. `authenticated` has no grant on `follower_count` and no grant on `banner_url`. On `events`, a trigger pins `like_count` for `authenticated` and `anon`. The backend connects as the service role, so the trigger does not affect it.
- Organiser visibility: an account is an organiser only if it owns at least one event. Profiles and follows are refused for any other account.

## Consequences

- Reads are one row per event or organiser, with no `count(*)` on the hot path.
- Direct PostgREST inserts into `event_likes` and `organiser_follows` are allowed by RLS. They bypass the counter update, so a counter can drift from its rows. A reconciliation query is the follow-up, and it is not in this PR.
- `FEATURE_EVENTS_SOCIAL` must not be enabled before the migration `20271094000000_events_social.sql` is applied in that environment.

## Alternatives considered

- Counting on read. Simpler, with no drift, but it adds a query to every card and every event page view.
- One generic reactions table for all entity types. Fewer migrations, but no foreign keys, so integrity moves into application code.
