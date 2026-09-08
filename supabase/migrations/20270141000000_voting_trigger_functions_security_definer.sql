-- Voting trigger functions must not depend on the caller's row-level security.
--
-- THE HAZARD (found by a brownfield review, not by a failing test)
-- The trigger functions added in 20270127/20270129/20270139/20270140 are
-- SECURITY INVOKER, and they INSERT into `vote_packages`, `voting_settings` and
-- `connect_votes`. RLS is enabled on all three, and vote_packages and
-- voting_settings have exactly one policy each — a public SELECT. Neither has
-- any INSERT or UPDATE policy.
--
-- So any writer to `contests` or `connect_contests` that is NOT bypassing RLS
-- raises 42501 INSIDE AN AFTER TRIGGER, which aborts its whole transaction:
-- creating or editing a contest would simply fail, with an error naming neither
-- the cause nor the fix.
--
-- Nothing is broken today — every current writer goes through createAdminClient()
-- (service_role, rolbypassrls). But `contests` already carries
-- authenticated_insert_contests / authenticated_update_contests, so the first
-- PostgREST-authenticated admin path added later would hit this. The trigger is
-- maintaining a derived projection on behalf of the system, not on behalf of the
-- caller, so it should run with the definer's rights.
--
-- Each function already sets an explicit search_path, which is the hygiene that
-- makes SECURITY DEFINER safe; this supplies the other half.
--
-- tg_open_contest_needs_votes is deliberately NOT changed: it is a BEFORE trigger
-- that only assigns to NEW and writes no table, so it has no RLS surface.

ALTER FUNCTION public.seed_default_vote_packages(UUID)       SECURITY DEFINER;
ALTER FUNCTION public.mirror_connect_contest_to_legacy(UUID) SECURITY DEFINER;
ALTER FUNCTION public.ensure_voting_settings(UUID)           SECURITY DEFINER;
ALTER FUNCTION public.tg_connect_tally_follows_credit()      SECURITY DEFINER;
