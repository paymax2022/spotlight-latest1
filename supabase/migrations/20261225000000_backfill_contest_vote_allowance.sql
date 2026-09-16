-- Make the existing contests actually votable.
--
-- THE DEFECT
-- 20261223000000_connect_contests_bridge.sql derives the mobile app's free-vote
-- allowance as:
--     free_votes_per_user = GREATEST(COALESCE(contests.max_votes_per_user, 0), 0)
-- Nothing ever set contests.max_votes_per_user, so every mirrored contest landed
-- with ZERO free votes. Paid voting is off on all of them (vote_price_ngn = 0),
-- so the net effect was that NOBODY COULD VOTE ON ANY CONTEST — the mobile list
-- rendered, the rosters rendered, and every vote path was closed.
--
-- This was masked by the voting screen's mock fallback, which rendered invented
-- packages and allowances over the top of unvotable real data.
--
-- WHAT THIS DOES
--   • max_votes_per_user = 1 where unset — matches connect_contests' own column
--     default, and is the smallest allowance that makes a contest votable.
--   • voting_enabled = true, but ONLY for contests that have not ended. That
--     column gates the WEB free-vote path (free-vote.service.ts); it is not
--     mirrored to connect_contests and does not affect mobile. Retroactively
--     enabling voting on a finished contest would be rewriting history, so
--     'ended' is left alone.
--
-- Deliberately NOT touched:
--   • status        — live visibility is an operator decision, not a migration's
--   • vote_price_ngn — paid voting stays off until an admin sets a price
--
-- The contests -> connect_contests trigger fires on UPDATE, so the mirror picks
-- these up without a second write.
--
-- Idempotent: the WHERE clauses make a re-run a no-op. Additive only — no DROP,
-- no rename, no type narrowing.

UPDATE public.contests
   SET max_votes_per_user = 1
 WHERE max_votes_per_user IS NULL;

UPDATE public.contests
   SET voting_enabled = true
 WHERE voting_enabled IS DISTINCT FROM true
   AND status::text <> 'ended';
