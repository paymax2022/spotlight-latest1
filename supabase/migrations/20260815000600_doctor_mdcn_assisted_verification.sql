-- Mode B (document + assisted) MDCN verification for the doctor module.
-- AUGMENTS the existing doctor_verifications system of record — does NOT replace it.
-- Additive-only: widens status CHECKs (no narrowing), adds columns, adds one log
-- table, seeds one RBAC permission.
--
-- The doctor never sees the MDCN portal (https://portal.mdcn.gov.ng/get-doctor-status);
-- they submit MDCN number + name + DOB + documents in-app, an ops reviewer confirms
-- out-of-band against the MDCN register and records the decision, and the doctor's
-- discoverability/capability is granted only on approval (HL-2). NDPA: documents are
-- delivered as access-logged signed URLs; only result + reference are stored.
BEGIN;

-- Widen the verification lifecycle to support the assisted review loop
-- (needs_info) and licence-expiry auto-suspend (suspended). Widening an enum
-- CHECK is additive — no existing value is removed.
ALTER TABLE public.doctor_verifications DROP CONSTRAINT IF EXISTS doctor_verifications_status_check;
ALTER TABLE public.doctor_verifications
  ADD CONSTRAINT doctor_verifications_status_check
  CHECK (status IN ('unsubmitted','pending','needs_info','approved','rejected'));

ALTER TABLE public.doctor_profiles DROP CONSTRAINT IF EXISTS doctor_profiles_verification_check;
ALTER TABLE public.doctor_profiles
  ADD CONSTRAINT doctor_profiles_verification_check
  CHECK (verification IN ('unsubmitted','pending','needs_info','approved','rejected','suspended'));

-- Mode B fields on the verification record (system of record stays the same row).
ALTER TABLE public.doctor_verifications
  ADD COLUMN IF NOT EXISTS source         text NOT NULL DEFAULT 'MDCN'
                            CHECK (source IN ('MDCN')),
  ADD COLUMN IF NOT EXISTS method         text NOT NULL DEFAULT 'ASSISTED'
                            CHECK (method IN ('ASSISTED','API')),
  ADD COLUMN IF NOT EXISTS discipline     text
                            CHECK (discipline IS NULL OR discipline IN ('medical','dental')),
  ADD COLUMN IF NOT EXISTS licence_expiry date,
  ADD COLUMN IF NOT EXISTS matched_fields jsonb NOT NULL DEFAULT '{}'::jsonb, -- name/dob/kyc → match|mismatch|unverifiable
  ADD COLUMN IF NOT EXISTS reviewer_id    uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS consent_at     timestamptz,
  ADD COLUMN IF NOT EXISTS decided_at     timestamptz;

CREATE INDEX IF NOT EXISTS idx_doctor_verifications_licence_expiry
  ON public.doctor_verifications(licence_expiry) WHERE licence_expiry IS NOT NULL;

-- Immutable access log for verification-document reads (NDPA: every read logged).
CREATE TABLE IF NOT EXISTS public.doctor_verification_doc_access_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      uuid NOT NULL REFERENCES public.doctor_verification_documents(id) ON DELETE CASCADE,
  accessor_id uuid NOT NULL REFERENCES auth.users(id),
  basis       text NOT NULL CHECK (basis IN ('OWNER','REVIEWER')),
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_doctor_verif_doc_access_doc
  ON public.doctor_verification_doc_access_log(doc_id, accessed_at);

ALTER TABLE public.doctor_verification_doc_access_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS doctor_verif_doc_access_read ON public.doctor_verification_doc_access_log;
CREATE POLICY doctor_verif_doc_access_read ON public.doctor_verification_doc_access_log
  FOR SELECT USING (public.is_admin() OR accessor_id = auth.uid());
DROP POLICY IF EXISTS doctor_verif_doc_access_service ON public.doctor_verification_doc_access_log;
CREATE POLICY doctor_verif_doc_access_service ON public.doctor_verification_doc_access_log
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- RBAC: the ops reviewer permission for assisted MDCN verification. A doctor can
-- NEVER review/decide; object-level no-self-approval is enforced in the service.
INSERT INTO public.permissions (slug, description)
VALUES ('health.doctor.review', 'Review and decide assisted MDCN doctor verifications')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.slug = 'health.doctor.review'
  AND r.slug IN ('super-admin', 'system-admin', 'health-admin')
ON CONFLICT DO NOTHING;

COMMIT;
