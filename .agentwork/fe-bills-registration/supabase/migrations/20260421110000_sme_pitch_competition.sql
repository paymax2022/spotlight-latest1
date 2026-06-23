BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sme_pitch_application_status') THEN
    CREATE TYPE public.sme_pitch_application_status AS ENUM (
      'draft',
      'submitted',
      'under_review',
      'shortlisted',
      'rejected',
      'selected',
      'withdrawn'
    );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'sme_pitch_review_stage') THEN
    CREATE TYPE public.sme_pitch_review_stage AS ENUM (
      'intake',
      'screening',
      'due_diligence',
      'bootcamp',
      'pitch_day',
      'final_decision'
    );
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS public.sme_pitch_application_code_seq;

CREATE TABLE IF NOT EXISTS public.sme_pitch_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_code TEXT UNIQUE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status public.sme_pitch_application_status NOT NULL DEFAULT 'draft',
  review_stage public.sme_pitch_review_stage NOT NULL DEFAULT 'intake',
  source_channel TEXT NOT NULL DEFAULT 'web',
  utm_source TEXT,
  utm_medium TEXT,
  utm_campaign TEXT,
  current_step INTEGER NOT NULL DEFAULT 1 CHECK (current_step >= 1 AND current_step <= 13),
  completion_percent INTEGER NOT NULL DEFAULT 0 CHECK (completion_percent >= 0 AND completion_percent <= 100),
  applicant_profile JSONB NOT NULL DEFAULT '{}'::jsonb,
  founder_team JSONB NOT NULL DEFAULT '{}'::jsonb,
  business_info JSONB NOT NULL DEFAULT '{}'::jsonb,
  market_opportunity JSONB NOT NULL DEFAULT '{}'::jsonb,
  traction_performance JSONB NOT NULL DEFAULT '{}'::jsonb,
  product_readiness JSONB NOT NULL DEFAULT '{}'::jsonb,
  financial_funding JSONB NOT NULL DEFAULT '{}'::jsonb,
  impact_inclusion JSONB NOT NULL DEFAULT '{}'::jsonb,
  pitch_readiness JSONB NOT NULL DEFAULT '{}'::jsonb,
  declarations JSONB NOT NULL DEFAULT '{}'::jsonb,
  eligibility_flags JSONB NOT NULL DEFAULT '{}'::jsonb,
  shortlist_status TEXT NOT NULL DEFAULT 'pending',
  scoring_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  category_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  investor_readiness_tag TEXT,
  traction_level_tag TEXT,
  funding_need_band TEXT,
  admin_notes TEXT NOT NULL DEFAULT '',
  submitted_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sme_pitch_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.sme_pitch_applications(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL,
  file_path TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT,
  file_size_bytes BIGINT,
  is_required BOOLEAN NOT NULL DEFAULT false,
  uploaded_by UUID REFERENCES auth.users(id),
  uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sme_pitch_admin_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.sme_pitch_applications(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES auth.users(id),
  innovation_score INTEGER CHECK (innovation_score BETWEEN 0 AND 10),
  problem_solution_score INTEGER CHECK (problem_solution_score BETWEEN 0 AND 10),
  market_score INTEGER CHECK (market_score BETWEEN 0 AND 10),
  founder_strength_score INTEGER CHECK (founder_strength_score BETWEEN 0 AND 10),
  traction_score INTEGER CHECK (traction_score BETWEEN 0 AND 10),
  scalability_score INTEGER CHECK (scalability_score BETWEEN 0 AND 10),
  sustainability_score INTEGER CHECK (sustainability_score BETWEEN 0 AND 10),
  pitch_readiness_score INTEGER CHECK (pitch_readiness_score BETWEEN 0 AND 10),
  impact_score INTEGER CHECK (impact_score BETWEEN 0 AND 10),
  investment_attractiveness_score INTEGER CHECK (investment_attractiveness_score BETWEEN 0 AND 10),
  total_score NUMERIC(5,2),
  scoring_tags TEXT[] NOT NULL DEFAULT '{}'::text[],
  reviewer_notes TEXT NOT NULL DEFAULT '',
  is_final BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.sme_pitch_application_status_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.sme_pitch_applications(id) ON DELETE CASCADE,
  from_status public.sme_pitch_application_status,
  to_status public.sme_pitch_application_status NOT NULL,
  changed_by UUID REFERENCES auth.users(id),
  note TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sme_pitch_applications_user_id
  ON public.sme_pitch_applications(user_id);

CREATE INDEX IF NOT EXISTS idx_sme_pitch_applications_status
  ON public.sme_pitch_applications(status);

CREATE INDEX IF NOT EXISTS idx_sme_pitch_applications_review_stage
  ON public.sme_pitch_applications(review_stage);

CREATE INDEX IF NOT EXISTS idx_sme_pitch_applications_submitted_at
  ON public.sme_pitch_applications(submitted_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_sme_pitch_uploads_application_id
  ON public.sme_pitch_uploads(application_id);

CREATE INDEX IF NOT EXISTS idx_sme_pitch_admin_reviews_application_id
  ON public.sme_pitch_admin_reviews(application_id);

CREATE OR REPLACE FUNCTION public.set_sme_pitch_application_code()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.application_code IS NULL OR NEW.application_code = '' THEN
    NEW.application_code := 'SP-SME-' || TO_CHAR(NOW(), 'YYYY') || '-' ||
      LPAD(NEXTVAL('public.sme_pitch_application_code_seq')::text, 6, '0');
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.touch_sme_pitch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_set_sme_pitch_application_code ON public.sme_pitch_applications;
CREATE TRIGGER trg_set_sme_pitch_application_code
BEFORE INSERT ON public.sme_pitch_applications
FOR EACH ROW
EXECUTE FUNCTION public.set_sme_pitch_application_code();

DROP TRIGGER IF EXISTS trg_touch_sme_pitch_updated_at ON public.sme_pitch_applications;
CREATE TRIGGER trg_touch_sme_pitch_updated_at
BEFORE UPDATE ON public.sme_pitch_applications
FOR EACH ROW
EXECUTE FUNCTION public.touch_sme_pitch_updated_at();

ALTER TABLE public.sme_pitch_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sme_pitch_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sme_pitch_admin_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sme_pitch_application_status_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sme_pitch_owner_select" ON public.sme_pitch_applications;
CREATE POLICY "sme_pitch_owner_select"
ON public.sme_pitch_applications
FOR SELECT
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

DROP POLICY IF EXISTS "sme_pitch_owner_insert" ON public.sme_pitch_applications;
CREATE POLICY "sme_pitch_owner_insert"
ON public.sme_pitch_applications
FOR INSERT
WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "sme_pitch_owner_update" ON public.sme_pitch_applications;
CREATE POLICY "sme_pitch_owner_update"
ON public.sme_pitch_applications
FOR UPDATE
USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
)
WITH CHECK (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

DROP POLICY IF EXISTS "sme_pitch_uploads_owner_or_admin_select" ON public.sme_pitch_uploads;
CREATE POLICY "sme_pitch_uploads_owner_or_admin_select"
ON public.sme_pitch_uploads
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.sme_pitch_applications a
    WHERE a.id = application_id
      AND (
        a.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_profiles up
          WHERE up.id = auth.uid() AND up.role = 'admin'
        )
      )
  )
);

