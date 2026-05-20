-- ============================================================
-- Spotlight Platform: Audition, Academy, Media & Testimonials
-- Migration: 20260405400000_audition_academy_media.sql
-- ============================================================

-- ============================================================
-- ENUMS
-- ============================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'audition_status'
  ) THEN
    CREATE TYPE public.audition_status AS ENUM ('active', 'disabled', 'full', 'completed');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'registration_status'
  ) THEN
    CREATE TYPE public.registration_status AS ENUM ('pending', 'confirmed', 'cancelled', 'attended');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'talent_category'
  ) THEN
    CREATE TYPE public.talent_category AS ENUM (
      'acting', 'singing', 'dancing', 'comedy', 'music_production',
      'film_production', 'content_creation', 'modelling', 'other'
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'academy_fee_type'
  ) THEN
    CREATE TYPE public.academy_fee_type AS ENUM ('free', 'paid');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'training_schedule'
  ) THEN
    CREATE TYPE public.training_schedule AS ENUM ('weekdays', 'weekends', 'accelerated');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'batch_status'
  ) THEN
    CREATE TYPE public.batch_status AS ENUM ('upcoming', 'ongoing', 'completed', 'cancelled');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'media_type'
  ) THEN
    CREATE TYPE public.media_type AS ENUM ('image', 'video');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_type
    WHERE typnamespace = 'public'::regnamespace
      AND typname = 'media_category'
  ) THEN
    CREATE TYPE public.media_category AS ENUM ('film_class', 'audition', 'production', 'event', 'testimonial');
  END IF;
END $$;

