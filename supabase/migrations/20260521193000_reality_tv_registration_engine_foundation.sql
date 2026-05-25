-- Spotlight Contest Registration Engine Foundation
-- Production note: legal consent language should be reviewed by qualified counsel before launch.

BEGIN;

CREATE TABLE IF NOT EXISTS public.contest_registration_templates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  template_name TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1,
  description TEXT NOT NULL DEFAULT '',
  step_schema JSONB NOT NULL DEFAULT '[]'::jsonb,
  field_schema JSONB NOT NULL DEFAULT '{}'::jsonb,
  active BOOLEAN NOT NULL DEFAULT true,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_contests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  contest_id UUID REFERENCES public.contests(id) ON DELETE CASCADE,
  template_id UUID REFERENCES public.contest_registration_templates(id) ON DELETE SET NULL,
  slug TEXT NOT NULL UNIQUE,
  title TEXT NOT NULL,
  contest_category TEXT NOT NULL,
  contest_type TEXT NOT NULL,
  season_or_edition TEXT NOT NULL DEFAULT '',
  region_scope TEXT NOT NULL DEFAULT 'national',
  is_paid BOOLEAN NOT NULL DEFAULT false,
  registration_fee_ngn NUMERIC(12,2) NOT NULL DEFAULT 0,
  requires_guardian_consent BOOLEAN NOT NULL DEFAULT true,
  legal_adult_age INTEGER NOT NULL DEFAULT 18,
  requires_medical_disclosure BOOLEAN NOT NULL DEFAULT false,
  requires_bootcamp_readiness BOOLEAN NOT NULL DEFAULT false,
  supports_voting BOOLEAN NOT NULL DEFAULT false,
  supports_audition_scheduling BOOLEAN NOT NULL DEFAULT false,
  supports_school_entry BOOLEAN NOT NULL DEFAULT false,
  supports_group_entry BOOLEAN NOT NULL DEFAULT false,
  published BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_reference TEXT NOT NULL UNIQUE,
  contest_registration_id UUID REFERENCES public.contest_registration_contests(id) ON DELETE SET NULL,
  contest_id UUID REFERENCES public.contests(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  role TEXT NOT NULL DEFAULT 'public_user',
  status TEXT NOT NULL DEFAULT 'draft',
  payment_status TEXT NOT NULL DEFAULT 'pending',
  current_step TEXT NOT NULL DEFAULT 'account_gate',
  completion_percent INTEGER NOT NULL DEFAULT 0,
  applicant_full_name TEXT NOT NULL DEFAULT '',
  applicant_email TEXT NOT NULL DEFAULT '',
  applicant_phone TEXT NOT NULL DEFAULT '',
  applicant_age INTEGER,
  applicant_state TEXT NOT NULL DEFAULT '',
  applicant_city TEXT NOT NULL DEFAULT '',
  category_key TEXT NOT NULL DEFAULT '',
  contest_type TEXT NOT NULL DEFAULT '',
  submission_data JSONB NOT NULL DEFAULT '{}'::jsonb,
  fraud_flags JSONB NOT NULL DEFAULT '[]'::jsonb,
  submitted_at TIMESTAMPTZ,
  approved_public_profile_id UUID,
  created_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_section_answers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  field_key TEXT NOT NULL,
  field_type TEXT NOT NULL DEFAULT 'text',
  field_value_text TEXT NOT NULL DEFAULT '',
  field_value_json JSONB NOT NULL DEFAULT '{}'::jsonb,
  required BOOLEAN NOT NULL DEFAULT false,
  validation_state TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(application_id, field_key)
);

