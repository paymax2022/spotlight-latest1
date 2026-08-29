-- Contest stages — add a free-text promotion criteria field.
--
-- public.contest_stages (20260807000000_voting_contest_stages_eviction.sql)
-- already models eviction_percentage as the QUANTITATIVE cut for who does not
-- advance, but nothing captures the admin-facing explanation of what "advance"
-- means for a given stage (e.g. "Top 10 by votes go through to the final",
-- "Judges' scorecards decide, audience vote is a tiebreaker only"). That is
-- free text an admin writes when defining a stage, distinct from the numeric
-- eviction_percentage the automated eviction RPC (evict_bottom_percentage)
-- consumes. Additive-only: no DROP, no rename, no type narrowing.

BEGIN;

ALTER TABLE IF EXISTS public.contest_stages
  ADD COLUMN IF NOT EXISTS promotion_criteria text;

COMMENT ON COLUMN public.contest_stages.promotion_criteria IS
  'Admin-authored description of how contestants progress to the next stage (e.g. "top 10 by votes advance"). Free text; not enforced programmatically.';

COMMIT;
