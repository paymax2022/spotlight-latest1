-- ============================================================
-- Winners, Prizes, and Pipeline
-- Adds winner metadata, fulfillment records, and talent pipeline CRM layer.
-- ============================================================

ALTER TABLE public.winner_records
  ADD COLUMN IF NOT EXISTS winner_type TEXT NOT NULL DEFAULT 'overall',
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.skill_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS region_scope TEXT NOT NULL DEFAULT 'national',
  ADD COLUMN IF NOT EXISTS special_award_title TEXT NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS idx_winner_records_competition_type
  ON public.winner_records(competition_id, winner_type, created_at DESC);

CREATE TABLE IF NOT EXISTS public.prize_fulfillments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  winner_record_id UUID NOT NULL REFERENCES public.winner_records(id) ON DELETE CASCADE,
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  contestant_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  prize_name TEXT NOT NULL DEFAULT '',
  prize_type TEXT NOT NULL DEFAULT 'cash',
  value_amount_ngn INTEGER,
  status TEXT NOT NULL DEFAULT 'pending',
  payout_reference TEXT NOT NULL DEFAULT '',
  delivery_partner TEXT NOT NULL DEFAULT '',
  delivery_tracking_ref TEXT NOT NULL DEFAULT '',
  proof_url TEXT NOT NULL DEFAULT '',
  approved_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  fulfilled_at TIMESTAMPTZ,
  notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backward-compatibility for environments where prize_fulfillments already exists
-- with a reduced column set.
ALTER TABLE public.prize_fulfillments
  ADD COLUMN IF NOT EXISTS winner_record_id UUID,
  ADD COLUMN IF NOT EXISTS competition_id UUID,
  ADD COLUMN IF NOT EXISTS contestant_user_id UUID,
  ADD COLUMN IF NOT EXISTS prize_name TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS prize_type TEXT NOT NULL DEFAULT 'cash',
  ADD COLUMN IF NOT EXISTS value_amount_ngn INTEGER,
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'pending',
  ADD COLUMN IF NOT EXISTS payout_reference TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_partner TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS delivery_tracking_ref TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS proof_url TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS approved_by UUID,
  ADD COLUMN IF NOT EXISTS approved_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS fulfilled_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_prize_fulfillments_competition_status
  ON public.prize_fulfillments(competition_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS public.talent_pipeline_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  competition_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.skill_categories(id) ON DELETE SET NULL,
  source_entry_id UUID REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  source_winner_record_id UUID REFERENCES public.winner_records(id) ON DELETE SET NULL,
  stage TEXT NOT NULL DEFAULT 'identified',
  tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  assigned_admin_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  notes TEXT NOT NULL DEFAULT '',
  last_contacted_at TIMESTAMPTZ,
  next_action_at TIMESTAMPTZ,
  is_alumni BOOLEAN NOT NULL DEFAULT false,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backward-compatibility for environments where talent_pipeline_records already exists
-- with a reduced column set.
ALTER TABLE public.talent_pipeline_records
  ADD COLUMN IF NOT EXISTS user_id UUID,
  ADD COLUMN IF NOT EXISTS competition_id UUID,
  ADD COLUMN IF NOT EXISTS category_id UUID,
  ADD COLUMN IF NOT EXISTS source_entry_id UUID,
  ADD COLUMN IF NOT EXISTS source_winner_record_id UUID,
  ADD COLUMN IF NOT EXISTS stage TEXT NOT NULL DEFAULT 'identified',
  ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN IF NOT EXISTS assigned_admin_id UUID,
  ADD COLUMN IF NOT EXISTS notes TEXT NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS last_contacted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS next_action_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS is_alumni BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP;

CREATE INDEX IF NOT EXISTS idx_talent_pipeline_stage
  ON public.talent_pipeline_records(stage, next_action_at, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_talent_pipeline_user
  ON public.talent_pipeline_records(user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.update_winners_prizes_pipeline_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_prize_fulfillments_updated_at ON public.prize_fulfillments;
CREATE TRIGGER set_prize_fulfillments_updated_at
  BEFORE UPDATE ON public.prize_fulfillments
  FOR EACH ROW
  EXECUTE FUNCTION public.update_winners_prizes_pipeline_updated_at();

DROP TRIGGER IF EXISTS set_talent_pipeline_records_updated_at ON public.talent_pipeline_records;
CREATE TRIGGER set_talent_pipeline_records_updated_at
  BEFORE UPDATE ON public.talent_pipeline_records
  FOR EACH ROW
  EXECUTE FUNCTION public.update_winners_prizes_pipeline_updated_at();

ALTER TABLE public.prize_fulfillments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.talent_pipeline_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_manage_prize_fulfillments" ON public.prize_fulfillments;
CREATE POLICY "admin_manage_prize_fulfillments"
ON public.prize_fulfillments FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_read_own_prize_fulfillments" ON public.prize_fulfillments;
CREATE POLICY "users_read_own_prize_fulfillments"
ON public.prize_fulfillments FOR SELECT TO authenticated
USING (contestant_user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "admin_manage_talent_pipeline_records" ON public.talent_pipeline_records;
CREATE POLICY "admin_manage_talent_pipeline_records"
ON public.talent_pipeline_records FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_read_own_talent_pipeline_records" ON public.talent_pipeline_records;
CREATE POLICY "users_read_own_talent_pipeline_records"
ON public.talent_pipeline_records FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());
