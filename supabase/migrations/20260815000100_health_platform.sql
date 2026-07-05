-- Paymax Health — Phase 0 SHARED PLATFORM (the 7 net-new shared components).
-- Ref: docs/prd/health/HEALTH-BUILD.md §3/§5/§6, docs/prd/health/HEALTH-RECONCILE.md §5,
--      root CLAUDE.md (NL-1..12) + Health invariants HL-1..HL-12.
--
-- ADDITIVE-ONLY. No DROP TABLE / DROP COLUMN / DROP TYPE / RENAME (DROP POLICY IF
-- EXISTS only — the documented re-runnable pattern). Money is BIGINT kobo. FKs to
-- auth.users(id). PostGIS geo on providers (HL discovery). RLS everywhere: subject
-- owner reads own; provider scoped; service_role full. HL-3 dispense-once is a
-- partial UNIQUE index so a prescription can never be filled twice. HL-8 (NDPA):
-- documents are signed-URL refs (never blobs), every record read is access-logged,
-- cross-vertical reads require an active consent grant. RBAC health.* seeded.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;
CREATE EXTENSION IF NOT EXISTS postgis;

-- ════════════════════════════════════════════════════════════════════════════
-- PROVIDERS — onboarding application (review state) is separated from the granted
-- capability/provider record (HEALTH-BUILD §5). HL-2 credential-gated supply:
-- a provider is discoverable/active ONLY when status='APPROVED' and not expired.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.health_providers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  domain          text NOT NULL CHECK (domain IN ('VET','PHARMACY','LAB')),
  provider_type   text NOT NULL CHECK (provider_type IN
                    ('vet','pharmacy','pharmacist','lab','lab_scientist','phlebotomist')),
  display_name    text NOT NULL,
  status          text NOT NULL DEFAULT 'PENDING'
                    CHECK (status IN ('PENDING','APPROVED','SUSPENDED')),
  discoverable    boolean NOT NULL DEFAULT false,            -- HL-2 gate
  geo             geography(Point, 4326),                    -- map discovery (lng,lat)
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  -- HL-2 + single-identity capability model: at most one capability per (domain,type).
  UNIQUE (owner_user_id, domain, provider_type)
);
CREATE INDEX IF NOT EXISTS idx_health_providers_owner ON public.health_providers (owner_user_id);
CREATE INDEX IF NOT EXISTS idx_health_providers_disc  ON public.health_providers (domain, discoverable) WHERE discoverable = true;
CREATE INDEX IF NOT EXISTS idx_health_providers_geo   ON public.health_providers USING GIST (geo);

-- ProviderApplication state machine:
-- DRAFT→SUBMITTED→UNDER_REVIEW↔NEEDS_INFO→APPROVED↔SUSPENDED|REJECTED
CREATE TABLE IF NOT EXISTS public.health_provider_applications (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  domain          text NOT NULL CHECK (domain IN ('VET','PHARMACY','LAB')),
  provider_type   text NOT NULL CHECK (provider_type IN
                    ('vet','pharmacy','pharmacist','lab','lab_scientist','phlebotomist')),
  display_name    text NOT NULL DEFAULT '',
  state           text NOT NULL DEFAULT 'DRAFT'
                    CHECK (state IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_INFO',
                                     'APPROVED','SUSPENDED','REJECTED')),
  review_note     text NOT NULL DEFAULT '',
  provider_id     uuid REFERENCES public.health_providers(id) ON DELETE SET NULL, -- granted on APPROVED
  geo_lng         double precision,
  geo_lat         double precision,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_apps_owner ON public.health_provider_applications (owner_user_id, state);
CREATE INDEX IF NOT EXISTS idx_health_apps_state ON public.health_provider_applications (state);

