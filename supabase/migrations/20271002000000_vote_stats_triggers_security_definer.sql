-- AUD-DB-006 residual: the two vote-stats trigger functions are SECURITY
-- INVOKER, so they run with the CALLER's RLS privileges.
--
-- THE HAZARD
--   `on_vote_inserted` on public.contestant_votes fires for the anon PostgREST
--   path — policy public_insert_contestant_votes is `TO public` — but the
--   function body UPDATEs public.contestants, which carries only a public
--   SELECT policy. The write raises 42501 INSIDE the trigger and aborts the
--   whole vote insert, with an error naming neither the cause nor the fix.
--
--   Same shape on the admin path: `trigger_update_contestant_vote_stats` on
--   admin_votes INSERTs into contestant_vote_stats, which has a public SELECT
--   and an UPDATE policy but NO INSERT policy — a non-service-role admin vote
--   insert fails the same way.
--
--   Every current writer goes through service_role (rolbypassrls), so nothing
--   is broken today — but the anon contestant_votes insert is already
--   permitted by policy, so the edge is reachable now. Same bug class the
--   family hardened in 20270141000000_voting_trigger_functions_security_definer.
--
--   These triggers maintain system projections (totals, rankings), not
--   caller-owned rows, so definer rights are the correct security context.
--
-- HYGIENE (required before SECURITY DEFINER, same as 20270141000000): an
-- explicit search_path is pinned so a caller-controlled search_path cannot
-- redirect the body's unqualified references. Both bodies' unqualified
-- identifiers (contestant_vote_stats, NOW()) resolve under `public` —
-- verified against the current definitions in
-- 20270327000000_restore_contestant_vote_stats_paths.sql.

ALTER FUNCTION public.update_contestant_vote_stats()
  SECURITY DEFINER SET search_path = public;

ALTER FUNCTION public.update_contestant_vote_stats_from_contestant_votes()
  SECURITY DEFINER SET search_path = public;
