-- Spotlight Reality TV Admin Operations Expansion

CREATE TABLE IF NOT EXISTS public.reality_tv_admin_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  admin_name TEXT,
  role TEXT,
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reality_tv_seasons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_title TEXT NOT NULL,
  season_number INTEGER NOT NULL,
  season_code TEXT UNIQUE NOT NULL,
  theme_tagline TEXT NOT NULL DEFAULT '',
  short_description TEXT NOT NULL DEFAULT '',
  full_description TEXT NOT NULL DEFAULT '',
  start_date DATE,
  end_date DATE,
  application_opening_date DATE,
  application_closing_date DATE,
  bootcamp_start_date DATE,
  bootcamp_end_date DATE,
  finale_date DATE,
  season_location TEXT NOT NULL DEFAULT '',
  eligible_states TEXT[] NOT NULL DEFAULT '{}',
  age_eligibility TEXT NOT NULL DEFAULT '',
  application_fee NUMERIC(12,2),
  medical_fee NUMERIC(12,2),
  voting_enabled BOOLEAN NOT NULL DEFAULT true,
  referral_enabled BOOLEAN NOT NULL DEFAULT true,
  badge_system_enabled BOOLEAN NOT NULL DEFAULT true,
  public_leaderboard_enabled BOOLEAN NOT NULL DEFAULT true,
  eviction_enabled BOOLEAN NOT NULL DEFAULT true,
  sponsor_slots_enabled BOOLEAN NOT NULL DEFAULT true,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reality_tv_phases (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID NOT NULL REFERENCES public.reality_tv_seasons(id) ON DELETE CASCADE,
  phase_name TEXT NOT NULL,
  phase_code TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_date DATE,
  end_date DATE,
  eligibility_requirement TEXT NOT NULL DEFAULT '',
  required_contestant_status TEXT NOT NULL DEFAULT '',
  voting_required BOOLEAN NOT NULL DEFAULT false,
  payment_required BOOLEAN NOT NULL DEFAULT false,
  admin_approval_required BOOLEAN NOT NULL DEFAULT true,
  public_visibility BOOLEAN NOT NULL DEFAULT true,
  phase_rules TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(season_id, phase_code)
);

CREATE TABLE IF NOT EXISTS public.reality_tv_categories (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES public.reality_tv_seasons(id) ON DELETE CASCADE,
  category_name TEXT NOT NULL,
  category_code TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  eligibility_criteria TEXT NOT NULL DEFAULT '',
  required_audition_video BOOLEAN NOT NULL DEFAULT true,
  required_portfolio BOOLEAN NOT NULL DEFAULT false,
  voting_enabled BOOLEAN NOT NULL DEFAULT true,
  judge_scoring_enabled BOOLEAN NOT NULL DEFAULT true,
  max_contestants INTEGER,
  min_contestants INTEGER,
  display_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(season_id, category_code)
);