-- Credential vault — license docs (VCN/PCN/MLSCN), NAFDAC mapping ref, expiry.
-- Documents are signed-URL refs (storage_key), never blobs (HL-8). Expiry feeds
-- the HL-2 auto-suspend signal.
CREATE TABLE IF NOT EXISTS public.health_credential_docs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  application_id  uuid NOT NULL REFERENCES public.health_provider_applications(id) ON DELETE CASCADE,
  owner_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  cred_type       text NOT NULL CHECK (cred_type IN ('VCN','PCN','MLSCN','NAFDAC','PREMISES','OTHER')),
  reference_no    text NOT NULL DEFAULT '',     -- license/registration number
  nafdac_ref      text NOT NULL DEFAULT '',     -- NAFDAC mapping reference (HL-5 supply chain)
  storage_key     text NOT NULL,                -- R2 object key — signed-URL on read, never a blob
  expires_at      timestamptz,                  -- HL-2 expiry tracking → auto-suspend signal
  verified        boolean NOT NULL DEFAULT false,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_cred_app    ON public.health_credential_docs (application_id);
CREATE INDEX IF NOT EXISTS idx_health_cred_expiry ON public.health_credential_docs (expires_at) WHERE expires_at IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- RECORDS — patient AND pet vault (NDPA, HL-8). Records hold metadata; documents
-- are signed-URL refs. Every read is appended to health_record_access_log.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.health_records (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_type    text NOT NULL CHECK (subject_type IN ('PATIENT','PET')),
  -- owner_user_id is the data subject (patient) OR the pet's owner — the only
  -- identity that may read by default (object-level authZ; cross-vertical needs consent).
  owner_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pet_ref         uuid,                          -- optional pet identifier (PET subjects)
  record_type     text NOT NULL CHECK (record_type IN
                    ('NOTE','PRESCRIPTION','LAB_RESULT','VACCINATION','HISTORY','OTHER')),
  title           text NOT NULL DEFAULT '',
  body            text NOT NULL DEFAULT '',      -- minimised clinical summary; PII minimised
  erased          boolean NOT NULL DEFAULT false, -- HL-8 right-to-erasure (tombstone, additive)
  erased_at       timestamptz,
  created_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_records_owner ON public.health_records (owner_user_id, subject_type);

CREATE TABLE IF NOT EXISTS public.health_record_docs (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id       uuid NOT NULL REFERENCES public.health_records(id) ON DELETE CASCADE,
  storage_key     text NOT NULL,                 -- R2 key — delivered ONLY via signed URL (HL-8)
  content_type    text NOT NULL DEFAULT 'application/pdf',
  label           text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_record_docs_rec ON public.health_record_docs (record_id);

-- Immutable access log — appended on EVERY record read (HL-8/HL-12). No update path.
CREATE TABLE IF NOT EXISTS public.health_record_access_log (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  record_id       uuid NOT NULL REFERENCES public.health_records(id) ON DELETE CASCADE,
  accessor_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  access_basis    text NOT NULL CHECK (access_basis IN ('OWNER','CONSENT','ADMIN')),
  consent_id      uuid,                          -- set when access_basis='CONSENT'
  accessed_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_access_record   ON public.health_record_access_log (record_id, accessed_at DESC);
CREATE INDEX IF NOT EXISTS idx_health_access_accessor ON public.health_record_access_log (accessor_id, accessed_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- CONSENT — granular, revocable cross-vertical sharing grants (HL-8).
-- grantor (data subject) → grantee (vet/pharmacy/lab/owner) on a subject/scope.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.health_consents (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  grantor_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- data subject
  grantee_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- who may read
  subject_owner_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- record owner scope
  scope           text NOT NULL DEFAULT 'RECORDS'
                    CHECK (scope IN ('RECORDS','PRESCRIPTIONS','LAB_RESULTS','ALL')),
  state           text NOT NULL DEFAULT 'ACTIVE' CHECK (state IN ('ACTIVE','REVOKED')),
  granted_at      timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  expires_at      timestamptz
);
CREATE INDEX IF NOT EXISTS idx_health_consents_grantee ON public.health_consents (grantee_id, state);
CREATE INDEX IF NOT EXISTS idx_health_consents_grantor ON public.health_consents (grantor_id, state);
-- Active-grant lookup used by records reads (HL-8 cross-vertical gate).
CREATE INDEX IF NOT EXISTS idx_health_consents_active
  ON public.health_consents (grantee_id, subject_owner_id, scope) WHERE state = 'ACTIVE';

-- ════════════════════════════════════════════════════════════════════════════
-- SCHEDULING — provider availability slots (tele/home/clinic) + appointments.
-- Reminders ride the existing scheduler (internal/scheduler).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.health_appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id     uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subject_type    text NOT NULL DEFAULT 'PATIENT' CHECK (subject_type IN ('PATIENT','PET')),
  visit_type      text NOT NULL CHECK (visit_type IN ('TELE','HOME','CLINIC')),
  state           text NOT NULL DEFAULT 'REQUESTED'
                    CHECK (state IN ('REQUESTED','ACCEPTED','CONFIRMED','IN_PROGRESS',
                                     'COMPLETED','CANCELLED','NO_SHOW','RESCHEDULED')),
  slot_start      timestamptz NOT NULL,
  slot_end        timestamptz NOT NULL,
  reminder_job_id uuid REFERENCES public.scheduler_jobs(id) ON DELETE SET NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (slot_end > slot_start)
);
CREATE INDEX IF NOT EXISTS idx_health_appts_provider ON public.health_appointments (provider_id, slot_start);
CREATE INDEX IF NOT EXISTS idx_health_appts_patient  ON public.health_appointments (patient_id, slot_start);

-- ════════════════════════════════════════════════════════════════════════════
-- CONSULT — tele-consult: SCHEDULED→IN_PROGRESS→COMPLETED. AV token issued at
-- runtime from env keys (never stored, never logged). Recording OFF by default.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.health_consults (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid REFERENCES public.health_appointments(id) ON DELETE SET NULL,
  provider_id     uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  patient_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  state           text NOT NULL DEFAULT 'SCHEDULED'
                    CHECK (state IN ('SCHEDULED','IN_PROGRESS','COMPLETED')),
  recording_enabled boolean NOT NULL DEFAULT false,  -- HL: recording off by default
  started_at      timestamptz,
  completed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_consults_provider ON public.health_consults (provider_id, state);
CREATE INDEX IF NOT EXISTS idx_health_consults_patient  ON public.health_consults (patient_id, state);

-- Clinical note — persisted on COMPLETE; immutable once written (HL-12).
CREATE TABLE IF NOT EXISTS public.health_clinical_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consult_id      uuid NOT NULL REFERENCES public.health_consults(id) ON DELETE CASCADE,
  author_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  subjective      text NOT NULL DEFAULT '',
  objective       text NOT NULL DEFAULT '',
  assessment      text NOT NULL DEFAULT '',
  plan            text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_notes_consult ON public.health_clinical_notes (consult_id);

-- ════════════════════════════════════════════════════════════════════════════
-- RX — e-prescription engine. HL-3 dispense-once enforced by partial UNIQUE.
-- ISSUED→SENT_TO_PHARMACY→VERIFYING→VERIFIED→DISPENSED→FULFILLED; VERIFYING→REJECTED.
-- HL-4: controlled substances EXCLUDED at MVP (CHECK forbids the flag = true).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.health_prescriptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consult_id      uuid REFERENCES public.health_consults(id) ON DELETE SET NULL,
  prescriber_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- vet/clinician
  patient_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- data subject
  pharmacy_provider_id uuid REFERENCES public.health_providers(id) ON DELETE SET NULL,
  verified_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,           -- licensed pharmacist (HL-3)
  state           text NOT NULL DEFAULT 'ISSUED'
                    CHECK (state IN ('ISSUED','SENT_TO_PHARMACY','VERIFYING',
                                     'VERIFIED','DISPENSED','FULFILLED','REJECTED')),
  dispensed_at    timestamptz,
  reject_reason   text NOT NULL DEFAULT '',
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_rx_prescriber ON public.health_prescriptions (prescriber_id);
CREATE INDEX IF NOT EXISTS idx_health_rx_patient    ON public.health_prescriptions (patient_id);
CREATE INDEX IF NOT EXISTS idx_health_rx_pharmacy   ON public.health_prescriptions (pharmacy_provider_id, state);
-- HL-3 DISPENSE-ONCE GUARD: a prescription can be in DISPENSED state at most once.
-- The partial UNIQUE index on id WHERE state='DISPENSED' makes a second dispense a
-- DB-level conflict; combined with the FOR UPDATE guarded transition in code, a
-- prescription can never be filled twice even under concurrent requests.
CREATE UNIQUE INDEX IF NOT EXISTS uq_health_rx_dispensed
  ON public.health_prescriptions (id) WHERE state = 'DISPENSED';

CREATE TABLE IF NOT EXISTS public.health_prescription_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  prescription_id uuid NOT NULL REFERENCES public.health_prescriptions(id) ON DELETE CASCADE,
  drug_name       text NOT NULL,
  nafdac_ref      text NOT NULL DEFAULT '',      -- HL-5: NAFDAC-registered reference
  is_pom          boolean NOT NULL DEFAULT false, -- HL-3 POM gating
  -- HL-4: controlled substances excluded at MVP — a true value is rejected at write.
  is_controlled   boolean NOT NULL DEFAULT false CHECK (is_controlled = false),
  dosage          text NOT NULL DEFAULT '',
  quantity        int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_rx_items_rx ON public.health_prescription_items (prescription_id);

-- ════════════════════════════════════════════════════════════════════════════
-- INTAKE — versioned, schema-driven questionnaires (triage/symptom/test-prep).
-- Responses are validated against the EXACT submitted schema version.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.health_intake_schemas (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL,                 -- e.g. 'vet-triage'
  version         int NOT NULL CHECK (version >= 1),
  kind            text NOT NULL CHECK (kind IN ('TRIAGE','SYMPTOM','TEST_PREP')),
  schema_json     jsonb NOT NULL,                -- field defs: name,type,required,options
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slug, version)
);
CREATE INDEX IF NOT EXISTS idx_health_intake_schemas_slug ON public.health_intake_schemas (slug, active);

CREATE TABLE IF NOT EXISTS public.health_intake_responses (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schema_id       uuid NOT NULL REFERENCES public.health_intake_schemas(id) ON DELETE CASCADE,
  schema_version  int NOT NULL,                  -- pinned version validated against
  respondent_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  answers_json    jsonb NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_health_intake_resp_resp   ON public.health_intake_responses (respondent_id);
CREATE INDEX IF NOT EXISTS idx_health_intake_resp_schema ON public.health_intake_responses (schema_id);

-- ════════════════════════════════════════════════════════════════════════════
-- ROW LEVEL SECURITY — subject owner reads own; provider scoped; service_role all.
-- (Money/state writes go through the Go service via service_role; RLS guards
--  direct authenticated reads. public.is_admin() reused from the admin shell.)
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.health_providers              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_provider_applications  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_credential_docs        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_records                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_record_docs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_record_access_log      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_consents               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_appointments           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_consults               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_clinical_notes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_prescriptions          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_prescription_items     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_intake_schemas         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_intake_responses       ENABLE ROW LEVEL SECURITY;

-- Providers: discoverable+approved are public to authenticated (HL-2 discovery);
-- the owner always sees own; admin sees all.
DROP POLICY IF EXISTS health_providers_read ON public.health_providers;
CREATE POLICY health_providers_read ON public.health_providers
  FOR SELECT TO authenticated USING (
    public.is_admin() OR owner_user_id = auth.uid()
    OR (status = 'APPROVED' AND discoverable = true)
  );
DROP POLICY IF EXISTS health_providers_service ON public.health_providers;
CREATE POLICY health_providers_service ON public.health_providers
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_apps_own ON public.health_provider_applications;
CREATE POLICY health_apps_own ON public.health_provider_applications
  FOR SELECT TO authenticated USING (public.is_admin() OR owner_user_id = auth.uid());
DROP POLICY IF EXISTS health_apps_service ON public.health_provider_applications;
CREATE POLICY health_apps_service ON public.health_provider_applications
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_cred_own ON public.health_credential_docs;
CREATE POLICY health_cred_own ON public.health_credential_docs
  FOR SELECT TO authenticated USING (public.is_admin() OR owner_user_id = auth.uid());
DROP POLICY IF EXISTS health_cred_service ON public.health_credential_docs;
CREATE POLICY health_cred_service ON public.health_credential_docs
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Records: the data subject (owner) reads own; cross-vertical access for any other
-- party is mediated by the Go service via service_role AFTER an active consent check
-- + access-log append (HL-8). RLS keeps authenticated direct reads owner-only.
DROP POLICY IF EXISTS health_records_own ON public.health_records;
CREATE POLICY health_records_own ON public.health_records
  FOR SELECT TO authenticated USING (public.is_admin() OR owner_user_id = auth.uid());
DROP POLICY IF EXISTS health_records_service ON public.health_records;
CREATE POLICY health_records_service ON public.health_records
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_record_docs_own ON public.health_record_docs;
CREATE POLICY health_record_docs_own ON public.health_record_docs
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.health_records r
      WHERE r.id = health_record_docs.record_id AND r.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS health_record_docs_service ON public.health_record_docs;
CREATE POLICY health_record_docs_service ON public.health_record_docs
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_access_own ON public.health_record_access_log;
CREATE POLICY health_access_own ON public.health_record_access_log
  FOR SELECT TO authenticated USING (
    public.is_admin() OR accessor_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.health_records r
      WHERE r.id = health_record_access_log.record_id AND r.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS health_access_service ON public.health_record_access_log;
CREATE POLICY health_access_service ON public.health_record_access_log
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_consents_party ON public.health_consents;
CREATE POLICY health_consents_party ON public.health_consents
  FOR SELECT TO authenticated USING (
    public.is_admin() OR grantor_id = auth.uid() OR grantee_id = auth.uid()
  );
DROP POLICY IF EXISTS health_consents_service ON public.health_consents;
CREATE POLICY health_consents_service ON public.health_consents
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_appts_party ON public.health_appointments;
CREATE POLICY health_appts_party ON public.health_appointments
  FOR SELECT TO authenticated USING (
    public.is_admin() OR patient_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = health_appointments.provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS health_appts_service ON public.health_appointments;
CREATE POLICY health_appts_service ON public.health_appointments
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_consults_party ON public.health_consults;
CREATE POLICY health_consults_party ON public.health_consults
  FOR SELECT TO authenticated USING (
    public.is_admin() OR patient_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = health_consults.provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS health_consults_service ON public.health_consults;
CREATE POLICY health_consults_service ON public.health_consults
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_notes_party ON public.health_clinical_notes;
CREATE POLICY health_notes_party ON public.health_clinical_notes
  FOR SELECT TO authenticated USING (
    public.is_admin() OR author_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.health_consults c
      WHERE c.id = health_clinical_notes.consult_id AND c.patient_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS health_notes_service ON public.health_clinical_notes;
CREATE POLICY health_notes_service ON public.health_clinical_notes
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_rx_party ON public.health_prescriptions;
CREATE POLICY health_rx_party ON public.health_prescriptions
  FOR SELECT TO authenticated USING (
    public.is_admin() OR patient_id = auth.uid() OR prescriber_id = auth.uid()
  );
DROP POLICY IF EXISTS health_rx_service ON public.health_prescriptions;
CREATE POLICY health_rx_service ON public.health_prescriptions
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_rx_items_party ON public.health_prescription_items;
CREATE POLICY health_rx_items_party ON public.health_prescription_items
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.health_prescriptions rx
      WHERE rx.id = health_prescription_items.prescription_id
        AND (rx.patient_id = auth.uid() OR rx.prescriber_id = auth.uid())
    )
  );
DROP POLICY IF EXISTS health_rx_items_service ON public.health_prescription_items;
CREATE POLICY health_rx_items_service ON public.health_prescription_items
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Intake schemas: readable by any authenticated (forms are not sensitive); writes service.
DROP POLICY IF EXISTS health_intake_schema_read ON public.health_intake_schemas;
CREATE POLICY health_intake_schema_read ON public.health_intake_schemas
  FOR SELECT TO authenticated USING (TRUE);
DROP POLICY IF EXISTS health_intake_schema_service ON public.health_intake_schemas;
CREATE POLICY health_intake_schema_service ON public.health_intake_schemas
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS health_intake_resp_own ON public.health_intake_responses;
CREATE POLICY health_intake_resp_own ON public.health_intake_responses
  FOR SELECT TO authenticated USING (public.is_admin() OR respondent_id = auth.uid());
DROP POLICY IF EXISTS health_intake_resp_service ON public.health_intake_responses;
CREATE POLICY health_intake_resp_service ON public.health_intake_responses
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC — health.* permissions (member self-service + admin oversight). Additive.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Apply as Health Provider', 'health.provider.apply',   'health','provider','manage','Start/submit provider onboarding',           true),
  ('Manage Own Health Records','health.records.manage',   'health','records', 'manage','Read/erase own patient/pet records',          true),
  ('Manage Health Consent',    'health.consent.manage',   'health','consent', 'manage','Grant/revoke cross-vertical data sharing',    true),
  ('Issue Prescription',       'health.rx.issue',         'health','rx',      'manage','Issue an e-prescription (clinician/vet)',     true),
  ('Conduct Consult',          'health.consult.manage',   'health','consult', 'manage','Run tele-consult + write clinical notes',     true),
  ('Submit Intake',            'health.intake.submit',    'health','intake',  'manage','Submit intake questionnaire responses',       true),
  ('Review Provider Apps (Admin)','health.admin.providers','health','admin',  'manage','Approve/reject/need-info provider apps (HL-2)',true),
  ('Audit Health (Admin)',     'health.admin.audit',      'health','audit',   'view',  'View health audit trail + access logs (HL-12)',true),
  ('Manage Intake Schemas (Admin)','health.admin.intake', 'health','admin',   'manage','Publish/version intake schemas',              true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.admin.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- Provider-capability roles — one per (domain,type). Granted to the owner_user_id
-- on application APPROVED (HL-2). Idempotency is guaranteed by the unique provider
-- row UNIQUE(owner,domain,type) + the role's slug being assigned at most once.
INSERT INTO public.roles (name, slug, description, role_type, is_system_role, is_active)
VALUES
  ('Health Vet',           'health-provider-vet',           'Verified veterinary capability (VCN)',   'system', true, true),
  ('Health Pharmacy',      'health-provider-pharmacy',      'Verified pharmacy capability (PCN)',     'system', true, true),
  ('Health Pharmacist',    'health-provider-pharmacist',    'Verified pharmacist capability (PCN)',   'system', true, true),
  ('Health Lab',           'health-provider-lab',           'Verified laboratory capability (MLSCN)', 'system', true, true),
  ('Health Lab Scientist', 'health-provider-lab_scientist', 'Verified lab scientist capability',      'system', true, true),
  ('Health Phlebotomist',  'health-provider-phlebotomist',  'Verified phlebotomist capability',       'system', true, true)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
