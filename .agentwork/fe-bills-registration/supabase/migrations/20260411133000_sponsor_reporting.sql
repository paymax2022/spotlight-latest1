-- ============================================================
-- Sponsor Placement and Reporting
-- Adds sponsor slot inventory and analytics event enhancements.
-- ============================================================

CREATE TABLE IF NOT EXISTS public.sponsor_placements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  competition_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  category_id UUID REFERENCES public.skill_categories(id) ON DELETE SET NULL,
  placement_key TEXT NOT NULL,
  sponsor_name TEXT NOT NULL DEFAULT '',
  campaign_name TEXT NOT NULL DEFAULT '',
  asset_url TEXT NOT NULL DEFAULT '',
  target_url TEXT NOT NULL DEFAULT '',
  tracking_code TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT true,
  budget_ngn INTEGER,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_sponsor_placements_competition
  ON public.sponsor_placements(competition_id, category_id, is_active);

CREATE INDEX IF NOT EXISTS idx_sponsor_placements_schedule
  ON public.sponsor_placements(starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_name TEXT NOT NULL,
  actor_user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  anonymous_id TEXT NOT NULL DEFAULT '',
  competition_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  category_id UUID REFERENCES public.skill_categories(id) ON DELETE SET NULL,
  entry_id UUID REFERENCES public.competition_entries(id) ON DELETE SET NULL,
  placement_id UUID REFERENCES public.sponsor_placements(id) ON DELETE SET NULL,
  source_page TEXT NOT NULL DEFAULT '',
  utm_source TEXT NOT NULL DEFAULT '',
  utm_medium TEXT NOT NULL DEFAULT '',
  utm_campaign TEXT NOT NULL DEFAULT '',
  country_code TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  device_type TEXT NOT NULL DEFAULT '',
  user_agent_hash TEXT NOT NULL DEFAULT '',
  ip_hash TEXT NOT NULL DEFAULT '',
  event_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_analytics_events_event_time
  ON public.analytics_events(event_name, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_competition_time
  ON public.analytics_events(competition_id, category_id, occurred_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_events_placement
  ON public.analytics_events(placement_id, occurred_at DESC)
  WHERE placement_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.update_sponsor_placements_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_sponsor_placements_updated_at ON public.sponsor_placements;
CREATE TRIGGER set_sponsor_placements_updated_at
  BEFORE UPDATE ON public.sponsor_placements
  FOR EACH ROW
  EXECUTE FUNCTION public.update_sponsor_placements_updated_at();

ALTER TABLE public.sponsor_placements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.analytics_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_active_sponsor_placements" ON public.sponsor_placements;
CREATE POLICY "public_read_active_sponsor_placements"
ON public.sponsor_placements FOR SELECT TO public
USING (
  is_active = true
  AND (starts_at IS NULL OR starts_at <= NOW())
  AND (ends_at IS NULL OR ends_at >= NOW())
);

DROP POLICY IF EXISTS "admin_manage_sponsor_placements" ON public.sponsor_placements;
CREATE POLICY "admin_manage_sponsor_placements"
ON public.sponsor_placements FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_insert_analytics_events" ON public.analytics_events;
CREATE POLICY "public_insert_analytics_events"
ON public.analytics_events FOR INSERT TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "admin_read_analytics_events" ON public.analytics_events;
CREATE POLICY "admin_read_analytics_events"
ON public.analytics_events FOR SELECT TO authenticated
USING (public.is_admin());
