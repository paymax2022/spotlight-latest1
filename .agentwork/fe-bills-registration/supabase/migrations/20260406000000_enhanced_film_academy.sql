-- Enhanced Film Academy Registration System
-- Add new columns to existing academy_applications table

-- Add new columns for enhanced form
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS gender VARCHAR(20);
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS date_of_birth DATE;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS residential_address TEXT;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS city VARCHAR(100);
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS state VARCHAR(100);
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS nationality VARCHAR(100) DEFAULT 'Nigerian';
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS areas_of_interest TEXT[] DEFAULT '{}';
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS highest_education VARCHAR(100);
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS school_name VARCHAR(255);
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS relevant_training TEXT;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS has_prior_experience BOOLEAN DEFAULT FALSE;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS experience_description TEXT;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS career_goals TEXT;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS terms_accepted BOOLEAN DEFAULT FALSE;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS terms_accepted_at TIMESTAMPTZ;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS reviewed_by UUID REFERENCES public.user_profiles(id) ON DELETE SET NULL;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS rejection_reason TEXT;
ALTER TABLE public.academy_applications ADD COLUMN IF NOT EXISTS admin_notes TEXT;

-- Make talent_category nullable for new form submissions (old data keeps existing values)
ALTER TABLE public.academy_applications ALTER COLUMN talent_category DROP NOT NULL;

-- Academy Application Uploads table
CREATE TABLE IF NOT EXISTS public.academy_application_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES public.academy_applications(id) ON DELETE CASCADE,
  file_type VARCHAR(50) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_url TEXT NOT NULL,
  file_size INTEGER,
  mime_type VARCHAR(100),
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Academy Application Status History
CREATE TABLE IF NOT EXISTS public.academy_application_status_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES public.academy_applications(id) ON DELETE CASCADE,
  old_status VARCHAR(50),
  new_status VARCHAR(50) NOT NULL,
  changed_by UUID REFERENCES public.user_profiles(id),
  change_reason TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_academy_applications_status ON public.academy_applications(status);
CREATE INDEX IF NOT EXISTS idx_academy_applications_email ON public.academy_applications(email);
CREATE INDEX IF NOT EXISTS idx_academy_applications_created ON public.academy_applications(created_at DESC);

-- Function to log status changes
CREATE OR REPLACE FUNCTION public.log_academy_application_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO public.academy_application_status_history (application_id, old_status, new_status, changed_by)
    VALUES (NEW.id, OLD.status, NEW.status, NEW.reviewed_by);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger for status logging
DROP TRIGGER IF EXISTS trigger_academy_application_status_log ON public.academy_applications;
CREATE TRIGGER trigger_academy_application_status_log
  AFTER UPDATE ON public.academy_applications
  FOR EACH ROW
  EXECUTE FUNCTION public.log_academy_application_status_change();

-- RLS for new tables
ALTER TABLE public.academy_application_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.academy_application_status_history ENABLE ROW LEVEL SECURITY;

-- Public read policy for uploads
DROP POLICY IF EXISTS "public_read_academy_uploads" ON public.academy_application_uploads;
CREATE POLICY "public_read_academy_uploads"
ON public.academy_application_uploads FOR SELECT TO public USING (true);

-- Storage buckets for file uploads
INSERT INTO storage.buckets (id, name, public) VALUES 
  ('academy-photos', 'academy-photos', true),
  ('academy-portfolios', 'academy-portfolios', true),
  ('academy-documents', 'academy-documents', true)
ON CONFLICT (id) DO NOTHING;

-- Storage policies
DROP POLICY IF EXISTS "anyone_upload_academy_photos" ON storage.objects;
CREATE POLICY "anyone_upload_academy_photos" ON storage.objects
  FOR INSERT TO public WITH CHECK (bucket_id = 'academy-photos');

DROP POLICY IF EXISTS "public_read_academy_photos" ON storage.objects;
CREATE POLICY "public_read_academy_photos" ON storage.objects
  FOR SELECT USING (bucket_id = 'academy-photos');

DROP POLICY IF EXISTS "anyone_upload_academy_portfolios" ON storage.objects;
CREATE POLICY "anyone_upload_academy_portfolios" ON storage.objects
  FOR INSERT TO public WITH CHECK (bucket_id = 'academy-portfolios');

DROP POLICY IF EXISTS "public_read_academy_portfolios" ON storage.objects;
CREATE POLICY "public_read_academy_portfolios" ON storage.objects
  FOR SELECT USING (bucket_id = 'academy-portfolios');

DROP POLICY IF EXISTS "anyone_upload_academy_documents" ON storage.objects;
CREATE POLICY "anyone_upload_academy_documents" ON storage.objects
  FOR INSERT TO public WITH CHECK (bucket_id = 'academy-documents');

DROP POLICY IF EXISTS "public_read_academy_documents" ON storage.objects;
CREATE POLICY "public_read_academy_documents" ON storage.objects
  FOR SELECT USING (bucket_id = 'academy-documents');
