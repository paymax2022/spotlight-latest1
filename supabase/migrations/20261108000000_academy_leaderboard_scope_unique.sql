-- Make (scope, scope_ref) uniquely identify a leaderboard so the class board can
-- be looked up / created idempotently (GetOrCreateClassLeaderboard). Partial index
-- (scope_ref NOT NULL) so scoped boards — e.g. one per class — are unique while
-- global boards (scope_ref NULL) are unaffected.
--
-- Additive-only: a new unique index. Safe now (0 leaderboard rows).
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_leaderboards_scope_ref
  ON public.academy_leaderboards (scope, scope_ref)
  WHERE scope_ref IS NOT NULL;
