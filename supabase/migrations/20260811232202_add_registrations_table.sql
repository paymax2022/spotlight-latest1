-- Create registrations table for contest registration system
-- Stores all registration drafts and submissions

CREATE TABLE IF NOT EXISTS public.registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- User and contest info
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  contest_slug TEXT NOT NULL,
  reference TEXT NOT NULL UNIQUE, -- Human-readable reference (e.g., "SPOT-123456-ABC")

  -- Lifecycle
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'submitted',
      'awaiting_payment',
      'under_review',
      'more_information_requested',
      'shortlisted',
      'callback_invited',
      'approved',
      'rejected',
      'waitlisted',
      'disqualified',
      'audition_scheduled',
      'selected_for_bootcamp',
      'selected_for_public_voting',
      'eliminated',
      'winner',
      'withdrawn'
    )),

  -- Form data
  form_data JSONB DEFAULT '{}',
  current_step TEXT DEFAULT 'contest_selection',
  completion_percent INTEGER DEFAULT 0 CHECK (completion_percent >= 0 AND completion_percent <= 100),

  -- Metadata
  role TEXT NOT NULL DEFAULT 'public_user' CHECK (role IN ('public_user', 'invited_applicant', 'staff')),
  fraud_flags JSONB DEFAULT '[]',

  -- Timestamps
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  submitted_at TIMESTAMPTZ,
  withdrawn_at TIMESTAMPTZ,

  -- Constraints
  CONSTRAINT reference_format CHECK (reference ~ '^[A-Z0-9]+-[0-9]+-[A-Z0-9]+$')
);

-- Create status_events table for audit trail
CREATE TABLE IF NOT EXISTS public.registration_status_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  registration_id UUID NOT NULL REFERENCES public.registrations(id) ON DELETE CASCADE,

  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT,
  actor_role TEXT NOT NULL DEFAULT 'public_user',

  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes for common queries
CREATE INDEX idx_registrations_user_id ON public.registrations(user_id);
CREATE INDEX idx_registrations_contest_slug ON public.registrations(contest_slug);
CREATE INDEX idx_registrations_status ON public.registrations(status);
CREATE INDEX idx_registrations_created_at ON public.registrations(created_at DESC);
CREATE INDEX idx_registrations_reference ON public.registrations(reference);

CREATE INDEX idx_status_events_registration_id ON public.registration_status_events(registration_id);
CREATE INDEX idx_status_events_created_at ON public.registration_status_events(created_at DESC);

-- Enable RLS
ALTER TABLE public.registrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.registration_status_events ENABLE ROW LEVEL SECURITY;

-- RLS Policies: Users can view/edit their own registrations
CREATE POLICY "Users can view their own registrations"
  ON public.registrations
  FOR SELECT
  USING (auth.uid() = user_id OR current_user_id IS NULL); -- NULL allows service role

CREATE POLICY "Users can create registrations"
  ON public.registrations
  FOR INSERT
  WITH CHECK (auth.uid() = user_id OR current_user_id IS NULL);

CREATE POLICY "Users can update their own registrations"
  ON public.registrations
  FOR UPDATE
  USING (auth.uid() = user_id OR current_user_id IS NULL)
  WITH CHECK (auth.uid() = user_id OR current_user_id IS NULL);

-- Status events are read-only for users
CREATE POLICY "Users can view status events for their registrations"
  ON public.registration_status_events
  FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.registrations
      WHERE registrations.id = registration_status_events.registration_id
      AND (registrations.user_id = auth.uid() OR current_user_id IS NULL)
    )
  );

-- Comments
COMMENT ON TABLE public.registrations IS 'Contest registration drafts and submissions. Stores form data for multi-step wizard.';
COMMENT ON TABLE public.registration_status_events IS 'Audit trail of registration status changes.';
COMMENT ON COLUMN public.registrations.form_data IS 'JSON blob storing form answers keyed by field.key (e.g., {"personal.firstName": "John", "contact.email": "..."}). Schema-driven by contest definition.';
COMMENT ON COLUMN public.registrations.fraud_flags IS 'Array of fraud check results (e.g., ["duplicate_email", "suspicious_location"]).';
