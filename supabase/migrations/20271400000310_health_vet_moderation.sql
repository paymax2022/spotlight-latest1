-- Vet content & credential moderation queue (frontend-admin /admin/health/vet/moderation).
-- Items are raised by members reporting a listed vet (POST /api/finance/health/vet/vets/:id/report)
-- and worked by admins (health.vet.moderation). suspend_provider resolves the item
-- after suspending the capability through the providers state machine (HL-2).
--
-- ADDITIVE-ONLY. No DROP / RENAME / type narrowing.

BEGIN;

CREATE TABLE IF NOT EXISTS public.vet_moderation_items (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind                text NOT NULL CHECK (kind IN ('profile_claim','review_abuse','credential_mismatch',
                                                    'unlicensed_advice','image_violation','other')),
  subject_provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  summary             text NOT NULL CHECK (length(summary) BETWEEN 1 AND 1000),
  severity            text NOT NULL DEFAULT 'medium' CHECK (severity IN ('low','medium','high')),
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','investigating','resolved','ignored')),
  reporter_user_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  resolution          text NOT NULL DEFAULT '',
  resolution_note     text NOT NULL DEFAULT '',
  decided_by          uuid REFERENCES auth.users(id),
  idempotency_key     text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_vet_moderation_idem
  ON public.vet_moderation_items (reporter_user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_vet_moderation_status
  ON public.vet_moderation_items (status, created_at DESC);

ALTER TABLE public.vet_moderation_items ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS vet_moderation_admin_read ON public.vet_moderation_items;
CREATE POLICY vet_moderation_admin_read ON public.vet_moderation_items
  FOR SELECT TO authenticated USING (public.is_admin() OR reporter_user_id = auth.uid());
DROP POLICY IF EXISTS vet_moderation_service ON public.vet_moderation_items;
CREATE POLICY vet_moderation_service ON public.vet_moderation_items
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
