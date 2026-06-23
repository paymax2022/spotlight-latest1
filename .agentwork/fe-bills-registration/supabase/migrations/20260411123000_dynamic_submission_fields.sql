-- ============================================================
-- Dynamic Submission Fields
-- Adds category-aware entry fields and richer media support.
-- ============================================================

ALTER TABLE public.competition_entries
  ADD COLUMN IF NOT EXISTS category_id UUID REFERENCES public.skill_categories(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS submission_schema_version INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS visibility_state TEXT NOT NULL DEFAULT 'private',
  ADD COLUMN IF NOT EXISTS content_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_competition_entries_category
  ON public.competition_entries(category_id, status);

CREATE TABLE IF NOT EXISTS public.competition_entry_fields (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id UUID NOT NULL REFERENCES public.competition_entries(id) ON DELETE CASCADE,
  field_key TEXT NOT NULL,
  field_label TEXT NOT NULL DEFAULT '',
  field_type TEXT NOT NULL DEFAULT 'text',
  field_value_text TEXT NOT NULL DEFAULT '',
  field_value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_required BOOLEAN NOT NULL DEFAULT false,
  validation_errors JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_competition_entry_fields_unique
  ON public.competition_entry_fields(entry_id, field_key);

CREATE INDEX IF NOT EXISTS idx_competition_entry_fields_entry
  ON public.competition_entry_fields(entry_id, created_at ASC);

ALTER TABLE public.competition_entry_media
  ADD COLUMN IF NOT EXISTS metadata JSONB NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  ALTER TABLE public.competition_entry_media
    DROP CONSTRAINT IF EXISTS competition_entry_media_media_type_check;

  ALTER TABLE public.competition_entry_media
    ADD CONSTRAINT competition_entry_media_media_type_check
      CHECK (media_type IN ('audio', 'video', 'image', 'document', 'link', 'archive'));
EXCEPTION
  WHEN others THEN
    -- Keep migration additive and resilient if constraint state differs by environment.
    NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_competition_entry_fields_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_competition_entry_fields_updated_at ON public.competition_entry_fields;
CREATE TRIGGER set_competition_entry_fields_updated_at
  BEFORE UPDATE ON public.competition_entry_fields
  FOR EACH ROW
  EXECUTE FUNCTION public.update_competition_entry_fields_updated_at();

ALTER TABLE public.competition_entry_fields ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "users_read_own_competition_entry_fields" ON public.competition_entry_fields;
CREATE POLICY "users_read_own_competition_entry_fields"
ON public.competition_entry_fields FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.competition_entries e
    WHERE e.id = entry_id
      AND (e.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "users_manage_own_competition_entry_fields" ON public.competition_entry_fields;
CREATE POLICY "users_manage_own_competition_entry_fields"
ON public.competition_entry_fields FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1
    FROM public.competition_entries e
    WHERE e.id = entry_id
      AND (e.user_id = auth.uid() OR public.is_admin())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.competition_entries e
    WHERE e.id = entry_id
      AND (e.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "public_read_live_competition_entry_fields" ON public.competition_entry_fields;
CREATE POLICY "public_read_live_competition_entry_fields"
ON public.competition_entry_fields FOR SELECT TO public
USING (
  EXISTS (
    SELECT 1
    FROM public.competition_entries e
    WHERE e.id = entry_id
      AND e.status IN ('live_for_voting', 'finalist', 'winner')
  )
);
