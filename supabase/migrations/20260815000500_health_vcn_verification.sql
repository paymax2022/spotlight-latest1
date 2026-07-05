-- Mode B (document + assisted) VCN verification for the vet module.
-- Additive-only. No DROP TABLE/COLUMN/TYPE, no RENAME, no type narrowing.
--
-- Layers a source-agnostic VerificationRecord on top of the existing
-- health_provider_applications SM + health_credential_docs vault. NDPA: stores
-- only result + reference (reg number, matched-field verdicts, licence expiry) +
-- signed-URL doc ids — never a copy of any external register. Every credential
-- doc read is access-logged (HL-12 / NDPA).
BEGIN;

-- VerificationRecord — the source-agnostic credential verdict (VCN today).
CREATE TABLE IF NOT EXISTS public.health_verification_records (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_application_id   uuid NOT NULL REFERENCES public.health_provider_applications(id),
  capability                text NOT NULL DEFAULT 'vet',
  source                    text NOT NULL DEFAULT 'VCN'  CHECK (source IN ('VCN','PCN','MLSCN')),
  method                    text NOT NULL DEFAULT 'ASSISTED' CHECK (method IN ('ASSISTED','API')),
  status                    text NOT NULL DEFAULT 'PENDING'
                              CHECK (status IN ('PENDING','VERIFIED','NEEDS_INFO','REJECTED')),
  reg_number                text NOT NULL DEFAULT '',
  matched_fields            jsonb NOT NULL DEFAULT '{}'::jsonb,   -- field → match|mismatch|unverifiable
  licence_expiry            date,
  reviewer_id               uuid REFERENCES auth.users(id),
  notes                     text NOT NULL DEFAULT '',
  evidence_doc_ids          text[] NOT NULL DEFAULT '{}',
  consent_at                timestamptz,                          -- NDPA consent to verify
  created_at                timestamptz NOT NULL DEFAULT now(),
  decided_at                timestamptz
);
CREATE INDEX IF NOT EXISTS health_verification_records_app_idx    ON public.health_verification_records(provider_application_id);
CREATE INDEX IF NOT EXISTS health_verification_records_status_idx ON public.health_verification_records(status, created_at);

-- Immutable access log for credential-doc reads (NDPA: every read logged).
CREATE TABLE IF NOT EXISTS public.health_credential_doc_access_log (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  doc_id      uuid NOT NULL REFERENCES public.health_credential_docs(id),
  accessor_id uuid NOT NULL REFERENCES auth.users(id),
  basis       text NOT NULL CHECK (basis IN ('OWNER','REVIEWER')),
  accessed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS health_credential_doc_access_log_doc_idx ON public.health_credential_doc_access_log(doc_id, accessed_at);

-- RLS: a vet reads only their own application's verification record; reviewers/
-- admins read via service_role (the Go service runs server-side). Direct
-- authenticated reads are owner-scoped. public.is_admin() reused from admin shell.
ALTER TABLE public.health_verification_records      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_credential_doc_access_log ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS health_verif_owner_read ON public.health_verification_records;
CREATE POLICY health_verif_owner_read ON public.health_verification_records
  FOR SELECT USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.health_provider_applications a
      WHERE a.id = provider_application_id AND a.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS health_verif_service ON public.health_verification_records;
CREATE POLICY health_verif_service ON public.health_verification_records
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS health_doc_access_admin_read ON public.health_credential_doc_access_log;
CREATE POLICY health_doc_access_admin_read ON public.health_credential_doc_access_log
  FOR SELECT USING (public.is_admin() OR accessor_id = auth.uid());
DROP POLICY IF EXISTS health_doc_access_service ON public.health_credential_doc_access_log;
CREATE POLICY health_doc_access_service ON public.health_credential_doc_access_log
  FOR ALL USING (auth.role() = 'service_role') WITH CHECK (auth.role() = 'service_role');

-- RBAC: the ops reviewer permission. Seeded + granted to admin roles (the vet
-- can NEVER review/decide; object-level no-self-approval enforced in the service).
INSERT INTO public.permissions (slug, description)
VALUES ('health.vet.review', 'Review and decide assisted VCN vet verifications')
ON CONFLICT (slug) DO NOTHING;

INSERT INTO public.role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM public.roles r
CROSS JOIN public.permissions p
WHERE p.slug = 'health.vet.review'
  AND r.slug IN ('super-admin', 'system-admin', 'health-admin')
ON CONFLICT DO NOTHING;

COMMIT;
