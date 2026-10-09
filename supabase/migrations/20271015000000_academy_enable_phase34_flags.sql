-- Enable the remaining Spotlight Academy Phase 2/3/4 runtime feature flags.
--
-- 20261030000000_academy_enable_flags.sql deliberately kept academy.edupay,
-- academy.credentials, academy.live, academy.schools and academy.tutor disabled:
-- enabling academy.schools alongside academy.fees panicked at boot because the
-- two packages registered /api/finance/academy/schools/:id vs /schools/:schoolId
-- (Gin rejects conflicting wildcard names for one path segment). That conflict
-- is reconciled — both packages now register the same :schoolId wildcard, proven
-- by academy/routecheck (full flag-matrix + mount assertions) and
-- academy/schools/route_conflict_test.go — and each flag-gated surface has been
-- exercised end-to-end on a live stack (schools onboard→licence→bulk-enrol,
-- edupay school→fee-schedule→link→pay, trade assessment→credential issue,
-- live schedule→start→join→end, tutor onboard→verify→grade→payout).
--
-- Idempotent: only flips the boolean; admin-toggled rows are authoritative
-- thereafter (the resolver reads the store first, env only when no row exists).
UPDATE public.academy_feature_flags
SET enabled = true,
    updated_at = now()
WHERE key IN (
  'academy.edupay',
  'academy.credentials',
  'academy.live',
  'academy.schools',
  'academy.tutor'
)
AND enabled IS DISTINCT FROM true;
