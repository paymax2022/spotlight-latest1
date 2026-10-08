-- Fix ambiguous "admin_votes" reference in update_contestant_vote_stats()
--
-- The function defined in 20260811000000_admin_voting.sql uses an unqualified
-- `admin_votes` column reference inside ON CONFLICT (contestant_id) DO UPDATE.
-- In a DO UPDATE clause, unqualified names are resolved against BOTH the target
-- table (contestant_vote_stats) and the `excluded` pseudo-relation, so
-- `admin_votes` is ambiguous and the statement fails with:
--   ERROR: column reference "admin_votes" is ambiguous
-- The same function is bound to trigger `on_vote_inserted` ON
-- public.contestant_votes (created in 20260404230000_contestant_module_full.sql
-- before the body was replaced), so every contestant_votes INSERT fails.
--
-- Fix (additive, in place): CREATE OR REPLACE FUNCTION with the same signature
-- and behavior, but with the target-table column references fully qualified as
-- `contestant_vote_stats.admin_votes`.

CREATE OR REPLACE FUNCTION public.update_contestant_vote_stats()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO contestant_vote_stats (contestant_id, admin_votes, total_votes)
  VALUES (NEW.contestant_id, NEW.vote_count, NEW.vote_count)
  ON CONFLICT (contestant_id) DO UPDATE SET
    admin_votes = contestant_vote_stats.admin_votes + COALESCE(NEW.vote_count - COALESCE(OLD.vote_count, 0), 0),
    total_votes = contestant_vote_stats.free_votes + contestant_vote_stats.paid_votes + (contestant_vote_stats.admin_votes + COALESCE(NEW.vote_count - COALESCE(OLD.vote_count, 0), 0)),
    updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
