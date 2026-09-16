-- UAT Batch 6 — CS-010 / VI-009 / AD-011 / VI-010
--
-- NAMING NOTE (fixed before this migration was ever successfully applied
-- anywhere): originally named this table `contest_prizes`, which collides
-- with a pre-existing, differently-shaped `public.contest_prizes` table from
-- 20260405300000_platform_enhancements.sql (title/description/value_ngn/
-- currency/status/awarded_to, keyed off the legacy public.contests). A
-- `CREATE TABLE IF NOT EXISTS` against that name silently no-ops against the
-- old table instead of creating the new one, which only surfaced when a
-- full fresh `supabase db reset` reached the next statement (an index on a
-- column the old table doesn't have) and failed loudly. Renamed to
-- `voting_contest_prizes` to avoid the collision — verified via a real fresh
-- local replay, not just mocked unit tests, before this migration was ever
-- pushed as fixed.
--
-- 1. voting_contest_prizes — structured per-position prizes for a contest (CS-010).
--    Keys off public.connect_contests, NOT the legacy public.contests table —
--    same pattern established in 20270212000000_contest_templates_connect_bridge.sql,
--    because registrations/voting resolve contests via connect_contests, not
--    the legacy table.
--
-- 2. voting_round_results — the immutable, published leaderboard snapshot for
--    a voting_rounds row (AD-011/VI-010). Written exactly once by the new
--    publish-results endpoint; there is deliberately no admin UPDATE/DELETE
--    policy — even an admin can only read/insert, matching the "no unlock
--    endpoint" scope decision. If a correction is ever needed, that is a
--    future decision, not built here.
--
-- voting_round_results.contest_id: voting_rounds.contest_id is
-- `uuid NOT NULL REFERENCES public.contests(id)` (the LEGACY table — see
-- 20260602100000_universal_voting_engine.sql:383-411), so this column matches
-- that FK exactly, not connect_contests. In practice the two tables share the
-- same row id for any contest reachable here (see
-- 20261223000000_connect_contests_bridge.sql's forward sync trigger and
-- 20270129000000_mirror_connect_contests_to_legacy.sql's reverse mirror, both
-- of which preserve `id` across the two tables) — the publish-results route
-- relies on that identity to look up voting_contest_prizes by connect_contest_id
-- using round.contest_id directly, without a separate resolver.
--
-- Additive only: no DROP, no renames, no type narrowing.

CREATE TABLE IF NOT EXISTS public.voting_contest_prizes (
  id                  UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  connect_contest_id  UUID NOT NULL REFERENCES public.connect_contests(id) ON DELETE CASCADE,
  position            INT NOT NULL CHECK (position > 0),
  prize_description   TEXT NOT NULL,
  prize_value_kobo    BIGINT CHECK (prize_value_kobo IS NULL OR prize_value_kobo >= 0),
  created_by          UUID REFERENCES public.user_profiles(id),
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (connect_contest_id, position)
);

CREATE INDEX IF NOT EXISTS idx_voting_contest_prizes_connect_contest_id
  ON public.voting_contest_prizes (connect_contest_id);

CREATE TABLE IF NOT EXISTS public.voting_round_results (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  round_id                UUID NOT NULL REFERENCES public.voting_rounds(id) ON DELETE CASCADE,
  contest_id              UUID NOT NULL REFERENCES public.contests(id),
  contestant_id           UUID NOT NULL,
  rank                    INT NOT NULL,
  total_confirmed_votes   INT NOT NULL,
  paid_votes              INT NOT NULL,
  prize_id                UUID REFERENCES public.voting_contest_prizes(id),
  published_at            TIMESTAMPTZ NOT NULL DEFAULT now(),
  published_by            UUID REFERENCES public.user_profiles(id),
  UNIQUE (round_id, contestant_id)
);

CREATE INDEX IF NOT EXISTS idx_voting_round_results_round_id
  ON public.voting_round_results (round_id);
CREATE INDEX IF NOT EXISTS idx_voting_round_results_contest_id
  ON public.voting_round_results (contest_id);

-- ---------------------------------------------------------------------------
-- publish_voting_round_results — atomic insert-results + flip-status RPC.
--
-- The publish-results route needs "insert N result rows" and "flip
-- voting_rounds.status to 'results_published'" to succeed or fail together —
-- a partial write (rows inserted, status still 'active') would let a retry
-- re-run bridgedRecomputeRanksForResults and attempt a second insert, which
-- the UNIQUE(round_id, contestant_id) constraint would then reject row-by-row
-- with a confusing 500 instead of the clean "already published" 409 the route
-- wants to return. Wrapping both writes in one plpgsql function gives that
-- atomicity without a distributed transaction across two Supabase calls.
--
-- Guards against the already-published race itself (status re-checked inside
-- the function, not just in the route before calling it) and refuses to
-- flip status if zero result rows were provided, since that would silently
-- "publish" an empty leaderboard.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.publish_voting_round_results(
  p_round_id    UUID,
  p_results     JSONB, -- array of {contestant_id, rank, total_confirmed_votes, paid_votes, prize_id}
  p_published_by UUID
)
RETURNS SETOF public.voting_round_results
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_status     TEXT;
  v_contest_id UUID;
  v_count      INT;
BEGIN
  SELECT status, contest_id INTO v_status, v_contest_id
    FROM public.voting_rounds
   WHERE id = p_round_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'voting_round_not_found' USING ERRCODE = 'P0002';
  END IF;

  IF v_status = 'results_published' THEN
    RAISE EXCEPTION 'voting_round_already_published' USING ERRCODE = '23505';
  END IF;

  SELECT jsonb_array_length(p_results) INTO v_count;
  IF v_count IS NULL OR v_count = 0 THEN
    RAISE EXCEPTION 'voting_round_results_empty' USING ERRCODE = '22023';
  END IF;

  INSERT INTO public.voting_round_results
    (round_id, contest_id, contestant_id, rank, total_confirmed_votes, paid_votes, prize_id, published_by)
  SELECT
    p_round_id,
    v_contest_id,
    (r->>'contestant_id')::UUID,
    (r->>'rank')::INT,
    (r->>'total_confirmed_votes')::INT,
    (r->>'paid_votes')::INT,
    NULLIF(r->>'prize_id', '')::UUID,
    p_published_by
  FROM jsonb_array_elements(p_results) AS r;

  UPDATE public.voting_rounds
     SET status = 'results_published',
         updated_at = now()
   WHERE id = p_round_id;

  RETURN QUERY SELECT * FROM public.voting_round_results WHERE round_id = p_round_id;
END;
$$;

COMMENT ON FUNCTION public.publish_voting_round_results(UUID, JSONB, UUID) IS
  'Atomically inserts voting_round_results rows and flips voting_rounds.status '
  'to results_published. Raises voting_round_already_published (23505) if the '
  'round is already locked, so a retry maps cleanly to a 409 instead of a '
  'partial write.';

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
ALTER TABLE public.voting_contest_prizes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.voting_round_results ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_voting_contest_prizes" ON public.voting_contest_prizes;
CREATE POLICY "admin_manage_voting_contest_prizes"
ON public.voting_contest_prizes FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "public_read_voting_contest_prizes" ON public.voting_contest_prizes;
CREATE POLICY "public_read_voting_contest_prizes"
ON public.voting_contest_prizes FOR SELECT TO public
USING (true);

-- voting_round_results: admin (and service-role, which bypasses RLS entirely
-- via the RPC's SECURITY DEFINER anyway) may INSERT/SELECT only — no
-- UPDATE/DELETE policy for anyone, matching voting_rounds_public_read's
-- posture of only exposing already-locked state publicly.
DROP POLICY IF EXISTS "admin_insert_voting_round_results" ON public.voting_round_results;
CREATE POLICY "admin_insert_voting_round_results"
ON public.voting_round_results FOR INSERT TO authenticated
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "admin_read_voting_round_results" ON public.voting_round_results;
CREATE POLICY "admin_read_voting_round_results"
ON public.voting_round_results FOR SELECT TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "public_read_voting_round_results" ON public.voting_round_results;
CREATE POLICY "public_read_voting_round_results"
ON public.voting_round_results FOR SELECT TO public
USING (true);
