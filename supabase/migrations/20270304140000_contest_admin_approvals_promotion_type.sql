-- Contest Promotion Phase 1 (5/6) — allow action_type = 'contest_promotion'
-- on the EXISTING contest_admin_approvals maker-checker table
-- (20270214000000_contest_admin_approvals.sql), which today allows only
-- 'vote_reversal' | 'vote_adjustment' | 'results_publish'.
--
-- A CHECK constraint cannot be widened with ALTER TABLE ... ADD/DROP CHECK
-- IF NOT EXISTS in place — Postgres has no ALTER CHECK, so widening it means
-- dropping the old constraint and adding a new one with the same name and a
-- superset of allowed values. This is additive in effect (every previously
-- valid value — vote_reversal, vote_adjustment, results_publish — remains
-- valid; only a new value is added) even though it is a DROP+ADD CONSTRAINT
-- pair, not a DROP TABLE/COLUMN or narrowing. No existing row's action_type
-- can violate the new constraint, since it is strictly wider than the old one.
--
-- Payload shape for the new type (validated at the API layer, matching the
-- existing per-type JSONB convention documented in the original migration):
--   contest_promotion: { childContestId, parentContestId, topN }
--   (the resulting contest_promotions rows, one per contestant, are the
--    durable record of WHICH contestants; this approvals row is the
--    maker-checker gate for the REQUEST as a whole.)
--
-- Additive only otherwise: no DROP TABLE/COLUMN, no renames, no narrowing —
-- vote_reversal/vote_adjustment/results_publish logic and existing rows are
-- untouched.

ALTER TABLE public.contest_admin_approvals
  DROP CONSTRAINT IF EXISTS contest_admin_approvals_action_type_check;

ALTER TABLE public.contest_admin_approvals
  ADD CONSTRAINT contest_admin_approvals_action_type_check
  CHECK (action_type IN ('vote_reversal', 'vote_adjustment', 'results_publish', 'contest_promotion'));
