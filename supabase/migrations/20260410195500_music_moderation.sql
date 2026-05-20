-- ============================================================
-- One-Beat, One-Verse Moderation Audit Schema
-- ============================================================

CREATE TABLE IF NOT EXISTS public.moderation_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  competition_id UUID NOT NULL REFERENCES public.contests(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  action TEXT NOT NULL DEFAULT '',
  previous_status TEXT NOT NULL DEFAULT '',
  new_status TEXT NOT NULL DEFAULT '',
  reason TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  flags_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_entry_created
  ON public.moderation_logs(entry_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_competition_created
  ON public.moderation_logs(competition_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_moderation_logs_actor_created
  ON public.moderation_logs(actor_id, created_at DESC);

ALTER TABLE public.moderation_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "admin_read_moderation_logs" ON public.moderation_logs;
CREATE POLICY "admin_read_moderation_logs"
ON public.moderation_logs FOR SELECT TO authenticated
USING (public.is_admin());

DROP POLICY IF EXISTS "admin_insert_moderation_logs" ON public.moderation_logs;
CREATE POLICY "admin_insert_moderation_logs"
ON public.moderation_logs FOR INSERT TO authenticated
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_moderation_logs" ON public.moderation_logs;
CREATE POLICY "admin_manage_moderation_logs"
ON public.moderation_logs FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
