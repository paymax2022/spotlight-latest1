-- Widen academy_moderation_reports.state to support the triage/escalate transitions
-- added to the moderation admin surface (POST /moderation/reports/:id/{triage,escalate}).
--
-- Original inline CHECK (migration 20260815001200) allowed only
-- ('pending','actioned','dismissed'). This is a NON-DESTRUCTIVE widening: the new
-- constraint is strictly more permissive (a superset), so no existing row can be
-- invalidated. Idempotent and safe to re-run.
DO $$
BEGIN
  IF to_regclass('public.academy_moderation_reports') IS NOT NULL THEN
    ALTER TABLE public.academy_moderation_reports
      DROP CONSTRAINT IF EXISTS academy_moderation_reports_state_check;
    ALTER TABLE public.academy_moderation_reports
      ADD CONSTRAINT academy_moderation_reports_state_check
      CHECK (state IN ('pending','triaged','escalated','actioned','dismissed'));
  END IF;
END $$;