-- ============================================================
-- AUDITION SCHEDULES (Admin-created)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audition_schedules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  audition_date DATE NOT NULL,
  start_time TIME NOT NULL,
  end_time TIME,
  location_name TEXT NOT NULL,
  address TEXT NOT NULL,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  map_lat DECIMAL(10, 8),
  map_lng DECIMAL(11, 8),
  map_embed_url TEXT,
  capacity INTEGER,
  registered_count INTEGER DEFAULT 0,
  status public.audition_status DEFAULT 'active'::public.audition_status,
  notes TEXT,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- AUDITION REGISTRATIONS (User submissions)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.audition_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id UUID NOT NULL REFERENCES public.audition_schedules(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  talent_category public.talent_category NOT NULL,
  terms_accepted BOOLEAN NOT NULL DEFAULT false,
  terms_accepted_at TIMESTAMPTZ,
  status public.registration_status DEFAULT 'pending'::public.registration_status,
  registration_number TEXT UNIQUE,
  notes TEXT,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- FILM ACADEMY SETTINGS (Admin-configurable)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.academy_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_type public.academy_fee_type DEFAULT 'free'::public.academy_fee_type,
  application_fee DECIMAL(10, 2) DEFAULT 0,
  application_fee_refundable BOOLEAN DEFAULT false,
  tuition_fee DECIMAL(10, 2) DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  updated_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ACADEMY BATCHES (Admin-created)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.academy_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_name TEXT NOT NULL,
  start_date DATE NOT NULL,
  training_schedule public.training_schedule NOT NULL,
  duration_weeks INTEGER NOT NULL DEFAULT 12,
  max_students INTEGER,
  enrolled_count INTEGER DEFAULT 0,
  status public.batch_status DEFAULT 'upcoming'::public.batch_status,
  description TEXT,
  benefits TEXT[] DEFAULT ARRAY[]::TEXT[],
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- ACADEMY APPLICATIONS (User submissions)
-- ============================================================

CREATE TABLE IF NOT EXISTS public.academy_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  batch_id UUID NOT NULL REFERENCES public.academy_batches(id) ON DELETE CASCADE,
  user_id UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  full_name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  talent_category public.talent_category NOT NULL,
  motivation TEXT,
  payment_reference TEXT,
  payment_status TEXT DEFAULT 'pending',
  application_fee_paid DECIMAL(10, 2) DEFAULT 0,
  status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- MEDIA GALLERY
-- ============================================================

CREATE TABLE IF NOT EXISTS public.media_gallery (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  title TEXT NOT NULL,
  description TEXT,
  media_type public.media_type NOT NULL,
  category public.media_category NOT NULL,
  url TEXT NOT NULL,
  thumbnail_url TEXT,
  alt_text TEXT NOT NULL,
  is_featured BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- PLATFORM TESTIMONIALS
-- ============================================================

CREATE TABLE IF NOT EXISTS public.platform_testimonials (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  role TEXT NOT NULL,
  quote TEXT NOT NULL,
  avatar_url TEXT,
  category TEXT DEFAULT 'general',
  is_featured BOOLEAN DEFAULT false,
  sort_order INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP
);

-- ============================================================
-- INDEXES
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_audition_schedules_date ON public.audition_schedules(audition_date);
CREATE INDEX IF NOT EXISTS idx_audition_schedules_status ON public.audition_schedules(status);
CREATE INDEX IF NOT EXISTS idx_audition_registrations_schedule ON public.audition_registrations(schedule_id);
CREATE INDEX IF NOT EXISTS idx_audition_registrations_email ON public.audition_registrations(email);
CREATE INDEX IF NOT EXISTS idx_academy_batches_status ON public.academy_batches(status);
CREATE INDEX IF NOT EXISTS idx_academy_applications_batch ON public.academy_applications(batch_id);
CREATE INDEX IF NOT EXISTS idx_media_gallery_category ON public.media_gallery(category);
CREATE INDEX IF NOT EXISTS idx_media_gallery_featured ON public.media_gallery(is_featured);
CREATE INDEX IF NOT EXISTS idx_testimonials_featured ON public.platform_testimonials(is_featured);

-- ============================================================
-- FUNCTIONS
-- ============================================================

CREATE OR REPLACE FUNCTION public.generate_registration_number()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.registration_number IS NULL THEN
    NEW.registration_number := 'SPT-' || TO_CHAR(NOW(), 'YYYYMMDD') || '-' || UPPER(SUBSTRING(NEW.id::TEXT, 1, 6));
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_audition_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.audition_schedules
    SET registered_count = registered_count + 1
    WHERE id = NEW.schedule_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.audition_schedules
    SET registered_count = GREATEST(registered_count - 1, 0)
    WHERE id = OLD.schedule_id;
  END IF;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.increment_academy_count()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    UPDATE public.academy_batches
    SET enrolled_count = enrolled_count + 1
    WHERE id = NEW.batch_id;
  ELSIF TG_OP = 'DELETE' THEN
    UPDATE public.academy_batches
    SET enrolled_count = GREATEST(enrolled_count - 1, 0)
    WHERE id = OLD.batch_id;
  END IF;
  RETURN NULL;
END;
$$;

-- ============================================================
-- ENABLE RLS
-- ============================================================

ALTER TABLE public.audition_schedules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audition_registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.media_gallery ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_testimonials ENABLE ROW LEVEL SECURITY;

-- ============================================================
-- RLS POLICIES
-- ============================================================

-- Audition Schedules: public read, admin write
DROP POLICY IF EXISTS "public_read_audition_schedules" ON public.audition_schedules;
CREATE POLICY "public_read_audition_schedules"
ON public.audition_schedules FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "admin_manage_audition_schedules" ON public.audition_schedules;
CREATE POLICY "admin_manage_audition_schedules"
ON public.audition_schedules FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Audition Registrations: users manage own, admin sees all
DROP POLICY IF EXISTS "public_insert_audition_registrations" ON public.audition_registrations;
CREATE POLICY "public_insert_audition_registrations"
ON public.audition_registrations FOR INSERT TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "users_view_own_audition_registrations" ON public.audition_registrations;
CREATE POLICY "users_view_own_audition_registrations"
ON public.audition_registrations FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "admin_manage_audition_registrations" ON public.audition_registrations;
CREATE POLICY "admin_manage_audition_registrations"
ON public.audition_registrations FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Academy Settings: public read, admin write
DROP POLICY IF EXISTS "public_read_academy_settings" ON public.academy_settings;
CREATE POLICY "public_read_academy_settings"
ON public.academy_settings FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "admin_manage_academy_settings" ON public.academy_settings;
CREATE POLICY "admin_manage_academy_settings"
ON public.academy_settings FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Academy Batches: public read, admin write
DROP POLICY IF EXISTS "public_read_academy_batches" ON public.academy_batches;
CREATE POLICY "public_read_academy_batches"
ON public.academy_batches FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "admin_manage_academy_batches" ON public.academy_batches;
CREATE POLICY "admin_manage_academy_batches"
ON public.academy_batches FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Academy Applications: public insert, users view own, admin all
DROP POLICY IF EXISTS "public_insert_academy_applications" ON public.academy_applications;
CREATE POLICY "public_insert_academy_applications"
ON public.academy_applications FOR INSERT TO public
WITH CHECK (true);

DROP POLICY IF EXISTS "users_view_own_academy_applications" ON public.academy_applications;
CREATE POLICY "users_view_own_academy_applications"
ON public.academy_applications FOR SELECT TO authenticated
USING (user_id = auth.uid() OR public.is_admin());

DROP POLICY IF EXISTS "admin_manage_academy_applications" ON public.academy_applications;
CREATE POLICY "admin_manage_academy_applications"
ON public.academy_applications FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Media Gallery: public read, admin write
DROP POLICY IF EXISTS "public_read_media_gallery" ON public.media_gallery;
CREATE POLICY "public_read_media_gallery"
ON public.media_gallery FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "admin_manage_media_gallery" ON public.media_gallery;
CREATE POLICY "admin_manage_media_gallery"
ON public.media_gallery FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- Testimonials: public read, admin write
DROP POLICY IF EXISTS "public_read_platform_testimonials" ON public.platform_testimonials;
CREATE POLICY "public_read_platform_testimonials"
ON public.platform_testimonials FOR SELECT TO public USING (true);

DROP POLICY IF EXISTS "admin_manage_platform_testimonials" ON public.platform_testimonials;
CREATE POLICY "admin_manage_platform_testimonials"
ON public.platform_testimonials FOR ALL TO authenticated
USING (public.is_admin())
WITH CHECK (public.is_admin());

-- ============================================================
-- TRIGGERS
-- ============================================================

DROP TRIGGER IF EXISTS set_registration_number ON public.audition_registrations;
CREATE TRIGGER set_registration_number
BEFORE INSERT ON public.audition_registrations
FOR EACH ROW EXECUTE FUNCTION public.generate_registration_number();

DROP TRIGGER IF EXISTS update_audition_count ON public.audition_registrations;
CREATE TRIGGER update_audition_count
AFTER INSERT OR DELETE ON public.audition_registrations
FOR EACH ROW EXECUTE FUNCTION public.increment_audition_count();

DROP TRIGGER IF EXISTS update_academy_count ON public.academy_applications;
CREATE TRIGGER update_academy_count
AFTER INSERT OR DELETE ON public.academy_applications
FOR EACH ROW EXECUTE FUNCTION public.increment_academy_count();

-- ============================================================
-- SEED DATA
-- ============================================================

-- Academy Settings (default)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.academy_settings
    WHERE is_active = true
  ) THEN
    INSERT INTO public.academy_settings (
      id,
      registration_type,
      application_fee,
      application_fee_refundable,
      tuition_fee,
      is_active
    )
    VALUES (gen_random_uuid(), 'paid'::public.academy_fee_type, 5000, false, 150000, true);
  END IF;
END $$;

-- Audition Schedules
DO $$
BEGIN
  INSERT INTO public.audition_schedules (title, audition_date, start_time, end_time, location_name, address, city, state, capacity, status)
  VALUES
    ('Lagos Open Audition', CURRENT_DATE + INTERVAL '14 days', '09:00', '17:00', 'Eko Hotel & Suites', 'Plot 1415 Adetokunbo Ademola Street, Victoria Island', 'Lagos', 'Lagos', 200, 'active'),
    ('Abuja Open Audition', CURRENT_DATE + INTERVAL '21 days', '09:00', '17:00', 'Transcorp Hilton', '1 Aguiyi Ironsi Street, Maitama', 'Abuja', 'FCT', 150, 'active'),
    ('Port Harcourt Audition', CURRENT_DATE + INTERVAL '28 days', '10:00', '16:00', 'Novotel Port Harcourt', 'Stadium Road, GRA Phase 2', 'Port Harcourt', 'Rivers', 100, 'active')
  ON CONFLICT DO NOTHING;
END $$;

-- Academy Batches
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.academy_batches WHERE batch_name = 'Batch A - 2026'
  ) THEN
    INSERT INTO public.academy_batches (
      batch_name,
      start_date,
      training_schedule,
      duration_weeks,
      max_students,
      status,
      description,
      benefits
    )
    VALUES (
      'Batch A - 2026',
      CURRENT_DATE + INTERVAL '30 days',
      'weekdays'::public.training_schedule,
      24,
      30,
      'upcoming',
      'Intensive weekday program for aspiring actors and filmmakers',
      ARRAY['Professional acting skills', 'Film production exposure', 'Industry networking', 'Certification', 'Career placement support']
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.academy_batches WHERE batch_name = 'Batch B - 2026'
  ) THEN
    INSERT INTO public.academy_batches (
      batch_name,
      start_date,
      training_schedule,
      duration_weeks,
      max_students,
      status,
      description,
      benefits
    )
    VALUES (
      'Batch B - 2026',
      CURRENT_DATE + INTERVAL '45 days',
      'weekends'::public.training_schedule,
      36,
      25,
      'upcoming',
      'Weekend program designed for working professionals',
      ARRAY['Flexible weekend schedule', 'Acting and vocal training', 'Script writing', 'Industry mentorship', 'Certification']
    );
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.academy_batches WHERE batch_name = 'Accelerated - 2026'
  ) THEN
    INSERT INTO public.academy_batches (
      batch_name,
      start_date,
      training_schedule,
      duration_weeks,
      max_students,
      status,
      description,
      benefits
    )
    VALUES (
      'Accelerated - 2026',
      CURRENT_DATE + INTERVAL '60 days',
      'accelerated'::public.training_schedule,
      12,
      20,
      'upcoming',
      'Fast-track program covering all core disciplines in 3 months',
      ARRAY['Accelerated curriculum', 'All disciplines covered', 'Intensive mentorship', 'Industry connections', 'Certification']
    );
  END IF;
