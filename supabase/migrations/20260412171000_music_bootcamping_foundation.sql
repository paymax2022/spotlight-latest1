-- ============================================================
-- Music Bootcamping Foundation
-- 3-Day Residential Artist Development & Music Production Program
-- ============================================================

CREATE TABLE IF NOT EXISTS public.bootcamp_editions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  summary TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'upcoming',
  location_name TEXT NOT NULL DEFAULT 'Timeless Studio',
  is_residential BOOLEAN NOT NULL DEFAULT true,
  start_at TIMESTAMPTZ,
  end_at TIMESTAMPTZ,
  application_deadline TIMESTAMPTZ,
  seat_limit INTEGER NOT NULL DEFAULT 30,
  seats_filled INTEGER NOT NULL DEFAULT 0,
  is_published BOOLEAN NOT NULL DEFAULT false,
  hero_title TEXT NOT NULL DEFAULT '',
  hero_subtitle TEXT NOT NULL DEFAULT '',
  highlights JSONB NOT NULL DEFAULT '[]'::jsonb,
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  faq JSONB NOT NULL DEFAULT '[]'::jsonb,
  includes_items JSONB NOT NULL DEFAULT '[]'::jsonb,
  requirements JSONB NOT NULL DEFAULT '[]'::jsonb,
  outcomes JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_editions_status_date
  ON public.bootcamp_editions(status, start_at, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bootcamp_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES public.bootcamp_editions(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  price_ngn INTEGER NOT NULL DEFAULT 0,
  seat_limit INTEGER,
  seats_taken INTEGER NOT NULL DEFAULT 0,
  benefits JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (edition_id, slug)
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_packages_edition_active
  ON public.bootcamp_packages(edition_id, is_active, sort_order);

CREATE TABLE IF NOT EXISTS public.bootcamp_mentors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  full_name TEXT NOT NULL,
  specialty TEXT NOT NULL DEFAULT '',
  short_bio TEXT NOT NULL DEFAULT '',
  avatar_url TEXT NOT NULL DEFAULT '',
  credibility_text TEXT NOT NULL DEFAULT '',
  role_title TEXT NOT NULL DEFAULT '',
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_mentors_active
  ON public.bootcamp_mentors(is_active, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bootcamp_edition_mentors (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES public.bootcamp_editions(id) ON DELETE CASCADE,
  mentor_id UUID NOT NULL REFERENCES public.bootcamp_mentors(id) ON DELETE CASCADE,
  role_title TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (edition_id, mentor_id)
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_edition_mentors_edition
  ON public.bootcamp_edition_mentors(edition_id, sort_order);

CREATE TABLE IF NOT EXISTS public.bootcamp_schedule_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES public.bootcamp_editions(id) ON DELETE CASCADE,
  day_number INTEGER NOT NULL DEFAULT 1,
  session_title TEXT NOT NULL,
  session_description TEXT NOT NULL DEFAULT '',
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  venue_label TEXT NOT NULL DEFAULT 'Timeless Studio',
  mentor_id UUID REFERENCES public.bootcamp_mentors(id) ON DELETE SET NULL,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_schedule_edition_day
  ON public.bootcamp_schedule_items(edition_id, day_number, sort_order);

CREATE TABLE IF NOT EXISTS public.bootcamp_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES public.bootcamp_editions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.user_profiles(id) ON DELETE CASCADE,
  stage_name TEXT NOT NULL DEFAULT '',
  legal_name TEXT NOT NULL DEFAULT '',
  genre_style TEXT NOT NULL DEFAULT '',
  short_bio TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  state TEXT NOT NULL DEFAULT '',
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  sample_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  portfolio_links JSONB NOT NULL DEFAULT '[]'::jsonb,
  past_experience TEXT NOT NULL DEFAULT '',
  motivation_text TEXT NOT NULL DEFAULT '',
  goals_text TEXT NOT NULL DEFAULT '',
  terms_accepted BOOLEAN NOT NULL DEFAULT false,
  explicit_content_declared BOOLEAN NOT NULL DEFAULT false,
  selected_package_id UUID REFERENCES public.bootcamp_packages(id) ON DELETE SET NULL,
  status TEXT NOT NULL DEFAULT 'draft',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  payment_reference TEXT,
  payment_amount_ngn INTEGER,
  submitted_at TIMESTAMPTZ,
  reviewed_at TIMESTAMPTZ,
  decision_note TEXT NOT NULL DEFAULT '',
  admin_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (edition_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_applications_edition_status
  ON public.bootcamp_applications(edition_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bootcamp_applications_user
  ON public.bootcamp_applications(user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bootcamp_applications_payment_ref
  ON public.bootcamp_applications(payment_reference);

CREATE TABLE IF NOT EXISTS public.bootcamp_application_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.bootcamp_applications(id) ON DELETE CASCADE,
  media_type TEXT NOT NULL DEFAULT 'link',
  media_url TEXT NOT NULL,
  caption TEXT NOT NULL DEFAULT '',
  is_primary BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_application_media_app
  ON public.bootcamp_application_media(application_id, is_primary DESC, created_at ASC);

CREATE TABLE IF NOT EXISTS public.bootcamp_application_status_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.bootcamp_applications(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  changed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_status_logs_app
  ON public.bootcamp_application_status_logs(application_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bootcamp_participant_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES public.bootcamp_editions(id) ON DELETE CASCADE,
  group_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  mentor_id UUID REFERENCES public.bootcamp_mentors(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_groups_edition
  ON public.bootcamp_participant_groups(edition_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bootcamp_group_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id UUID NOT NULL REFERENCES public.bootcamp_participant_groups(id) ON DELETE CASCADE,
  application_id UUID NOT NULL REFERENCES public.bootcamp_applications(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (application_id)
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_group_members_group
  ON public.bootcamp_group_members(group_id, created_at ASC);

CREATE TABLE IF NOT EXISTS public.bootcamp_announcements (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES public.bootcamp_editions(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  audience_scope TEXT NOT NULL DEFAULT 'participants',
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_announcements_edition
  ON public.bootcamp_announcements(edition_id, is_published, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bootcamp_studio_media (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID REFERENCES public.bootcamp_editions(id) ON DELETE CASCADE,
  title TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'image',
  caption TEXT NOT NULL DEFAULT '',
  sort_order INTEGER NOT NULL DEFAULT 0,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_studio_media_edition
  ON public.bootcamp_studio_media(edition_id, sort_order, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bootcamp_showcase_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES public.bootcamp_editions(id) ON DELETE CASCADE,
  application_id UUID REFERENCES public.bootcamp_applications(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  media_url TEXT NOT NULL,
  media_type TEXT NOT NULL DEFAULT 'audio',
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_showcase_edition
  ON public.bootcamp_showcase_items(edition_id, is_published, is_featured, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bootcamp_testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID REFERENCES public.bootcamp_editions(id) ON DELETE SET NULL,
  author_name TEXT NOT NULL,
  author_role TEXT NOT NULL DEFAULT 'Participant',
  quote_text TEXT NOT NULL,
  avatar_url TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL DEFAULT 5,
  is_published BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_testimonials_published
  ON public.bootcamp_testimonials(is_published, created_at DESC);

CREATE TABLE IF NOT EXISTS public.bootcamp_alumni_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  edition_id UUID NOT NULL REFERENCES public.bootcamp_editions(id) ON DELETE CASCADE,
  application_id UUID UNIQUE REFERENCES public.bootcamp_applications(id) ON DELETE SET NULL,
  artist_name TEXT NOT NULL,
  spotlight_note TEXT NOT NULL DEFAULT '',
  achievements JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_bootcamp_alumni_edition
  ON public.bootcamp_alumni_records(edition_id, is_featured, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_bootcamp_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS set_bootcamp_editions_updated_at ON public.bootcamp_editions;
CREATE TRIGGER set_bootcamp_editions_updated_at
  BEFORE UPDATE ON public.bootcamp_editions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bootcamp_updated_at();

DROP TRIGGER IF EXISTS set_bootcamp_packages_updated_at ON public.bootcamp_packages;
CREATE TRIGGER set_bootcamp_packages_updated_at
  BEFORE UPDATE ON public.bootcamp_packages
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bootcamp_updated_at();

DROP TRIGGER IF EXISTS set_bootcamp_mentors_updated_at ON public.bootcamp_mentors;
CREATE TRIGGER set_bootcamp_mentors_updated_at
  BEFORE UPDATE ON public.bootcamp_mentors
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bootcamp_updated_at();

DROP TRIGGER IF EXISTS set_bootcamp_schedule_updated_at ON public.bootcamp_schedule_items;
CREATE TRIGGER set_bootcamp_schedule_updated_at
  BEFORE UPDATE ON public.bootcamp_schedule_items
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bootcamp_updated_at();

DROP TRIGGER IF EXISTS set_bootcamp_applications_updated_at ON public.bootcamp_applications;
CREATE TRIGGER set_bootcamp_applications_updated_at
  BEFORE UPDATE ON public.bootcamp_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.set_bootcamp_updated_at();

ALTER TABLE public.bootcamp_editions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_packages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_mentors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_edition_mentors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_schedule_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_application_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_application_status_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_participant_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_group_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_announcements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_studio_media ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_showcase_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_testimonials ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.bootcamp_alumni_records ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "public_read_published_bootcamp_editions" ON public.bootcamp_editions;
CREATE POLICY "public_read_published_bootcamp_editions"
ON public.bootcamp_editions FOR SELECT TO anon, authenticated
USING (is_published = true OR public.is_admin());

DROP POLICY IF EXISTS "public_read_bootcamp_packages" ON public.bootcamp_packages;
CREATE POLICY "public_read_bootcamp_packages"
ON public.bootcamp_packages FOR SELECT TO anon, authenticated
USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "public_read_bootcamp_mentors" ON public.bootcamp_mentors;
CREATE POLICY "public_read_bootcamp_mentors"
ON public.bootcamp_mentors FOR SELECT TO anon, authenticated
USING (is_active = true OR public.is_admin());

DROP POLICY IF EXISTS "public_read_bootcamp_edition_mentors" ON public.bootcamp_edition_mentors;
CREATE POLICY "public_read_bootcamp_edition_mentors"
ON public.bootcamp_edition_mentors FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "public_read_bootcamp_schedule" ON public.bootcamp_schedule_items;
CREATE POLICY "public_read_bootcamp_schedule"
ON public.bootcamp_schedule_items FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "admin_manage_bootcamp_editions" ON public.bootcamp_editions;
CREATE POLICY "admin_manage_bootcamp_editions"
ON public.bootcamp_editions FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_bootcamp_packages" ON public.bootcamp_packages;
CREATE POLICY "admin_manage_bootcamp_packages"
ON public.bootcamp_packages FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_bootcamp_mentors" ON public.bootcamp_mentors;
CREATE POLICY "admin_manage_bootcamp_mentors"
ON public.bootcamp_mentors FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_bootcamp_edition_mentors" ON public.bootcamp_edition_mentors;
CREATE POLICY "admin_manage_bootcamp_edition_mentors"
ON public.bootcamp_edition_mentors FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_bootcamp_schedule" ON public.bootcamp_schedule_items;
CREATE POLICY "admin_manage_bootcamp_schedule"
ON public.bootcamp_schedule_items FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "users_manage_own_bootcamp_applications" ON public.bootcamp_applications;
CREATE POLICY "users_manage_own_bootcamp_applications"
ON public.bootcamp_applications FOR ALL TO authenticated
USING (user_id = auth.uid() OR public.is_admin())
WITH CHECK (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "users_manage_own_bootcamp_application_media" ON public.bootcamp_application_media;
CREATE POLICY "users_manage_own_bootcamp_application_media"
ON public.bootcamp_application_media FOR ALL TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.bootcamp_applications a
    WHERE a.id = application_id
      AND (a.user_id = auth.uid() OR public.is_admin())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.bootcamp_applications a
    WHERE a.id = application_id
      AND (a.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "admin_manage_bootcamp_status_logs" ON public.bootcamp_application_status_logs;
CREATE POLICY "admin_manage_bootcamp_status_logs"
ON public.bootcamp_application_status_logs FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_bootcamp_groups" ON public.bootcamp_participant_groups;
CREATE POLICY "admin_manage_bootcamp_groups"
ON public.bootcamp_participant_groups FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "admin_manage_bootcamp_group_members" ON public.bootcamp_group_members;
CREATE POLICY "admin_manage_bootcamp_group_members"
ON public.bootcamp_group_members FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "participants_read_bootcamp_groups" ON public.bootcamp_group_members;
CREATE POLICY "participants_read_bootcamp_groups"
ON public.bootcamp_group_members FOR SELECT TO authenticated
USING (
  public.is_admin() OR EXISTS (
    SELECT 1 FROM public.bootcamp_applications a
    WHERE a.id = application_id
      AND a.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "participants_read_bootcamp_announcements" ON public.bootcamp_announcements;
CREATE POLICY "participants_read_bootcamp_announcements"
ON public.bootcamp_announcements FOR SELECT TO authenticated
USING (is_published = true OR public.is_admin());

DROP POLICY IF EXISTS "admin_manage_bootcamp_announcements" ON public.bootcamp_announcements;
CREATE POLICY "admin_manage_bootcamp_announcements"
ON public.bootcamp_announcements FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_bootcamp_studio_media" ON public.bootcamp_studio_media;
CREATE POLICY "public_read_bootcamp_studio_media"
ON public.bootcamp_studio_media FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "admin_manage_bootcamp_studio_media" ON public.bootcamp_studio_media;
CREATE POLICY "admin_manage_bootcamp_studio_media"
ON public.bootcamp_studio_media FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_bootcamp_showcase" ON public.bootcamp_showcase_items;
CREATE POLICY "public_read_bootcamp_showcase"
ON public.bootcamp_showcase_items FOR SELECT TO anon, authenticated
USING (is_published = true OR public.is_admin());

DROP POLICY IF EXISTS "admin_manage_bootcamp_showcase" ON public.bootcamp_showcase_items;
CREATE POLICY "admin_manage_bootcamp_showcase"
ON public.bootcamp_showcase_items FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_bootcamp_testimonials" ON public.bootcamp_testimonials;
CREATE POLICY "public_read_bootcamp_testimonials"
ON public.bootcamp_testimonials FOR SELECT TO anon, authenticated
USING (is_published = true OR public.is_admin());

DROP POLICY IF EXISTS "admin_manage_bootcamp_testimonials" ON public.bootcamp_testimonials;
CREATE POLICY "admin_manage_bootcamp_testimonials"
ON public.bootcamp_testimonials FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "public_read_bootcamp_alumni" ON public.bootcamp_alumni_records;
CREATE POLICY "public_read_bootcamp_alumni"
ON public.bootcamp_alumni_records FOR SELECT TO anon, authenticated
USING (true);

DROP POLICY IF EXISTS "admin_manage_bootcamp_alumni" ON public.bootcamp_alumni_records;
CREATE POLICY "admin_manage_bootcamp_alumni"
ON public.bootcamp_alumni_records FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());
