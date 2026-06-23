-- Spotlight Reality TV Operations Modules

CREATE TABLE IF NOT EXISTS public.reality_tv_medical_clearances (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id UUID REFERENCES public.contestants(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.reality_tv_applications(id) ON DELETE SET NULL,
  season_id UUID REFERENCES public.reality_tv_seasons(id) ON DELETE SET NULL,
  medical_fee_status TEXT NOT NULL DEFAULT 'pending',
  medical_form_submitted BOOLEAN NOT NULL DEFAULT false,
  health_declaration TEXT NOT NULL DEFAULT '',
  emergency_contact TEXT NOT NULL DEFAULT '',
  allergies TEXT NOT NULL DEFAULT '',
  existing_conditions TEXT NOT NULL DEFAULT '',
  medication_notes TEXT NOT NULL DEFAULT '',
  fitness_status TEXT NOT NULL DEFAULT 'unknown',
  medical_report_url TEXT NOT NULL DEFAULT '',
  clearance_status TEXT NOT NULL DEFAULT 'not_started',
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approval_date TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reality_tv_housemates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contestant_id UUID NOT NULL REFERENCES public.contestants(id) ON DELETE CASCADE,
  season_id UUID REFERENCES public.reality_tv_seasons(id) ON DELETE SET NULL,
  room_assignment TEXT NOT NULL DEFAULT '',
  bed_number TEXT NOT NULL DEFAULT '',
  check_in_date DATE,
  check_out_date DATE,
  welfare_status TEXT NOT NULL DEFAULT 'stable',
  feeding_preference TEXT NOT NULL DEFAULT '',
  medical_notes TEXT NOT NULL DEFAULT '',
  daily_attendance TEXT NOT NULL DEFAULT 'pending',
  task_participation_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  house_conduct_score NUMERIC(6,2) NOT NULL DEFAULT 0,
  incident_reports TEXT NOT NULL DEFAULT '',
  visitor_log TEXT NOT NULL DEFAULT '',
  exit_permission BOOLEAN NOT NULL DEFAULT false,
  confiscated_items TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'expected',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(contestant_id, season_id)
);

CREATE TABLE IF NOT EXISTS public.reality_tv_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES public.reality_tv_seasons(id) ON DELETE SET NULL,
  phase_id UUID REFERENCES public.reality_tv_phases(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.reality_tv_categories(id) ON DELETE SET NULL,
  task_type TEXT NOT NULL DEFAULT 'performance_task',
  task_title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  instructions TEXT NOT NULL DEFAULT '',
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  assigned_contestant_ids UUID[] NOT NULL DEFAULT '{}',
  required_uploads TEXT NOT NULL DEFAULT '',
  judge_scoring_enabled BOOLEAN NOT NULL DEFAULT true,
  public_voting_enabled BOOLEAN NOT NULL DEFAULT false,
  sponsor_attached TEXT NOT NULL DEFAULT '',
  reward TEXT NOT NULL DEFAULT '',
  penalty TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.reality_tv_eviction_rounds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  season_id UUID REFERENCES public.reality_tv_seasons(id) ON DELETE SET NULL,
  phase_id UUID REFERENCES public.reality_tv_phases(id) ON DELETE SET NULL,
  voting_round_id UUID REFERENCES public.reality_tv_voting_rounds(id) ON DELETE SET NULL,
  round_name TEXT NOT NULL,
  week_label TEXT NOT NULL DEFAULT '',
  contestant_ids_at_risk UUID[] NOT NULL DEFAULT '{}',
  eviction_rule TEXT NOT NULL DEFAULT 'lowest_votes',
  number_to_evict INTEGER NOT NULL DEFAULT 1,
  save_options TEXT[] NOT NULL DEFAULT '{}',
  announcement_date TIMESTAMPTZ,
  result_status TEXT NOT NULL DEFAULT 'pending',
  published BOOLEAN NOT NULL DEFAULT false,
  override_reason TEXT NOT NULL DEFAULT '',
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_rtv_medical_clearances_contestant ON public.reality_tv_medical_clearances(contestant_id);
CREATE INDEX IF NOT EXISTS idx_rtv_housemates_season ON public.reality_tv_housemates(season_id);
CREATE INDEX IF NOT EXISTS idx_rtv_tasks_season ON public.reality_tv_tasks(season_id);
CREATE INDEX IF NOT EXISTS idx_rtv_evictions_season ON public.reality_tv_eviction_rounds(season_id);

ALTER TABLE public.reality_tv_medical_clearances ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_tv_housemates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_tv_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reality_tv_eviction_rounds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_rtv_medical_clearances" ON public.reality_tv_medical_clearances;
CREATE POLICY "admin_manage_rtv_medical_clearances" ON public.reality_tv_medical_clearances
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_rtv_housemates" ON public.reality_tv_housemates;
CREATE POLICY "admin_manage_rtv_housemates" ON public.reality_tv_housemates
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_rtv_tasks" ON public.reality_tv_tasks;
CREATE POLICY "admin_manage_rtv_tasks" ON public.reality_tv_tasks
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_rtv_eviction_rounds" ON public.reality_tv_eviction_rounds;
CREATE POLICY "admin_manage_rtv_eviction_rounds" ON public.reality_tv_eviction_rounds
FOR ALL TO authenticated USING (public.is_admin()) WITH CHECK (public.is_admin());

DROP TRIGGER IF EXISTS trg_rtv_medical_set_updated_at ON public.reality_tv_medical_clearances;
CREATE TRIGGER trg_rtv_medical_set_updated_at
BEFORE UPDATE ON public.reality_tv_medical_clearances
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rtv_housemates_set_updated_at ON public.reality_tv_housemates;
CREATE TRIGGER trg_rtv_housemates_set_updated_at
BEFORE UPDATE ON public.reality_tv_housemates
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rtv_tasks_set_updated_at ON public.reality_tv_tasks;
CREATE TRIGGER trg_rtv_tasks_set_updated_at
BEFORE UPDATE ON public.reality_tv_tasks
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();

DROP TRIGGER IF EXISTS trg_rtv_evictions_set_updated_at ON public.reality_tv_eviction_rounds;
CREATE TRIGGER trg_rtv_evictions_set_updated_at
BEFORE UPDATE ON public.reality_tv_eviction_rounds
FOR EACH ROW EXECUTE FUNCTION public.reality_tv_set_updated_at();
