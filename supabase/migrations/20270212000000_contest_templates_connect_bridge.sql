-- Contest Templates <-> Connect Contests Bridge
-- Migration: 20270212000000_contest_templates_connect_bridge.sql
--
-- contest_templates.contest_id (20260405700000_contest_image_templates.sql)
-- references the LEGACY public.contests table. Registrations resolve their
-- contest via registrations.contest_slug -> connect_contests.slug (see
-- promote_registration_to_contestant, 20260812010000_registration_contestant_seam.sql),
-- not public.contests, so there was no way to look up which template applies
-- to a real registration. This adds an additive, nullable bridge column so new
-- template rows can be linked to the contest that actually drives approvals.
--
-- Additive only: contest_id (legacy FK) is left fully intact — not dropped,
-- not renamed, not made NOT NULL-incompatible. New admin-created rows set
-- connect_contest_id and leave contest_id NULL; nothing reads contest_id
-- differently as a result.

ALTER TABLE public.contest_templates
  ADD COLUMN IF NOT EXISTS connect_contest_id UUID REFERENCES public.connect_contests(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_contest_templates_connect_contest_id
  ON public.contest_templates (connect_contest_id) WHERE connect_contest_id IS NOT NULL;

-- No RLS policy changes needed: the existing policies on contest_templates
-- (20260405700000_contest_image_templates.sql) are:
--   admin_manage_contest_templates: FOR ALL, gated on user_profiles.role = 'admin'
--     (no reference to contest_id/connect_contest_id in USING/WITH CHECK)
--   public_read_contest_templates: FOR SELECT, gated on status = 'active'
--     (no reference to contest_id/connect_contest_id either)
-- Both continue to work unchanged for rows where contest_id IS NULL and
-- connect_contest_id IS NOT NULL.
