# ADR-PR184 — Contestant likes, profile-share links, and their engagement stats

**Date:** 2026-09-24
**Status:** Accepted
**Deciders:** User (screen scope + share-flow scope, via direct Q&A)
**Scope:** `backend/internal/connect/voting/{models.go,repo.go,service.go,handlers.go}`,
`backend/internal/app/{connect_routes.go,connect_money_routes.go}`, `backend/internal/config/config.go`,
`supabase/migrations/20270207000000_contestant_likes_and_shares.sql`,
`backend/tests/voting/contestant_likes_and_shares_live_db_test.go`,
`contracts/voting.openapi.yaml`,
`mobile-app/reactnative/src/features/voting/{types/voting.types.ts,api/voting.api.ts,api/connectVoting.mapper.ts,hooks/useContestantProfile.ts,components/ContestantStatsCard.tsx}`,
`mobile-app/reactnative/app/voting/{contestant-profile.tsx,contest-details.tsx}`,
`frontend-web/app/vote-link/[token]/{page.tsx,VoteLinkClient.tsx}`, `frontend-web/app/api/v1/connect/share/[token]/route.ts`.

## Context

The user asked for the mobile contest-detail and contestant-profile screens to
show "# of Likes" and "# profile shared" alongside the existing contestant
count / vote total, plus working Like and Share functionality — with sharing
specifically meant to let a stranger install the app, sign up, and vote for
that contestant.

Discovery found: the contestant profile screen already had a Heart icon and a
Share icon in its floating bar, but neither did anything real — the heart had
no `onPress` at all, and the share button opened a generic `Share.share()`
sheet with a hardcoded `spotlight.ng` fallback link and no tracking. The
`Contestant` type even carried `profileViews`/`shareClicks` fields already
rendered on a stats card, but nothing in the backend ever populated them — a
UI stub with no data behind it, not a working feature with a display bug. No
`contestant_likes` table, no share table, and no deep-linking configuration
(no Branch.io/Firebase Dynamic Links, no universal/app-links setup) existed
anywhere in the repo.

## Decision

**1. Two additive tables, live-counted, no denormalized counters** —
`contestant_likes` (unique per `(user_id, contestant_id)`) and
`contestant_shares` (one row per share action, holding the link's
`share_token`). Modeled directly on `restaurant_likes`
(`20270166000000_restaurant_likes.sql`), the closest existing "toggle +
count" precedent in this codebase, including learning its documented mistake:
RLS is enabled with a deny-all posture in the SAME migration that creates the
tables, not deferred to a follow-up (restaurant_likes shipped RLS-disabled and
needed a second migration later because its header only *described* the
lockdown without executing it).

**2. A new feature flag, `FEATURE_CONTESTANT_SOCIAL_ENABLED`, gates all four
new routes** (like, unlike, share, and the public share-resolve), following
the same pattern `FEATURE_CONTEST_STAGE_EVICTION_ENABLED` already uses inside
this same module — a sub-feature of an already-flagged module (`FEATURE_
CONNECT_ENABLED`) still gets its own flag per the root CLAUDE.md's "feature-
flag every new module, no flag, no merge" rule, rather than riding in
unconditionally on the parent flag.

**3. Counts and `liked_by_me` are joined into the EXISTING roster queries**
(`ListRoster`, `GetRosterEntry`) rather than served from new, separate
endpoints. Both queries already return one row per contestant with a live
vote tally computed the same way (`SUM(...) ... GROUP BY`), so adding two more
`LEFT JOIN ... GROUP BY` subqueries for like/share counts is the same shape of
work the file already does, and it means the mobile client gets likes/shares
for free on every screen that already calls these endpoints — no new round
trip. `viewerID` was threaded through both functions' signatures (empty string
where no viewer exists, e.g. the internal roster-membership check in
`checkRosterTarget` and the public share-resolve path) so `liked_by_me` can be
computed without a second query.

**4. The contest-detail screen's aggregate likes/shares are derived
client-side by summing the roster response**, not from a new backend
aggregate endpoint — this mirrors the EXISTING pattern in
`voting.api.ts:getContest()`, which already derives `contestantCount` and
`totalVotes` the same way for the same reason (the contest-detail Go endpoint
returns no roster-derived summary columns of its own).

