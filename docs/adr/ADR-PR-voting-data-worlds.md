# ADR-PR<pr-number>: Contestant roster lives in `contestants`; discovery reads it

- **Status:** Accepted (immediate decision); consolidation deferred
- **Date:** 2026-10-01
- **Module:** voting / contestant discovery

## Context

The web voting discovery surface (public vote page, contestant list + detail,
leaderboards, share links, contestant self-stats) returned nothing — the vote
page 404'd for every contestant (E2E audit finding F-2). Investigation found the
voting stack spread across **three parallel data worlds**, and the discovery
routes were reading the wrong one:

1. **`votes` / `vote_totals` + `contestants` (the live web engine).**
   `votes.contestant_id` and `vote_totals.contestant_id` reference the
   `contestants` roster. Verified against the DB: the existing confirmed vote
   row's `contestant_id` exists in `contestants`, not in `competition_enrollments`.
   Approved registrations are promoted into `contestants` via
   `promote_registration_to_contestant()` / the registration review seam
   (see ADR-PR-registration-review-seam).

2. **`competition_enrollments` (one-beat-one-verse foundation).** A richer
   enrollment table keyed by `competition_id` + a required `user_id`
   (FK `user_profiles`). The discovery routes read this table — but it is
   populated only by a separate open-mic/competition enrollment path, is empty
   for the registration-driven roster, and crucially is **not** what vote rows
   reference. A clean forward migration from `contestants` is blocked: legacy
   contestants have no `user_id`, which `competition_enrollments` requires.

3. **`connect_votes` / `connect_contests` (mobile Connect).** The mobile app
   casts votes through this third surface; the E2E audit confirmed that path
   works end to end.

So discovery read world (2) while votes lived in world (1): the routes could
never match a vote record, and additionally queried a `contest_id` column that
does not exist on `competition_enrollments` (its FK is `competition_id`).

## Decision

**Point web voting discovery at `contestants` — the table votes reference.**
All nine discovery routes now resolve contestants from `contestants`
(`contest_id`, `voting_link_slug`, `status in (approved, active)`), with columns
mapped to preserve each route's response shape. This makes the public voting
surface self-consistent with the vote records that already exist, with no data
migration and no change to the protected vote-recording services.

**Consolidation of the three worlds is explicitly deferred.** Unifying onto a
single roster (and deciding whether `competition_enrollments` or `connect_*`
becomes canonical) is a larger migration with production-data implications and is
not required for launch. It should be its own ADR + migration when prioritised.

## Consequences

- Web voting discovery works against real data today; vote counts/leaderboards
  are consistent with `votes`/`vote_totals` because both key on `contestants.id`.
- The `competition_enrollments` enrollment path and the Connect surface remain;
  the roster is effectively duplicated across worlds until consolidation.
- Any future unification must reconcile `competition_enrollments.user_id`
  (NOT NULL) with legacy user-less contestants, and decide whether mobile Connect
  and web share one roster.
