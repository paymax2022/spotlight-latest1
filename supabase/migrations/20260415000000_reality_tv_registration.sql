-- -----------------------------------------------------------------------------
-- Reality TV Registration System
-- -----------------------------------------------------------------------------

-- 1. Create Status Enum for Applications
CREATE TYPE reality_tv_app_status AS ENUM (
  'draft',
  'submitted',
  'screening',
  'shortlisted',
  'welfare_review',
  'bootcamp_ready',
  'rejected',
  'onboarded'
);

-- 2. Create the Applications Table
CREATE TABLE reality_tv_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),

  -- Basic Identity (Indexed for quick admin search)
  email TEXT NOT NULL,
  phone TEXT NOT NULL,
  full_name TEXT NOT NULL,
  stage_name TEXT,
  age_bracket TEXT,
  talent_category TEXT NOT NULL,

  -- State Management
  status reality_tv_app_status DEFAULT 'draft',

  -- The complete multi-step form data stored as JSONB for flexibility
  -- This includes: personal, talent, story, bootcamp, welfare, conduct, media, etc.
  form_data JSONB NOT NULL DEFAULT '{}',

  -- Production Tags (for admin filtering)
  tags TEXT[] DEFAULT '{}',
  priority_level INT DEFAULT 0, -- 0: Low, 1: Medium, 2: High, 3: Critical

  -- Audit Trails
  assigned_moderator_id UUID REFERENCES auth.users(id),
  welfare_review_status TEXT DEFAULT 'pending',

  -- Constraints
  CONSTRAINT unique_email_per_season UNIQUE (email)
);

-- 3. Create Indexes for Admin Performance
CREATE INDEX idx_rtv_app_status ON reality_tv_applications(status);
CREATE INDEX idx_rtv_app_talent ON reality_tv_applications(talent_category);
CREATE INDEX idx_rtv_app_email ON reality_tv_applications(email);

-- 4. Row Level Security (RLS)
ALTER TABLE reality_tv_applications ENABLE ROW LEVEL SECURITY;

-- Policy: Applicants can only see/edit their own draft/submitted app
CREATE POLICY "Applicants can manage their own application"
ON reality_tv_applications
FOR ALL
USING (email = (SELECT email FROM auth.users WHERE id = auth.uid()));

-- Policy: Admins can do everything
CREATE POLICY "Admins have full access"
ON reality_tv_applications
FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM auth.users
    WHERE id = auth.uid()
    AND (raw_app_meta_data->>'role' = 'admin' OR raw_app_meta_data->>'role' = 'producer')
  )
);

-- 5. Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_modified_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_reality_tv_app_modtime
    BEFORE UPDATE ON reality_tv_applications
    FOR EACH ROW
    EXECUTE PROCEDURE update_modified_column();