END $$;

-- Media Gallery
DO $$
BEGIN
  INSERT INTO public.media_gallery (title, description, media_type, category, url, thumbnail_url, alt_text, is_featured, sort_order)
  VALUES
    ('Film Class in Session', 'Students learning cinematography techniques', 'image', 'film_class',
     'https://images.unsplash.com/photo-1524712245354-2c4e5e7121c0', null,
     'Film academy students in a professional studio learning cinematography', true, 1),
    ('Audition Day Lagos', 'Contestants at the Lagos open audition', 'image', 'audition',
     'https://images.unsplash.com/photo-1516280440614-37939bbacd81', null,
     'Talented contestants performing at the Spotlight Lagos audition', true, 2),
    ('Movie Production Set', 'Behind the scenes of a Nollywood production', 'image', 'production',
     'https://images.unsplash.com/photo-1485846234645-a62644f84728', null,
     'Film crew working on a Nollywood movie production set', true, 3),
    ('Acting Workshop', 'Intensive acting workshop with industry mentors', 'image', 'film_class',
     'https://images.unsplash.com/photo-1598387993441-a364f854cfbd', null,
     'Acting students in an intensive workshop session with professional mentors', false, 4),
    ('Spotlight Audition Stage', 'Main audition stage setup', 'image', 'audition',
     'https://images.unsplash.com/photo-1501386761578-eac5c94b800a', null,
     'The main Spotlight audition stage with professional lighting setup', false, 5),
    ('Film Production Workshop', 'Students learning film production', 'video', 'production',
     'https://www.youtube.com/embed/dQw4w9WgXcQ',
     'https://images.unsplash.com/photo-1492691527719-9d1e07e534b4',
     'Video thumbnail of film production workshop at Spotlight Academy', true, 6)
  ON CONFLICT DO NOTHING;
