-- Paymax Connect — Phase 1 Slice A1: onboarding gate (consent + status)
-- Ref: docs/prd/dating/{product.md §7, BUILD-PLAN Phase 1 A}; mirrors the
-- doctor_legal_consents precedent. Additive-only.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 1. connect_consents — versioned Terms / Privacy / Community-Guidelines acceptance
CREATE TABLE IF NOT EXISTS public.connect_consents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_kind text NOT NULL
                 CHECK (consent_kind IN ('terms', 'privacy', 'community_guidelines')),
  version      text NOT NULL DEFAULT 'v1',
  accepted     boolean NOT NULL DEFAULT false,
  accepted_at  timestamptz,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, consent_kind, version)
);
CREATE INDEX IF NOT EXISTS idx_connect_consents_user ON public.connect_consents (user_id);

-- 2. connect_onboarding — per-user gate combining age, phone and consent steps
CREATE TABLE IF NOT EXISTS public.connect_onboarding (
  user_id           uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  age_verified      boolean NOT NULL DEFAULT false,
  phone_verified    boolean NOT NULL DEFAULT false,
  consents_accepted boolean NOT NULL DEFAULT false,
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'complete')),
  completed_at      timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);

-- 3. updated_at trigger (reuse generic helper)
DROP TRIGGER IF EXISTS trg_connect_onboarding_updated ON public.connect_onboarding;
CREATE TRIGGER trg_connect_onboarding_updated
  BEFORE UPDATE ON public.connect_onboarding
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- 4. RLS — users see/write their own; admins read all; service_role bypass.
ALTER TABLE public.connect_consents   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_onboarding ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS connect_consents_select_own ON public.connect_consents;
CREATE POLICY connect_consents_select_own ON public.connect_consents
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS connect_consents_insert_own ON public.connect_consents;
CREATE POLICY connect_consents_insert_own ON public.connect_consents
  FOR INSERT TO authenticated WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS connect_consents_service ON public.connect_consents;
CREATE POLICY connect_consents_service ON public.connect_consents
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS connect_onboarding_select_own ON public.connect_onboarding;
CREATE POLICY connect_onboarding_select_own ON public.connect_onboarding
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS connect_onboarding_service ON public.connect_onboarding;
CREATE POLICY connect_onboarding_service ON public.connect_onboarding
  TO service_role USING (TRUE) WITH CHECK (TRUE);

COMMIT;
