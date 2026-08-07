-- 20260924000000_academy_feature_flags.sql
-- Spotlight Academy — runtime feature-flag store. Additive-only (no DROP / rename /
-- type-narrow). Replaces the documented NO-OP placeholder behind the platform
-- super-admin flags surface (SU-10, /api/academy/admin/platform/flags) with a REAL
-- persisted store that the composition root (RegisterAcademy) consults at startup.
--
-- FAIL-CLOSED: a flag with NO row here falls back to the compile-time default passed to
-- RegisterAcademy (env FEATURE_ACADEMY_*). The store never silently enables — every seed
-- row below carries enabled=false, matching each env default (config.go getEnvBool(..,false)).
--
-- Every admin toggle rides RBAC (platform_edtech_admin) and appends an immutable
-- academy_commerce_audit row (the same append-only trail SU-11 reads). No money path;
-- no ledger entry; nothing in this table moves value.
--
-- RLS-locked (deny-all for anon/authenticated; the backend reaches it as owner and
-- bypasses RLS), guarded with to_regclass like the fees-integration lockdown.
BEGIN;

CREATE TABLE IF NOT EXISTS public.academy_feature_flags (
  key         text PRIMARY KEY,
  enabled     boolean NOT NULL DEFAULT false,
  description text,
  updated_by  uuid,                                   -- auth.users(id); nullable (seed/system writes)
  updated_at  timestamptz NOT NULL DEFAULT now(),
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- Seed the known phase flags. enabled=false mirrors the current compile-time defaults
-- (config.go getEnvBool("FEATURE_ACADEMY_*", false)); ON CONFLICT DO NOTHING keeps the
-- migration idempotent and NEVER overwrites an operator's later runtime toggle.
INSERT INTO public.academy_feature_flags (key, enabled, description) VALUES
  ('academy.exam',        false, 'Academy exam arenas + CBT simulator (Phase 1 crown)'),
  ('academy.spine',       false, 'Academy Phase 2: progression/adaptive paths + content/CMS + parent layer'),
  ('academy.edupay',      false, 'Academy Phase 2: EduPay (fees, pots, disbursement, scholarships)'),
  ('academy.credentials', false, 'Academy Phase 3: trade tracks + credentials + earning bridge'),
  ('academy.live',        false, 'Academy Phase 3: live classes + community + moderation'),
  ('academy.schools',     false, 'Academy Phase 4: B2B2C institutions + licences + enrolment'),
  ('academy.tutor',       false, 'Academy Phase 4: tutor marketplace + payouts'),
  ('academy.fees',        false, 'Academy EdTech Fees: invoices, vault, promotion, competition, scholarship, trust-score, compliance export')
ON CONFLICT (key) DO NOTHING;

-- Backend-only RLS lockdown (deny-all for anon/authenticated; owner/service_role bypass).
-- Guarded with to_regclass + pg_roles like the T0.2 / fees-integration lockdown.
DO $rls$
BEGIN
  IF to_regclass('public.academy_feature_flags') IS NOT NULL THEN
    EXECUTE 'ALTER TABLE public.academy_feature_flags ENABLE ROW LEVEL SECURITY';
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
      EXECUTE 'REVOKE ALL ON public.academy_feature_flags FROM anon';
    END IF;
    IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
      EXECUTE 'REVOKE ALL ON public.academy_feature_flags FROM authenticated';
    END IF;
  END IF;
END $rls$;

COMMIT;