END $$;

-- Platform Testimonials
DO $$
BEGIN
  INSERT INTO public.platform_testimonials (name, role, quote, avatar_url, category, is_featured, sort_order)
  VALUES
    ('Ngozi Eze', 'Acting Graduate, Batch 2025',
     'The Film Academy transformed my career. I went from zero industry connections to landing my first Nollywood role within 3 months of graduating.',
     'https://img.rocket.new/generatedImages/rocket_gen_img_16ec8b3c4-1771895285687.png',
     'academy', true, 1),
    ('Tunde Adeyemi', 'Music Production Graduate',
     'Spotlight gave me the technical skills and the network I needed. My debut EP hit 200k streams thanks to the connections I made here.',
     'https://img.rocket.new/generatedImages/rocket_gen_img_11e7f73cf-1772656060430.png',
     'academy', true, 2),
    ('Amina Bello', 'Season 3 Finalist',
     'The audition process was smooth and professional. The team made every contestant feel valued. I am proud to be a Spotlight alumna.',
     'https://img.rocket.new/generatedImages/rocket_gen_img_1df1f5f56-1775037931280.png',
     'audition', true, 3),
    ('Chidi Okafor', 'Content Creation Graduate',
     'From 500 followers to 1.2 million — Spotlight taught me the real craft behind building an audience. Life-changing experience.',
     'https://img.rocket.new/generatedImages/rocket_gen_img_1f1a0a108-1772403726306.png',
     'academy', true, 4),
    ('Halima Yusuf', 'Film Direction Graduate',
     'I directed my first short film at 22 and it screened at two international festivals. Spotlight Film Academy made that possible.',
     'https://img.rocket.new/generatedImages/rocket_gen_img_186ca0a9b-1766525054085.png',
     'academy', true, 5),
    ('Emeka Obi', 'Season 2 Winner',
     'Winning Spotlight opened every door I needed. The platform is legit — they deliver on every promise they make to contestants.',
     'https://img.rocket.new/generatedImages/rocket_gen_img_16997b2fa-1775037930876.png',
     'audition', true, 6)
  ON CONFLICT DO NOTHING;
END $$;
