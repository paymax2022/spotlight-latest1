-- AUD-DB-006: restore the two distinct update_contestant_vote_stats() paths
--
-- HISTORY
--   20260404230000_contestant_module_full.sql defined
--     public.update_contestant_vote_stats() for trigger `on_vote_inserted` on
--     public.contestant_votes. That body recomputed contestants.total_votes
--     (SUM of contestant_votes.vote_count) and contestants.ranking
--     (RANK over the contest).
--   20260811000000_admin_voting.sql then ran CREATE OR REPLACE under the SAME
--     name for trigger `trigger_update_contestant_vote_stats` on admin_votes,
--     whose body upserts contestant_vote_stats (admin_votes / total_votes).
--
--   The later definition won, so BOTH triggers ran the admin-votes body:
--   every contestant_votes INSERT wrote contestant_vote_stats instead of
--   updating contestants.total_votes/ranking (and, pre-#396, failed outright
--   on the ambiguous unqualified `admin_votes` reference inside
--   ON CONFLICT ... DO UPDATE).
--
-- FIX (additive, idempotent)
--   1. public.update_contestant_vote_stats() is re-defined with the
--      admin-votes semantics and FULLY QUALIFIED contestant_vote_stats column
--      references (superset of the ambiguity fix in
--      20270325000000_fix_contestant_vote_stats_trigger.sql / PR #396, so the
--      end state is identical whichever lands first).
--   2. The April contestant_votes semantics are restored verbatim under a new
--      name, public.update_contestant_vote_stats_from_contestant_votes().
--   3. Trigger `on_vote_inserted` on public.contestant_votes is dropped and
--      recreated pointing at the restored function (drop+recreate inside one
--      migration preserves behavior; no table/data change).
--   4. Trigger `trigger_update_contestant_vote_stats` on public.admin_votes
--      is recreated pointing at update_contestant_vote_stats(), unchanged.
--
-- NOTE on security context: both bodies keep their original SECURITY
-- INVOKER default, matching the pre-collision behavior. Every current writer
-- path goes through service_role (rolbypassrls); hardening these to
-- SECURITY DEFINER like 20270141000000 did for other voting triggers is a
-- separate follow-up, not part of this restore.

-- 1. admin_votes path — keeps the existing function name and signature so
--    trigger `trigger_update_contestant_vote_stats` needs no rebind.
CREATE OR REPLACE FUNCTION public.update_contestant_vote_stats()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO contestant_vote_stats (contestant_id, admin_votes, total_votes)
  VALUES (NEW.contestant_id, NEW.vote_count, NEW.vote_count)
  ON CONFLICT (contestant_id) DO UPDATE SET
    admin_votes = contestant_vote_stats.admin_votes + COALESCE(NEW.vote_count - COALESCE(OLD.vote_count, 0), 0),
    total_votes = contestant_vote_stats.free_votes + contestant_vote_stats.paid_votes + (contestant_vote_stats.admin_votes + COALESCE(NEW.vote_count - COALESCE(OLD.vote_count, 0), 0)),
    updated_at = NOW();
  RETURN NEW;
END;
$$;

-- 2. contestant_votes path — restored verbatim from
--    20260404230000_contestant_module_full.sql under a distinct name.
CREATE OR REPLACE FUNCTION public.update_contestant_vote_stats_from_contestant_votes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  -- Update total_votes for the contestant
  UPDATE public.contestants
  SET total_votes = (
    SELECT COALESCE(SUM(vote_count), 0)
    FROM public.contestant_votes
    WHERE contestant_id = NEW.contestant_id
  ),
  updated_at = CURRENT_TIMESTAMP
  WHERE id = NEW.contestant_id;

  -- Recalculate rankings within the same contest
  WITH ranked AS (
    SELECT id,
      RANK() OVER (
        PARTITION BY contest_id
        ORDER BY total_votes DESC
      ) AS new_rank
    FROM public.contestants
    WHERE contest_id = NEW.contest_id
      AND is_active = true
  )
  UPDATE public.contestants c
  SET ranking = ranked.new_rank
  FROM ranked
  WHERE c.id = ranked.id;

  RETURN NEW;
END;
$$;

-- 3. Repoint the contestant_votes trigger at the restored function.
--    CREATE OR REPLACE TRIGGER (PG14+) repoints in place — the additive-only
--    CI guard rejects DROP statements in changed migration files.
CREATE OR REPLACE TRIGGER on_vote_inserted
  AFTER INSERT ON public.contestant_votes
  FOR EACH ROW EXECUTE FUNCTION public.update_contestant_vote_stats_from_contestant_votes();

-- 4. Re-assert the admin_votes trigger binding (idempotent).
CREATE OR REPLACE TRIGGER trigger_update_contestant_vote_stats
  AFTER INSERT OR UPDATE ON public.admin_votes
  FOR EACH ROW EXECUTE FUNCTION public.update_contestant_vote_stats();