CREATE TABLE IF NOT EXISTS public.reality_tv_voting_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES public.reality_tv_seasons(id) ON DELETE SET NULL,
  phase_id UUID REFERENCES public.reality_tv_phases(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.reality_tv_categories(id) ON DELETE SET NULL,
  round_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  voting_type TEXT NOT NULL DEFAULT 'paid_and_free',
  vote_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  minimum_vote_qty INTEGER NOT NULL DEFAULT 1,
  maximum_vote_qty INTEGER NOT NULL DEFAULT 500,
  daily_free_vote_limit INTEGER NOT NULL DEFAULT 1,
  allow_multiple_votes BOOLEAN NOT NULL DEFAULT true,
  require_login BOOLEAN NOT NULL DEFAULT true,
  leaderboard_visibility TEXT NOT NULL DEFAULT 'realtime',
  leaderboard_delay_minutes INTEGER NOT NULL DEFAULT 0,
  fraud_detection_enabled BOOLEAN NOT NULL DEFAULT true,
  badge_multiplier_enabled BOOLEAN NOT NULL DEFAULT false,
  eviction_rule TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reality_tv_support_tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  ticket_number TEXT UNIQUE NOT NULL,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  user_type TEXT NOT NULL DEFAULT 'contestant',
  category TEXT NOT NULL DEFAULT 'general_complaint',
  subject TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  priority TEXT NOT NULL DEFAULT 'medium',
  status TEXT NOT NULL DEFAULT 'open',
  assigned_admin_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  resolution TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reality_tv_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  show_name TEXT NOT NULL DEFAULT 'Spotlight Reality TV Show',
  contact_email TEXT NOT NULL DEFAULT '',
  contact_phone TEXT NOT NULL DEFAULT '',
  default_currency TEXT NOT NULL DEFAULT 'NGN',
  application_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  registration_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  medical_fee NUMERIC(12,2) NOT NULL DEFAULT 0,
  vote_price NUMERIC(12,2) NOT NULL DEFAULT 0,
  minimum_vote_quantity INTEGER NOT NULL DEFAULT 1,
  daily_vote_limit INTEGER NOT NULL DEFAULT 1,
  leaderboard_visibility TEXT NOT NULL DEFAULT 'realtime',
  fraud_velocity_threshold INTEGER NOT NULL DEFAULT 100,
  terms_and_conditions TEXT NOT NULL DEFAULT '',
  refund_policy TEXT NOT NULL DEFAULT '',
  disqualification_policy TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rtv_seasons_status ON public.reality_tv_seasons(status);
CREATE INDEX IF NOT EXISTS idx_rtv_phases_season ON public.reality_tv_phases(season_id);
CREATE INDEX IF NOT EXISTS idx_rtv_categories_season ON public.reality_tv_categories(season_id);
CREATE INDEX IF NOT EXISTS idx_rtv_voting_rounds_season ON public.reality_tv_voting_rounds(season_id);
CREATE INDEX IF NOT EXISTS idx_rtv_support_tickets_status ON public.reality_tv_support_tickets(status);
CREATE INDEX IF NOT EXISTS idx_rtv_admin_audit_logs_created_at ON public.reality_tv_admin_audit_logs(created_at DESC);

ALTER TABLE public.reality_tv_admin_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_tv_seasons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_tv_phases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_tv_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_tv_voting_rounds ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_tv_support_tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_tv_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_rtv_admin_audit_logs" ON public.reality_tv_admin_audit_logs;
CREATE POLICY "admin_manage_rtv_admin_audit_logs" ON public.reality_tv_admin_audit_logs
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_rtv_seasons" ON public.reality_tv_seasons;
CREATE POLICY "admin_manage_rtv_seasons" ON public.reality_tv_seasons
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_rtv_phases" ON public.reality_tv_phases;
CREATE POLICY "admin_manage_rtv_phases" ON public.reality_tv_phases
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_rtv_categories" ON public.reality_tv_categories;
CREATE POLICY "admin_manage_rtv_categories" ON public.reality_tv_categories
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_rtv_voting_rounds" ON public.reality_tv_voting_rounds;
CREATE POLICY "admin_manage_rtv_voting_rounds" ON public.reality_tv_voting_rounds
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_rtv_support_tickets" ON public.reality_tv_support_tickets;
CREATE POLICY "admin_manage_rtv_support_tickets" ON public.reality_tv_support_tickets
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_rtv_settings" ON public.reality_tv_settings;
CREATE POLICY "admin_manage_rtv_settings" ON public.reality_tv_settings
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.reality_tv_set_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_rtv_seasons_set_updated_at ON public.reality_tv_seasons;
CREATE TRIGGER trg_rtv_seasons_set_updated_at
BEFORE UPDATE ON public.reality_tv_seasons
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rtv_phases_set_updated_at ON public.reality_tv_phases;
CREATE TRIGGER trg_rtv_phases_set_updated_at
BEFORE UPDATE ON public.reality_tv_phases
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rtv_categories_set_updated_at ON public.reality_tv_categories;
CREATE TRIGGER trg_rtv_categories_set_updated_at
BEFORE UPDATE ON public.reality_tv_categories
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rtv_voting_rounds_set_updated_at ON public.reality_tv_voting_rounds;
CREATE TRIGGER trg_rtv_voting_rounds_set_updated_at
BEFORE UPDATE ON public.reality_tv_voting_rounds
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rtv_support_tickets_set_updated_at ON public.reality_tv_support_tickets;
CREATE TRIGGER trg_rtv_support_tickets_set_updated_at
BEFORE UPDATE ON public.reality_tv_support_tickets
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rtv_settings_set_updated_at ON public.reality_tv_settings;
CREATE TRIGGER trg_rtv_settings_set_updated_at
BEFORE UPDATE ON public.reality_tv_settings
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();
