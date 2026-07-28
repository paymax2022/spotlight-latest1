-- Paymax Connect — Phase 0 DB foundation (slice P0-A)
-- Ref: docs/prd/dating/{data-model.md, PHASE-0-PLAN.md §P0-A, compliance.md}
--
-- Safety/config backbone everything else depends on. Additive-only:
-- CREATE TABLE IF NOT EXISTS / CREATE INDEX IF NOT EXISTS / idempotent policy + seed guards.
-- No existing tables are modified. Reuses helpers from prior migrations:
--   public.is_admin()           (20260405* admin role setup)
--   public.handle_updated_at()  (generic updated_at trigger)
-- All FKs target auth.users(id) per the repo's canonical pattern.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. connect_config — backend-owned flags / weights / limits / rules
--    visibility = 'public'  → safe to expose to mobile via GET /connect/config
--    visibility = 'internal'→ admin/service only (e.g. matching weights, mod rules)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_config (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key         text NOT NULL UNIQUE,
  value       jsonb NOT NULL DEFAULT '{}'::jsonb,
  scope       text NOT NULL DEFAULT 'global',
  visibility  text NOT NULL DEFAULT 'internal' CHECK (visibility IN ('public','internal')),
  description text,
  updated_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_config_visibility ON public.connect_config (visibility);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. connect_audit_log — immutable Connect admin/sensitive-action audit
--    Corrections = new rows only. No UPDATE/DELETE policies are defined.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_audit_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role  text,
  action      text NOT NULL,
  entity_type text,
  entity_id   text,
  old_value   jsonb,
  new_value   jsonb,
  reason      text,
  ip_address  inet,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_audit_log_created  ON public.connect_audit_log (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_audit_log_entity   ON public.connect_audit_log (entity_type, entity_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. connect_cases — every safety report opens a case (mirrors public.disputes)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_cases (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  subject_id     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type           text NOT NULL
                   CHECK (type IN ('harassment','scam','impersonation','underage',
                                   'inappropriate_media','off_platform','safety','other')),
  source_ref     text,
  status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','investigating','resolved','closed')),
  resolution     text
                   CHECK (resolution IS NULL OR resolution IN
                          ('no_action','warned','restricted','suspended','banned','escalated')),
  severity       text NOT NULL DEFAULT 'normal'
                   CHECK (severity IN ('low','normal','high','critical')),
  assigned_admin uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  notes          text,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_connect_cases_status   ON public.connect_cases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_connect_cases_subject  ON public.connect_cases (subject_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. connect_underage_flags — suspected-minor queue from the 18+ age gate
--    Child-safety sensitive: NOT readable by authenticated users; admin/service only.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.connect_underage_flags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason      text NOT NULL,
  dob         date,
  status      text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','cleared','banned')),
  reviewed_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  reviewed_at timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);
CREATE INDEX IF NOT EXISTS idx_connect_underage_flags_status ON public.connect_underage_flags (status, created_at DESC);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. updated_at triggers (reuse generic public.handle_updated_at)
-- ─────────────────────────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_connect_config_updated ON public.connect_config;
CREATE TRIGGER trg_connect_config_updated
  BEFORE UPDATE ON public.connect_config
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

DROP TRIGGER IF EXISTS trg_connect_cases_updated ON public.connect_cases;
CREATE TRIGGER trg_connect_cases_updated
  BEFORE UPDATE ON public.connect_cases
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Row Level Security
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.connect_config          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_audit_log       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_cases           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_underage_flags  ENABLE ROW LEVEL SECURITY;

-- connect_config: authenticated reads PUBLIC rows only; admins read all; writes admin/service.
DROP POLICY IF EXISTS connect_config_select_public ON public.connect_config;
CREATE POLICY connect_config_select_public ON public.connect_config
  FOR SELECT TO authenticated
  USING (visibility = 'public' OR public.is_admin());

DROP POLICY IF EXISTS connect_config_admin_write ON public.connect_config;
CREATE POLICY connect_config_admin_write ON public.connect_config
  FOR ALL TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS connect_config_service ON public.connect_config;
CREATE POLICY connect_config_service ON public.connect_config
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- connect_audit_log: admins read; only service_role writes; immutable (no update/delete policies).
DROP POLICY IF EXISTS connect_audit_log_admin_read ON public.connect_audit_log;
CREATE POLICY connect_audit_log_admin_read ON public.connect_audit_log
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS connect_audit_log_service ON public.connect_audit_log;
CREATE POLICY connect_audit_log_service ON public.connect_audit_log
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- connect_cases: reporter sees own; admins see/manage all; authenticated may open a case for self.
DROP POLICY IF EXISTS connect_cases_select_own ON public.connect_cases;
CREATE POLICY connect_cases_select_own ON public.connect_cases
  FOR SELECT TO authenticated
  USING (reporter_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS connect_cases_insert_own ON public.connect_cases;
CREATE POLICY connect_cases_insert_own ON public.connect_cases
  FOR INSERT TO authenticated
  WITH CHECK (reporter_id = auth.uid());

DROP POLICY IF EXISTS connect_cases_admin_update ON public.connect_cases;
CREATE POLICY connect_cases_admin_update ON public.connect_cases
  FOR UPDATE TO authenticated
  USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS connect_cases_service ON public.connect_cases;
CREATE POLICY connect_cases_service ON public.connect_cases
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- connect_underage_flags: admin read only; service_role writes. No self-read (child-safety).
DROP POLICY IF EXISTS connect_underage_flags_admin_read ON public.connect_underage_flags;
CREATE POLICY connect_underage_flags_admin_read ON public.connect_underage_flags
  FOR SELECT TO authenticated USING (public.is_admin());

DROP POLICY IF EXISTS connect_underage_flags_service ON public.connect_underage_flags;
CREATE POLICY connect_underage_flags_service ON public.connect_underage_flags
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7. Seed baseline config (idempotent). Mobile reads only visibility='public'.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.connect_config (key, value, scope, visibility, description) VALUES
  ('feature.connect.enabled',            'true'::jsonb,                                   'global', 'public',
     'Master switch for the Connect module (mirrors backend FeatureConnectEnabled)'),
  ('discovery.daily_match_limit',        '20'::jsonb,                                     'global', 'public',
     'Curated daily matches surfaced per user'),
  ('discovery.daily_like_limit',         '50'::jsonb,                                     'global', 'public',
     'Anti-fatigue: max likes per day'),
  ('discovery.super_like_daily_limit',   '1'::jsonb,                                      'global', 'public',
     'Anti-fatigue: free super-likes per day'),
  ('chat.rate_limit_per_min',            '20'::jsonb,                                     'global', 'public',
     'Max messages per minute per conversation'),
  ('safety.location_default',            '"approximate"'::jsonb,                          'global', 'public',
     'Default location visibility until trust threshold + opt-in'),
  ('verification.required_level_for_chat','"l1"'::jsonb,                                  'global', 'public',
     'Minimum verification level required to open chat'),
  ('matching.weights',                   '{"distance":0.3,"intent":0.3,"activity":0.2,"verification":0.2}'::jsonb,
                                                                                          'global', 'internal',
     'Matchmaking scoring weights (backend-owned; never exposed to mobile)'),
  ('verification.retention_days',        '365'::jsonb,                                    'global', 'internal',
     'Retention window for verification evidence references before purge'),
  ('moderation.financial_solicitation_terms',
     '["gift card","crypto","bitcoin","wire transfer","western union","emergency fund","send money","cashapp"]'::jsonb,
                                                                                          'global', 'internal',
     'Trigger terms for financial-solicitation safety warnings (invariant 10)')
ON CONFLICT (key) DO NOTHING;

COMMIT;
