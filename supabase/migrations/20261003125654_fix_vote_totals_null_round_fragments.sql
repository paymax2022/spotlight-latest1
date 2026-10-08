-- E2E-X-027 / F-C2 — vote_totals fragment rows for NULL rounds.
--
-- vote_totals carries UNIQUE (contest_id, contestant_id, round_id), and
-- increment_vote_totals() upserts ON CONFLICT on that key. But SQL NULL never
-- equals NULL inside a unique constraint, so every round-less call (p_round_id
-- IS NULL — the common case; paid votes are never round-scoped at all) inserts
-- a brand-new row instead of incrementing the existing one. Local data showed
-- duplicate (contest, contestant) fragments with split counters — the
-- leaderboard under-read totals depending on which fragment a query hit.
--
-- Fix, additive-only:
--   1. Merge existing fragment groups into a single survivor row (counters
--      summed, last_vote_at = MAX, rank = MIN/best, total_confirmed_votes
--      recomputed with the same formula increment_vote_totals uses), then
--      delete the absorbed duplicates.
--   2. Add a UNIQUE NULLS NOT DISTINCT constraint ALONGSIDE the existing
--      plain-UNIQUE one (kept — the additive-only guard forbids removing
--      constraints, and the stricter key satisfies it anyway). Verified on
--      PostgreSQL 17: a plain column-list conflict target in
--      increment_vote_totals' ON CONFLICT (contest_id, contestant_id,
--      round_id) infers EVERY matching unique index as arbiter, and the
--      NULLS NOT DISTINCT index is the one that conflicts on NULL-round
--      rows — the function body is unchanged.
--   3. Recompute ranks for every contest that has totals (idempotent).
--
-- The other vote_totals writers — claim_free_vote() (20260730120000) and
-- credit_paid_vote_transaction() (20270211000000) — already upsert with
-- `round_id IS NOT DISTINCT FROM`/`IS NULL` under a shared advisory lock, so a
-- hard constraint only turns what was a silent fragment into a correct
-- conflict; their UPDATE-first path keeps working unchanged.
--
-- Constraint addition only — no column removals, no renames, no narrowing.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Merge fragment groups
-- ---------------------------------------------------------------------------
WITH agg AS (
  SELECT contest_id,
         contestant_id,
         round_id,                       -- NULL rounds group together in GROUP BY
         MIN(id::text)::uuid        AS keep_id,   -- no MIN(uuid); text sort is deterministic
         SUM(free_votes)            AS free_votes,
         SUM(paid_votes)            AS paid_votes,
         SUM(bonus_votes)           AS bonus_votes,
         SUM(admin_adjustment_votes) AS admin_adjustment_votes,
         SUM(reversed_votes)        AS reversed_votes,
         SUM(quarantined_votes)     AS quarantined_votes,
         MAX(last_vote_at)          AS last_vote_at,
         MIN(rank)                  AS rank
    FROM public.vote_totals
   GROUP BY contest_id, contestant_id, round_id
  HAVING COUNT(*) > 1
),
absorbed AS (
  UPDATE public.vote_totals vt
     SET free_votes             = agg.free_votes,
         paid_votes             = agg.paid_votes,
         bonus_votes            = agg.bonus_votes,
         admin_adjustment_votes = agg.admin_adjustment_votes,
         reversed_votes         = agg.reversed_votes,
         quarantined_votes      = agg.quarantined_votes,
         total_confirmed_votes  = GREATEST(0,
             agg.free_votes + agg.paid_votes + agg.bonus_votes
             + agg.admin_adjustment_votes - agg.reversed_votes),
         last_vote_at           = agg.last_vote_at,
         rank                   = agg.rank,
         updated_at             = now()
    FROM agg
   WHERE vt.id = agg.keep_id
  RETURNING vt.id
)
DELETE FROM public.vote_totals vt
 USING agg
WHERE vt.contest_id    = agg.contest_id
  AND vt.contestant_id = agg.contestant_id
  AND vt.round_id IS NOT DISTINCT FROM agg.round_id
  AND vt.id <> agg.keep_id;

-- ---------------------------------------------------------------------------
-- 2. NULL-normalized uniqueness
-- ---------------------------------------------------------------------------
ALTER TABLE public.vote_totals
  ADD CONSTRAINT vote_totals_contestant_round_nulls_nd_key
  UNIQUE NULLS NOT DISTINCT (contest_id, contestant_id, round_id);

COMMENT ON CONSTRAINT vote_totals_contestant_round_nulls_nd_key
  ON public.vote_totals IS
  'One totals row per (contest, contestant, round), NULL rounds included: '
  'NULLS NOT DISTINCT makes a NULL round_id a single key — without it, '
  'round-less increments fragment into duplicate rows because NULL never '
  'conflicts with NULL. Coexists with the original plain-UNIQUE constraint '
  '(vote_totals_contest_id_contestant_id_round_id_key), which stays satisfied '
  'by every row set this stricter key permits.';

-- ---------------------------------------------------------------------------
-- 3. Ranks are stale after merging — recompute (NULL round arg = all rounds)
-- ---------------------------------------------------------------------------
SELECT public.recompute_leaderboard_ranks(contest_id)
  FROM (SELECT DISTINCT contest_id FROM public.vote_totals) c;

COMMIT;
