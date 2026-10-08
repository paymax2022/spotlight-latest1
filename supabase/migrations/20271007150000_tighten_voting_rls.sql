-- Tighten RLS on voting tables that were publicly readable/writable.
--
-- All legitimate access goes through the Next.js BFF using the service-role
-- admin client, which bypasses RLS entirely — these public policies served
-- no app consumer. They only exposed the data to anyone holding the (public)
-- anon key:
--
--   vote_totals_public_read          → live vote counts/ranks readable by
--                                      anyone, defeating voting_settings
--                                      visibility gating + freeze snapshots
--   leaderboard_snapshots_public_read→ same leak on snapshot rows
--   contestant_share_links_public_read→ exposes vote_count/paid_vote_count
--                                      columns on every share link
--   competition_entry_votes policies → public_read leaked voter PII
--                                      (user_id, voter_ip, voterName in
--                                      metadata); authenticated_insert let
--                                      any logged-in user write
--                                      vote_type='paid' rows with a
--                                      fabricated payment_reference straight
--                                      through Supabase REST, bypassing the
--                                      verified pay/initiate + pay/verify
--                                      rail and the app-level free-vote cap
--
-- Dropping a policy removes the access path (RLS stays enabled); nothing is
-- re-created — service_role needs no policy.

BEGIN;

DROP POLICY IF EXISTS vote_totals_public_read ON public.vote_totals;
DROP POLICY IF EXISTS leaderboard_snapshots_public_read ON public.leaderboard_snapshots;
DROP POLICY IF EXISTS contestant_share_links_public_read ON public.contestant_share_links;

DROP POLICY IF EXISTS "authenticated_insert_competition_entry_votes" ON public.competition_entry_votes;
DROP POLICY IF EXISTS "public_read_competition_entry_votes" ON public.competition_entry_votes;

COMMIT;
