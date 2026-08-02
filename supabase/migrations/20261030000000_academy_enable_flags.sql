-- Enable the Spotlight Academy runtime feature flags.
--
-- The Go backend resolves each academy sub-feature flag from academy_feature_flags
-- (DB) and falls back to the FEATURE_ACADEMY_*_ENABLED env only when the row is
-- absent (internal/academy/platform/feature_flags.go). The initial seed inserted
-- every flag disabled, so — despite FEATURE_ACADEMY_ENABLED/FEES being set in the
-- env — exam, spine (curriculum progression/content/parent), live, tutor, schools,
-- edupay and credentials never mounted, and even fees was DB-disabled. That left
-- the whole /api/finance/academy/* surface dark for the mobile app.
--
-- Turn the sub-features ON so the member routes mount and the (already-seeded)
-- curriculum + gamification + rewards data is served live. Idempotent: only flips
-- the boolean, leaves description/timestamps and any admin-set rows intact.
--
-- SCOPED to the conflict-free core (exam, spine, fees). Enabling academy.schools
-- alongside academy.fees currently panics at boot: fees/school registers
-- /api/finance/academy/schools/:schoolId while the schools feature registers
-- /schools/:id — Gin rejects the conflicting wildcard name. academy.schools,
-- .tutor, .live, .edupay and .credentials stay off until that route conflict is
-- reconciled (tracked for the schools/tutor verticals).
UPDATE public.academy_feature_flags
SET enabled = true,
    updated_at = now()
WHERE key IN (
  'academy.exam',
  'academy.spine',
  'academy.fees'
)
AND enabled IS DISTINCT FROM true;

-- Keep the not-yet-reconciled Phase 3/4 sub-features disabled (idempotent).
UPDATE public.academy_feature_flags
SET enabled = false,
    updated_at = now()
WHERE key IN (
  'academy.edupay',
  'academy.credentials',
  'academy.live',
  'academy.schools',
  'academy.tutor'
)
AND enabled IS DISTINCT FROM false;
