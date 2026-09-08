-- Close contests whose voting deadline has passed.
--
-- Nothing ever moved a contest to 'ended'. A contest stayed 'active' forever, so:
--   - /api/v1/contests (status in active|upcoming) kept listing it,
--   - the connect_contests mirror kept it 'open', and Go's ListContests
--     (status in open|closed) served it to the phone with a LIVE badge.
-- Votes were still correctly refused — votingOpen() in
-- backend/internal/connect/voting/service.go checks the closes_at window, not just
-- the status — so this was never a money bug, but every finished contest still
-- advertised itself as running.
--
-- The deadline is COALESCE(voting_end_date, end_date), matching exactly how the
-- 20261223000000 mirror derives connect_contests.closes_at. A contest with no
-- deadline at all is never auto-closed: no date means no expiry, and guessing one
-- would close contests an admin deliberately left open-ended.
--
-- Flipping contests.status is enough for BOTH planes — the mirror trigger fires on
-- UPDATE and maps ended -> closed.
--
-- Additive only: no DROP, no rename, no type narrowing.

CREATE OR REPLACE FUNCTION public.close_expired_contests()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  closed integer;
BEGIN
  -- Only active/upcoming move. 'draft' is a contest an admin has not published and
  -- must not be silently ended; 'ended' is already terminal.
  WITH expired AS (
    UPDATE public.contests
       SET status = 'ended', updated_at = now()
     WHERE status IN ('active', 'upcoming')
       AND COALESCE(voting_end_date, end_date) IS NOT NULL
       AND COALESCE(voting_end_date, end_date) < now()
    RETURNING 1
  )
  SELECT count(*)::integer INTO closed FROM expired;

  RETURN closed;
END;
$$;

COMMENT ON FUNCTION public.close_expired_contests() IS
  'Sets contests.status = ended for active/upcoming contests past COALESCE(voting_end_date, end_date). Idempotent; the connect_contests mirror follows via trigger. Invoked by the Go ticker contests.StartExpiryCloser.';

-- service_role only: this is a background maintenance function, not something a
-- member or an anonymous caller should be able to invoke.
REVOKE ALL ON FUNCTION public.close_expired_contests() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.close_expired_contests() TO service_role;