**5. Share scope was deliberately limited to "simple link + referral param,"
not full deferred deep linking** — confirmed directly with the user rather
than assumed, after discovery found zero existing deep-linking infrastructure
in the repo (no Branch.io/Firebase Dynamic Links dependency, no
`associatedDomains`/`intentFilters` in `app.json`). Full deferred deep linking
(a fresh install from the share link lands directly in the vote flow with
zero extra taps) is a multi-day infra project on its own and was explicitly
scoped OUT. What ships instead:
   - `POST .../contestants/:id/share` records a share and returns a token; the
     client builds `{webBaseURL}/vote-link/{token}`.
   - A NEW public Next.js page, `app/vote-link/[token]`, resolves the token via
     a NEW, deliberately unauthenticated route (`GET /api/v1/connect/share/
     :token`) and shows who the visitor is being asked to vote for.
   - That page attempts the app's existing custom URL scheme
     (`paymaxrn://voting/contestant-profile?...`) — which only succeeds if the
     app is *already* installed — and otherwise shows App/Play Store links
     ONLY if `NEXT_PUBLIC_IOS_APP_STORE_URL`/`NEXT_PUBLIC_ANDROID_PLAY_STORE_URL`
     are actually configured (they are not yet: `app.json`'s bundle identifiers
     are still Expo's placeholder `com.anonymous.paymaxreactnativeapp`,
     confirming the app isn't published). An unconfigured store link renders as
     an honest "not available yet" message, never a dead link — same
     not-configured convention this repo already uses for secrets (`KEY=`
     empty, never a placeholder that reads as configured).
   - **What this does NOT do**: carry the share token or the referring
     contestant through a fresh app install. Someone without the app who
     follows the link today sees who to vote for and is told to get the app,
     but has to find the contestant again manually after installing — the
     "one extra tap" tradeoff the user explicitly accepted over building
     deferred linking.

**6. The share link path is `/vote-link/{token}`, not `/vote/{token}`** —
`frontend-web` already owns `/vote/[contestSlug]/[contestantSlug]` for its
own, separate, pre-existing web voting surface (a different voting engine
entirely — see the `vote-bridge` skill's note on the three parallel vote
planes this codebase carries). Next.js refuses two different dynamic segment
names at the same route position, so reusing `/vote/[token]` was not just
confusing, it would not have compiled.

**7. The public share-resolve route lives OUTSIDE the existing
`/api/v1/connect/[...path]` catch-all proxy**, as its own more-specific
Next.js route (`/api/v1/connect/share/[token]`), because that catch-all calls
`requireRequestUser()` unconditionally on every request — which would 401 a
stranger with no session before the request ever reached Go's own (correctly
unauthenticated) handler.

**8. Repurposed the existing but dead `profileViews`/`shareClicks` fields**
rather than adding parallel ones — `profileViews` had no real backend concept
behind it (nothing in this feature or the codebase tracks profile views), so
it was replaced with the real `likeCount`/`likedByMe`, and `shareClicks` was
renamed to `shareCount` to match the backend's field name and now carries a
real, live value instead of always rendering zero.

## Consequences

- Every contestant roster/detail response now carries two extra joins; at
  current data volumes this is the same cost class as the vote-tally join
  already there, so no separate perf concern was raised.
- `contestant_shares.sharer_user_id` is stored but not yet read by anything —
  it exists for a **future**, explicitly out-of-scope feature (crediting the
  sharer once a referred voter's own signup completes), not a half-built
  attribution system. No commission/reward logic was added.
- The share link's "install then find the contestant yourself" gap is a real,
  known UX cost of the scope decision in point 5, not an oversight — closing
  it fully requires adopting a deferred-deep-linking provider, a decision
  deliberately left for a later pass if the simple version's data justifies
  the investment.
- App/Play Store links on the landing page silently render as unavailable
  until someone sets `NEXT_PUBLIC_IOS_APP_STORE_URL`/
  `NEXT_PUBLIC_ANDROID_PLAY_STORE_URL` once the app is actually published —
  this is a deliberate placeholder-free default, not a bug to fix later.
