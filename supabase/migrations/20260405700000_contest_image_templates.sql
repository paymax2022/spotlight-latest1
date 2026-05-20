-- Contest Image Template & Photo Positioning System
-- Migration: 20260405700000_contest_image_templates.sql

-- ─── Storage Bucket ───────────────────────────────────────────────────────────
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'contest-templates',
  'contest-templates',
  true,
  52428800, -- 50MB
  ARRAY['image/svg+xml', 'image/png', 'image/jpeg', 'image/jpg', 'image/webp']
)
ON CONFLICT (id) DO NOTHING;

-- Storage RLS
DROP POLICY IF EXISTS "admin_upload_contest_templates" ON storage.objects;
CREATE POLICY "admin_upload_contest_templates"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'contest-templates'
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

DROP POLICY IF EXISTS "admin_update_contest_templates" ON storage.objects;
CREATE POLICY "admin_update_contest_templates"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'contest-templates'
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

DROP POLICY IF EXISTS "admin_delete_contest_templates" ON storage.objects;
CREATE POLICY "admin_delete_contest_templates"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'contest-templates'
  AND EXISTS (
    SELECT 1 FROM public.user_profiles
    WHERE id = auth.uid() AND role = 'admin'
  )
);

DROP POLICY IF EXISTS "public_read_contest_templates" ON storage.objects;
CREATE POLICY "public_read_contest_templates"
ON storage.objects FOR SELECT TO public
USING (bucket_id = 'contest-templates');

-- ─── Types ────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'template_crop_mode'
  ) THEN
    CREATE TYPE public.template_crop_mode AS ENUM ('cover', 'contain', 'fill', 'none');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'template_slot_type'
  ) THEN
    CREATE TYPE public.template_slot_type AS ENUM ('contestant', 'runner_up', 'badge', 'logo', 'custom');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'template_status'
  ) THEN
    CREATE TYPE public.template_status AS ENUM ('draft', 'active', 'archived');
  END IF;
END $$;

-- ─── contest_templates ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contest_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  contest_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  template_url TEXT NOT NULL,
  thumbnail_url TEXT,
  file_format TEXT NOT NULL DEFAULT 'png',
  width INTEGER NOT NULL DEFAULT 1080,
  height INTEGER NOT NULL DEFAULT 1080,
  aspect_ratio TEXT NOT NULL DEFAULT '1:1',
  status public.template_status NOT NULL DEFAULT 'draft',
  version INTEGER NOT NULL DEFAULT 1,
  parent_template_id UUID REFERENCES public.contest_templates(id) ON DELETE SET NULL,
  is_reusable BOOLEAN NOT NULL DEFAULT false,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_contest_templates_contest_id ON public.contest_templates(contest_id);
CREATE INDEX IF NOT EXISTS idx_contest_templates_created_by ON public.contest_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_contest_templates_status ON public.contest_templates(status);

-- ─── template_slots ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.template_slots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.contest_templates(id) ON DELETE CASCADE,
  slot_name TEXT NOT NULL DEFAULT 'Main Contestant',
  slot_type public.template_slot_type NOT NULL DEFAULT 'contestant',
  slot_order INTEGER NOT NULL DEFAULT 0,
  -- Position
  x NUMERIC NOT NULL DEFAULT 0,
  y NUMERIC NOT NULL DEFAULT 0,
  width NUMERIC NOT NULL DEFAULT 200,
  height NUMERIC NOT NULL DEFAULT 200,
  rotation NUMERIC NOT NULL DEFAULT 0,
  z_index INTEGER NOT NULL DEFAULT 1,
  -- Transform
  scale NUMERIC NOT NULL DEFAULT 1,
  crop_mode public.template_crop_mode NOT NULL DEFAULT 'cover',
  border_radius NUMERIC NOT NULL DEFAULT 0,
  opacity NUMERIC NOT NULL DEFAULT 1,
  -- Snap/Grid
  snap_to_grid BOOLEAN NOT NULL DEFAULT false,
  grid_size INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_slots_template_id ON public.template_slots(template_id);

-- ─── template_text_overlays ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.template_text_overlays (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id UUID NOT NULL REFERENCES public.contest_templates(id) ON DELETE CASCADE,
  label TEXT NOT NULL DEFAULT 'Text',
  field_type TEXT NOT NULL DEFAULT 'custom', -- 'contest_title' | 'contestant_name' | 'vote_count' | 'custom'
  content TEXT NOT NULL DEFAULT '',
  x NUMERIC NOT NULL DEFAULT 0,
  y NUMERIC NOT NULL DEFAULT 0,
  font_size INTEGER NOT NULL DEFAULT 24,
  font_weight TEXT NOT NULL DEFAULT 'bold',
  color TEXT NOT NULL DEFAULT '#FFFFFF',
  z_index INTEGER NOT NULL DEFAULT 10,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_template_text_overlays_template_id ON public.template_text_overlays(template_id);

-- ─── updated_at triggers ──────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.update_template_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contest_templates_updated_at ON public.contest_templates;
CREATE TRIGGER trg_contest_templates_updated_at
BEFORE UPDATE ON public.contest_templates
FOR EACH ROW EXECUTE FUNCTION public.update_template_updated_at();

DROP TRIGGER IF EXISTS trg_template_slots_updated_at ON public.template_slots;
CREATE TRIGGER trg_template_slots_updated_at
BEFORE UPDATE ON public.template_slots
FOR EACH ROW EXECUTE FUNCTION public.update_template_updated_at();

DROP TRIGGER IF EXISTS trg_template_text_overlays_updated_at ON public.template_text_overlays;
CREATE TRIGGER trg_template_text_overlays_updated_at
BEFORE UPDATE ON public.template_text_overlays
FOR EACH ROW EXECUTE FUNCTION public.update_template_updated_at();

-- ─── RLS ──────────────────────────────────────────────────────────────────────
ALTER TABLE public.contest_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_slots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.template_text_overlays ENABLE ROW LEVEL SECURITY;

-- contest_templates
DROP POLICY IF EXISTS "admin_manage_contest_templates" ON public.contest_templates;
CREATE POLICY "admin_manage_contest_templates"
ON public.contest_templates FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "public_read_contest_templates" ON public.contest_templates;
CREATE POLICY "public_read_contest_templates"
ON public.contest_templates FOR SELECT TO public
USING (status = 'active');

-- template_slots
DROP POLICY IF EXISTS "admin_manage_template_slots" ON public.template_slots;
CREATE POLICY "admin_manage_template_slots"
ON public.template_slots FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "public_read_template_slots" ON public.template_slots;
CREATE POLICY "public_read_template_slots"
ON public.template_slots FOR SELECT TO public
USING (true);

-- template_text_overlays
DROP POLICY IF EXISTS "admin_manage_template_text_overlays" ON public.template_text_overlays;
CREATE POLICY "admin_manage_template_text_overlays"
ON public.template_text_overlays FOR ALL TO authenticated
USING (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
)
WITH CHECK (
  EXISTS (SELECT 1 FROM public.user_profiles WHERE id = auth.uid() AND role = 'admin')
);

DROP POLICY IF EXISTS "public_read_template_text_overlays" ON public.template_text_overlays;
CREATE POLICY "public_read_template_text_overlays"
ON public.template_text_overlays FOR SELECT TO public
USING (true);