CREATE TABLE IF NOT EXISTS public.contest_registration_media_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  section_key TEXT NOT NULL,
  field_key TEXT NOT NULL,
  file_name TEXT NOT NULL DEFAULT '',
  file_size_bytes BIGINT NOT NULL DEFAULT 0,
  mime_type TEXT NOT NULL DEFAULT '',
  storage_bucket TEXT NOT NULL DEFAULT 'contestant-media',
  storage_path TEXT NOT NULL DEFAULT '',
  public_url TEXT NOT NULL DEFAULT '',
  private_asset BOOLEAN NOT NULL DEFAULT true,
  rights_confirmed BOOLEAN NOT NULL DEFAULT false,
  moderation_state TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_guardian_consents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  guardian_full_name TEXT NOT NULL,
  relationship TEXT NOT NULL DEFAULT '',
  guardian_phone TEXT NOT NULL DEFAULT '',
  guardian_email TEXT NOT NULL DEFAULT '',
  guardian_address TEXT NOT NULL DEFAULT '',
  id_document_url TEXT NOT NULL DEFAULT '',
  digital_signature TEXT NOT NULL DEFAULT '',
  consent_text TEXT NOT NULL DEFAULT '',
  consent_confirmed BOOLEAN NOT NULL DEFAULT false,
  email_otp_verified BOOLEAN NOT NULL DEFAULT false,
  phone_otp_verified BOOLEAN NOT NULL DEFAULT false,
  consent_timestamp TIMESTAMPTZ,
  ip_address TEXT NOT NULL DEFAULT '',
  device_fingerprint TEXT NOT NULL DEFAULT '',
  admin_review_required BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_medical_disclosures (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  general_health_status TEXT NOT NULL DEFAULT '',
  known_conditions TEXT NOT NULL DEFAULT '',
  allergies TEXT NOT NULL DEFAULT '',
  medications TEXT NOT NULL DEFAULT '',
  dietary_restrictions TEXT NOT NULL DEFAULT '',
  physical_limitations TEXT NOT NULL DEFAULT '',
  mental_health_notes TEXT NOT NULL DEFAULT '',
  emergency_treatment_consent BOOLEAN NOT NULL DEFAULT false,
  requires_special_accommodation BOOLEAN NOT NULL DEFAULT false,
  accommodation_notes TEXT NOT NULL DEFAULT '',
  confidential_visibility TEXT NOT NULL DEFAULT 'restricted',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_emergency_contacts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  full_name TEXT NOT NULL,
  relationship TEXT NOT NULL,
  phone TEXT NOT NULL,
  alt_phone TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  city_state_country TEXT NOT NULL DEFAULT '',
  confirm_participation BOOLEAN NOT NULL DEFAULT false,
  contact_if_selected BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  amount_ngn NUMERIC(12,2) NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'NGN',
  payment_provider TEXT NOT NULL DEFAULT '',
  payment_channel TEXT NOT NULL DEFAULT '',
  provider_reference TEXT NOT NULL DEFAULT '',
  internal_reference TEXT NOT NULL DEFAULT '',
  coupon_code TEXT NOT NULL DEFAULT '',
  waiver_code TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'pending',
  paid_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_auditions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  audition_format TEXT NOT NULL DEFAULT '',
  city TEXT NOT NULL DEFAULT '',
  venue TEXT NOT NULL DEFAULT '',
  audition_date DATE,
  audition_time_slot TEXT NOT NULL DEFAULT '',
  online_link TEXT NOT NULL DEFAULT '',
  special_needs TEXT NOT NULL DEFAULT '',
  confirmation_status TEXT NOT NULL DEFAULT 'pending',
  audition_code TEXT NOT NULL DEFAULT '',
  qr_checkin_code TEXT NOT NULL DEFAULT '',
  arrival_instructions TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contestant_public_profiles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID UNIQUE REFERENCES public.contest_registration_applications(id) ON DELETE SET NULL,
  contestant_id UUID REFERENCES public.contestants(id) ON DELETE SET NULL,
  display_name TEXT NOT NULL,
  short_bio TEXT NOT NULL DEFAULT '',
  contest_category TEXT NOT NULL DEFAULT '',
  city_state TEXT NOT NULL DEFAULT '',
  profile_photo_url TEXT NOT NULL DEFAULT '',
  intro_video_url TEXT NOT NULL DEFAULT '',
  talent_summary TEXT NOT NULL DEFAULT '',
  voting_slogan TEXT NOT NULL DEFAULT '',
  fan_message TEXT NOT NULL DEFAULT '',
  social_links JSONB NOT NULL DEFAULT '{}'::jsonb,
  shareable_link TEXT NOT NULL DEFAULT '',
  voting_enabled BOOLEAN NOT NULL DEFAULT false,
  visibility_status TEXT NOT NULL DEFAULT 'private',
  approval_status TEXT NOT NULL DEFAULT 'pending',
  approved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_screening_scores (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  template_name TEXT NOT NULL DEFAULT 'default',
  score_breakdown JSONB NOT NULL DEFAULT '{}'::jsonb,
  weighted_score NUMERIC(10,2) NOT NULL DEFAULT 0,
  recommendation TEXT NOT NULL DEFAULT 'pending',
  review_state TEXT NOT NULL DEFAULT 'draft',
  review_notes TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_reviews (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  reviewer_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  old_status TEXT,
  new_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  score NUMERIC(10,2),
  requested_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_fraud_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  flag_code TEXT NOT NULL,
  severity TEXT NOT NULL DEFAULT 'medium',
  description TEXT NOT NULL DEFAULT '',
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  auto_flagged BOOLEAN NOT NULL DEFAULT true,
  resolved BOOLEAN NOT NULL DEFAULT false,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_consent_records (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID NOT NULL REFERENCES public.contest_registration_applications(id) ON DELETE CASCADE,
  consent_key TEXT NOT NULL,
  consent_label TEXT NOT NULL,
  accepted BOOLEAN NOT NULL DEFAULT false,
  accepted_at TIMESTAMPTZ,
  ip_address TEXT NOT NULL DEFAULT '',
  device_fingerprint TEXT NOT NULL DEFAULT '',
  version TEXT NOT NULL DEFAULT 'v1',
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(application_id, consent_key)
);

CREATE TABLE IF NOT EXISTS public.contest_registration_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id UUID REFERENCES public.contest_registration_applications(id) ON DELETE SET NULL,
  user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  channel TEXT NOT NULL,
  template_key TEXT NOT NULL,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  sent_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_referrals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  owner_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  source TEXT NOT NULL DEFAULT 'campaign',
  discount_percent NUMERIC(5,2) NOT NULL DEFAULT 0,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  expires_at TIMESTAMPTZ,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_coupons (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  code TEXT NOT NULL UNIQUE,
  discount_type TEXT NOT NULL DEFAULT 'percentage',
  discount_value NUMERIC(12,2) NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT true,
  starts_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  max_uses INTEGER,
  used_count INTEGER NOT NULL DEFAULT 0,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS public.contest_registration_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  actor_role TEXT NOT NULL DEFAULT 'system',
  action TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT,
  summary TEXT NOT NULL DEFAULT '',
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_reg_apps_status ON public.contest_registration_applications(status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_apps_contest ON public.contest_registration_applications(contest_registration_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_apps_user ON public.contest_registration_applications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_apps_reference ON public.contest_registration_applications(application_reference);
CREATE INDEX IF NOT EXISTS idx_reg_answers_app ON public.contest_registration_section_answers(application_id, section_key);
CREATE INDEX IF NOT EXISTS idx_reg_media_app ON public.contest_registration_media_uploads(application_id, section_key);
CREATE INDEX IF NOT EXISTS idx_reg_reviews_app ON public.contest_registration_reviews(application_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_fraud_app ON public.contest_registration_fraud_flags(application_id, severity, resolved);
CREATE INDEX IF NOT EXISTS idx_reg_notifications_user ON public.contest_registration_notifications(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_reg_audit_created ON public.contest_registration_audit_logs(created_at DESC);

ALTER TABLE public.contest_registration_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_contests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_section_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_media_uploads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_guardian_consents ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_medical_disclosures ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_emergency_contacts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_auditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contestant_public_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_screening_scores ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_reviews ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_fraud_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_consent_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_referrals ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_coupons ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contest_registration_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reg_apps_owner_select" ON public.contest_registration_applications;
CREATE POLICY "reg_apps_owner_select"
ON public.contest_registration_applications FOR SELECT
USING (
  user_id = auth.uid()
  OR public.is_admin()
);

DROP POLICY IF EXISTS "reg_apps_owner_insert" ON public.contest_registration_applications;
CREATE POLICY "reg_apps_owner_insert"
ON public.contest_registration_applications FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  OR public.is_admin()
);

DROP POLICY IF EXISTS "reg_apps_owner_update" ON public.contest_registration_applications;
CREATE POLICY "reg_apps_owner_update"
ON public.contest_registration_applications FOR UPDATE
USING (
  user_id = auth.uid()
  OR public.is_admin()
)
WITH CHECK (
  user_id = auth.uid()
  OR public.is_admin()
);

DROP POLICY IF EXISTS "reg_apps_admin_delete" ON public.contest_registration_applications;
CREATE POLICY "reg_apps_admin_delete"
ON public.contest_registration_applications FOR DELETE
USING (public.is_admin());

DROP POLICY IF EXISTS "reg_related_owner_or_admin" ON public.contest_registration_section_answers;
CREATE POLICY "reg_related_owner_or_admin"
ON public.contest_registration_section_answers FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.contest_registration_applications a
    WHERE a.id = application_id
      AND (a.user_id = auth.uid() OR public.is_admin())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.contest_registration_applications a
    WHERE a.id = application_id
      AND (a.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "reg_media_owner_or_admin" ON public.contest_registration_media_uploads;
CREATE POLICY "reg_media_owner_or_admin"
ON public.contest_registration_media_uploads FOR ALL
USING (
  EXISTS (
    SELECT 1 FROM public.contest_registration_applications a
    WHERE a.id = application_id
      AND (a.user_id = auth.uid() OR public.is_admin())
  )
)
WITH CHECK (
  EXISTS (
    SELECT 1 FROM public.contest_registration_applications a
    WHERE a.id = application_id
      AND (a.user_id = auth.uid() OR public.is_admin())
  )
);

DROP POLICY IF EXISTS "reg_admin_full_access" ON public.contest_registration_reviews;
CREATE POLICY "reg_admin_full_access"
ON public.contest_registration_reviews FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

DROP POLICY IF EXISTS "reg_public_profiles_read" ON public.contestant_public_profiles;
CREATE POLICY "reg_public_profiles_read"
ON public.contestant_public_profiles FOR SELECT
TO public
USING (visibility_status = 'public' AND approval_status = 'approved');

DROP POLICY IF EXISTS "reg_public_profiles_admin" ON public.contestant_public_profiles;
CREATE POLICY "reg_public_profiles_admin"
ON public.contestant_public_profiles FOR ALL
USING (public.is_admin())
WITH CHECK (public.is_admin());

CREATE OR REPLACE FUNCTION public.contest_registration_touch_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_contest_registration_templates_updated ON public.contest_registration_templates;
CREATE TRIGGER trg_contest_registration_templates_updated BEFORE UPDATE ON public.contest_registration_templates
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_contests_updated ON public.contest_registration_contests;
CREATE TRIGGER trg_contest_registration_contests_updated BEFORE UPDATE ON public.contest_registration_contests
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_applications_updated ON public.contest_registration_applications;
CREATE TRIGGER trg_contest_registration_applications_updated BEFORE UPDATE ON public.contest_registration_applications
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_answers_updated ON public.contest_registration_section_answers;
CREATE TRIGGER trg_contest_registration_answers_updated BEFORE UPDATE ON public.contest_registration_section_answers
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_media_updated ON public.contest_registration_media_uploads;
CREATE TRIGGER trg_contest_registration_media_updated BEFORE UPDATE ON public.contest_registration_media_uploads
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_guardian_updated ON public.contest_registration_guardian_consents;
CREATE TRIGGER trg_contest_registration_guardian_updated BEFORE UPDATE ON public.contest_registration_guardian_consents
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_medical_updated ON public.contest_registration_medical_disclosures;
CREATE TRIGGER trg_contest_registration_medical_updated BEFORE UPDATE ON public.contest_registration_medical_disclosures
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_emergency_updated ON public.contest_registration_emergency_contacts;
CREATE TRIGGER trg_contest_registration_emergency_updated BEFORE UPDATE ON public.contest_registration_emergency_contacts
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_payments_updated ON public.contest_registration_payments;
CREATE TRIGGER trg_contest_registration_payments_updated BEFORE UPDATE ON public.contest_registration_payments
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_auditions_updated ON public.contest_registration_auditions;
CREATE TRIGGER trg_contest_registration_auditions_updated BEFORE UPDATE ON public.contest_registration_auditions
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contestant_public_profiles_updated ON public.contestant_public_profiles;
CREATE TRIGGER trg_contestant_public_profiles_updated BEFORE UPDATE ON public.contestant_public_profiles
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_scores_updated ON public.contest_registration_screening_scores;
CREATE TRIGGER trg_contest_registration_scores_updated BEFORE UPDATE ON public.contest_registration_screening_scores
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_fraud_updated ON public.contest_registration_fraud_flags;
CREATE TRIGGER trg_contest_registration_fraud_updated BEFORE UPDATE ON public.contest_registration_fraud_flags
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_consents_updated ON public.contest_registration_consent_records;
CREATE TRIGGER trg_contest_registration_consents_updated BEFORE UPDATE ON public.contest_registration_consent_records
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_referrals_updated ON public.contest_registration_referrals;
CREATE TRIGGER trg_contest_registration_referrals_updated BEFORE UPDATE ON public.contest_registration_referrals
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

DROP TRIGGER IF EXISTS trg_contest_registration_coupons_updated ON public.contest_registration_coupons;
CREATE TRIGGER trg_contest_registration_coupons_updated BEFORE UPDATE ON public.contest_registration_coupons
FOR EACH ROW EXECUTE FUNCTION public.contest_registration_touch_updated_at();

COMMIT;