DROP POLICY IF EXISTS "sme_pitch_uploads_owner_or_admin_write" ON public.sme_pitch_uploads;
CREATE POLICY "sme_pitch_uploads_owner_or_admin_write"
ON public.sme_pitch_uploads
FOR ALL
USING (
  EXISTS (
    SELECT 1
    FROM public.sme_pitch_applications a
    WHERE a.id = application_id
      AND (
        a.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_profiles up
          WHERE up.id = auth.uid() AND up.role = 'admin'
        )
      )
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1
    FROM public.sme_pitch_applications a
    WHERE a.id = application_id
      AND (
        a.user_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.user_profiles up
          WHERE up.id = auth.uid() AND up.role = 'admin'
        )
      )
  )
);

DROP POLICY IF EXISTS "sme_pitch_admin_reviews_admin_only" ON public.sme_pitch_admin_reviews;
CREATE POLICY "sme_pitch_admin_reviews_admin_only"
ON public.sme_pitch_admin_reviews
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

DROP POLICY IF EXISTS "sme_pitch_status_logs_admin_only" ON public.sme_pitch_application_status_logs;
CREATE POLICY "sme_pitch_status_logs_admin_only"
ON public.sme_pitch_application_status_logs
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.user_profiles up
    WHERE up.id = auth.uid() AND up.role = 'admin'
  )
);

COMMIT;
