-- Migration: preconsult_intake
-- Module: Telemedicine Pre-Consultation Health Intake (extends the health platform)
-- ADDITIVE ONLY. No DROP of tables/columns, no renames, no type narrowing.
--   * The two CHECK-constraint widenings below ADD allowed values (a value-set
--     widening is the accepted additive pattern; the platform migration
--     20260815000100_health_platform.sql is never edited).
--   * Intake binds to existing rows (health_appointments / health_consults /
--     health_intake_responses); host tables are never widened.
--   * Sensitive PHI: RLS enabled on every new table; service_role (Go pgx) writes;
--     access to an intake is restricted in the service to patient + assigned doctor
--     and audit-logged. Answer bodies are never written to access/audit logs.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Widen existing CHECKs (additive value-set widening).
--    a) intake schema kind gains PRE_CONSULT.
--    b) consult state gains the two intake-gate states, making IN_PROGRESS
--       unreachable until intake submit flips the consult to READY_FOR_CONSULT.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.health_intake_schemas DROP CONSTRAINT IF EXISTS health_intake_schemas_kind_check;
ALTER TABLE public.health_intake_schemas
  ADD CONSTRAINT health_intake_schemas_kind_check
  CHECK (kind IN ('TRIAGE','SYMPTOM','TEST_PREP','PRE_CONSULT'));

ALTER TABLE public.health_consults DROP CONSTRAINT IF EXISTS health_consults_state_check;
ALTER TABLE public.health_consults
  ADD CONSTRAINT health_consults_state_check
  CHECK (state IN ('SCHEDULED','INTAKE_PENDING','READY_FOR_CONSULT','IN_PROGRESS','COMPLETED'));

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) health_preconsult_intake — the ConsultIntake link entity (one per appointment).
--    Separate from the answer payload (health_intake_responses) and the consult.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.health_preconsult_intake (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL UNIQUE REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  consult_id      uuid REFERENCES public.health_consults(id) ON DELETE SET NULL,
  patient_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  provider_id     uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  response_id     uuid REFERENCES public.health_intake_responses(id) ON DELETE SET NULL,
  schema_id       uuid REFERENCES public.health_intake_schemas(id) ON DELETE SET NULL,
  status          text NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT','SUBMITTED')),
  consent_version int,                              -- accepted health_consent_version.version
  consent_at      timestamptz,
  -- Captured red-flag outcome (decision-support, never overwrites clinical judgement).
  red_flag_level  int,                              -- triage 1..5 (1 = emergency); NULL = none
  red_flag_severity text CHECK (red_flag_severity IN ('emergency','urgent')),
  red_flag_hits   jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{rule_code, level, severity, routing}]
  attachments     jsonb NOT NULL DEFAULT '[]'::jsonb,  -- [{kind, storage_key, content_type}] (keys only)
  draft_json      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- auto-saved DRAFT answers (pre-submit; cleared into the validated response row on submit)
  submitted_at    timestamptz,
  version         int NOT NULL DEFAULT 0,           -- optimistic lock
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_preconsult_intake_patient  ON public.health_preconsult_intake (patient_id);
CREATE INDEX IF NOT EXISTS idx_preconsult_intake_provider ON public.health_preconsult_intake (provider_id, status);
CREATE INDEX IF NOT EXISTS idx_preconsult_intake_redflag  ON public.health_preconsult_intake (red_flag_severity) WHERE red_flag_severity IS NOT NULL;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) health_redflag_rule — configurable submit-time triage rules (admin A2).
--    The Go evaluator reads match_json; rules can only RAISE urgency. Contract:
--      match_json = { "any_field":["reason_for_visit","symptom_detail"],
--                     "contains":["chest pain", ...],          -- case-insensitive substring
--                     "equals":{"field":"...","value":"..."},  -- optional exact match
--                     "evidence":["s_chest_pain", ...] }       -- optional triage Evidence codes
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.health_redflag_rule (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE,
  label        text NOT NULL,
  match_json   jsonb NOT NULL DEFAULT '{}'::jsonb,
  level        int  NOT NULL CHECK (level BETWEEN 1 AND 5),     -- 1 = emergency-ambulance
  severity     text NOT NULL CHECK (severity IN ('emergency','urgent')),
  routing      text NOT NULL CHECK (routing IN ('EMERGENCY','URGENT_CARE','CRISIS')),
  guidance_key text NOT NULL DEFAULT '',            -- → health_intake_config crisis/guidance copy
  active       boolean NOT NULL DEFAULT true,
  version      int NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) health_consent_version — versioned consent text (admin A4).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.health_consent_version (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  consent_key text NOT NULL DEFAULT 'PRE_CONSULT_INTAKE',
  version     int  NOT NULL,
  locale      text NOT NULL DEFAULT 'en',
  body        text NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (consent_key, version, locale)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) health_intake_access_log — read-trail of who viewed which intake (A9/A10).
--    Append-only; IDs only, never answer bodies.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.health_intake_access_log (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  intake_id    uuid REFERENCES public.health_preconsult_intake(id) ON DELETE CASCADE,
  accessor_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  accessor_role text NOT NULL,                      -- 'doctor' | 'patient' | 'admin'
  action       text NOT NULL,                       -- 'VIEW' | 'EXPORT' | ...
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_intake_access_intake ON public.health_intake_access_log (intake_id, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) health_clinical_vocab — conditions / allergens / medications (admin A3).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.health_clinical_vocab (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind      text NOT NULL CHECK (kind IN ('condition','allergen','medication')),
  code      text NOT NULL,
  label     text NOT NULL,
  active    boolean NOT NULL DEFAULT true,
  version   int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (kind, code)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) health_intake_config — generic versioned config for A1/A5/A6/A7
--    (reminder cadence, doctor-summary section order, crisis/urgent guidance copy,
--    localized strings). One row per key; value is JSON.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.health_intake_config (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  config_key text NOT NULL UNIQUE,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  version    int NOT NULL DEFAULT 1,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- updated_at triggers (reuse shared public.handle_updated_at()).
DROP TRIGGER IF EXISTS trg_preconsult_intake_updated ON public.health_preconsult_intake;
CREATE TRIGGER trg_preconsult_intake_updated BEFORE UPDATE ON public.health_preconsult_intake FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_redflag_rule_updated ON public.health_redflag_rule;
CREATE TRIGGER trg_redflag_rule_updated BEFORE UPDATE ON public.health_redflag_rule FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — patient reads own intake; provider (assigned doctor) read enforced in the
-- service + access-logged; config/vocab/consent are readable; service_role writes.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.health_preconsult_intake ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_redflag_rule      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_consent_version   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_intake_access_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_clinical_vocab    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.health_intake_config     ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS preconsult_intake_own ON public.health_preconsult_intake;
CREATE POLICY preconsult_intake_own ON public.health_preconsult_intake FOR SELECT TO authenticated
  USING (
    auth.uid() = patient_id
    OR EXISTS (SELECT 1 FROM public.health_providers p
               WHERE p.id = health_preconsult_intake.provider_id AND p.owner_user_id = auth.uid())
  );
DROP POLICY IF EXISTS consent_version_read ON public.health_consent_version;
CREATE POLICY consent_version_read ON public.health_consent_version FOR SELECT TO anon, authenticated USING (active = true);
DROP POLICY IF EXISTS clinical_vocab_read ON public.health_clinical_vocab;
CREATE POLICY clinical_vocab_read ON public.health_clinical_vocab FOR SELECT TO anon, authenticated USING (active = true);
DROP POLICY IF EXISTS intake_config_read ON public.health_intake_config;
CREATE POLICY intake_config_read ON public.health_intake_config FOR SELECT TO anon, authenticated USING (true);
-- redflag_rule + access_log: no authenticated policy → service_role only.

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED — defaults (idempotent). NOTE: the PRE_CONSULT intake SCHEMA row
-- (health_intake_schemas) is seeded by the backend intake service in the exact
-- shape its Go validator expects (see backend/internal/health/intake) — not here,
-- to avoid schema_json shape drift.
-- ─────────────────────────────────────────────────────────────────────────────

-- Default red-flag rules. Self-harm/crisis routes to supportive guidance (copy in
-- health_intake_config 'crisis_guidance' / 'urgent_guidance', admin-editable).
INSERT INTO public.health_redflag_rule (code, label, match_json, level, severity, routing, guidance_key) VALUES
  ('chest_pain',     'Chest pain / pressure',
     '{"any_field":["reason_for_visit","symptom_detail"],"contains":["chest pain","chest pressure","tight chest"],"evidence":["s_chest_pain"]}'::jsonb,
     1, 'emergency', 'EMERGENCY', 'urgent_guidance'),
  ('breathing',      'Difficulty breathing',
     '{"any_field":["reason_for_visit","symptom_detail"],"contains":["can''t breathe","cannot breathe","difficulty breathing","shortness of breath","breathless"],"evidence":["s_breathlessness"]}'::jsonb,
     1, 'emergency', 'EMERGENCY', 'urgent_guidance'),
  ('stroke',         'Stroke signs',
     '{"any_field":["reason_for_visit","symptom_detail"],"contains":["face drooping","slurred speech","weakness one side","numbness one side","stroke"]}'::jsonb,
     1, 'emergency', 'EMERGENCY', 'urgent_guidance'),
  ('severe_bleeding','Severe bleeding',
     '{"any_field":["reason_for_visit","symptom_detail"],"contains":["severe bleeding","heavy bleeding","won''t stop bleeding","cannot stop bleeding"]}'::jsonb,
     1, 'emergency', 'EMERGENCY', 'urgent_guidance'),
  ('self_harm',      'Self-harm / suicidal ideation',
     '{"any_field":["reason_for_visit","symptom_detail"],"contains":["suicide","suicidal","kill myself","end my life","harm myself","self harm","self-harm","want to die"]}'::jsonb,
     1, 'emergency', 'CRISIS', 'crisis_guidance')
ON CONFLICT (code) DO NOTHING;

-- Consent v1.
INSERT INTO public.health_consent_version (consent_key, version, locale, body) VALUES
  ('PRE_CONSULT_INTAKE', 1, 'en',
   'The health details you provide here are shared with the doctor assigned to your appointment so they can provide your care. They are stored securely against your health record and used only for your care. You can review or update them any time before your consultation.')
ON CONFLICT (consent_key, version, locale) DO NOTHING;

-- Clinical vocab — common chronic conditions + the controlled allergen set.
INSERT INTO public.health_clinical_vocab (kind, code, label) VALUES
  ('condition','diabetes','Diabetes'),
  ('condition','hypertension','High blood pressure (hypertension)'),
  ('condition','asthma','Asthma'),
  ('condition','sickle_cell','Sickle cell disease'),
  ('condition','heart_disease','Heart disease'),
  ('condition','kidney_disease','Kidney disease'),
  ('condition','epilepsy','Epilepsy / seizures'),
  ('condition','thyroid','Thyroid disorder'),
  ('condition','hiv','HIV'),
  ('condition','ulcer','Peptic ulcer'),
  ('allergen','peanut','Peanut'),
  ('allergen','tree_nut','Tree nut'),
  ('allergen','milk','Milk'),
  ('allergen','egg','Egg'),
  ('allergen','fish','Fish'),
  ('allergen','crustacean_shellfish','Shellfish'),
  ('allergen','soy','Soy'),
  ('allergen','wheat_gluten','Wheat / gluten'),
  ('allergen','sesame','Sesame'),
  ('allergen','penicillin','Penicillin'),
  ('allergen','sulfa','Sulfa drugs'),
  ('allergen','aspirin_nsaid','Aspirin / NSAIDs')
ON CONFLICT (kind, code) DO NOTHING;

-- Config defaults: reminder cadence, doctor-summary section order, guidance copy.
INSERT INTO public.health_intake_config (config_key, value) VALUES
  ('reminder_settings',
     '{"offsets_minutes_before_appointment":[1440,120],"channels":["push","in_app"]}'::jsonb),
  ('summary_section_order',
     '["chief_complaint","symptom_detail","allergies","current_medications","chronic_conditions","pregnancy","vitals","attachments"]'::jsonb),
  ('urgent_guidance',
     '{"title":"This may need urgent care","body":"Some of what you described can be serious. Please seek urgent medical care now rather than waiting for a scheduled consult. If this is an emergency, contact your local emergency services or go to the nearest hospital.","show_emergency_number":true}'::jsonb),
  ('crisis_guidance',
     '{"title":"You deserve support right now","body":"It sounds like you may be going through something very painful. You don''t have to face it alone — talking to a mental health professional or someone you trust can help. If you might act on thoughts of harming yourself, please reach out to a crisis line or contact local emergency services right away.","crisis_line":"","show_emergency_number":true}'::jsonb),
  ('disclaimer',
     '{"text":"This intake is patient-reported information to help your doctor prepare. It is not a diagnosis or medical advice."}'::jsonb)
ON CONFLICT (config_key) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- PRE_CONSULT intake SCHEMA (health_intake_schemas). Authored here in the EXACT
-- shape the Go intake validator expects (backend/internal/health/intake: each
-- field is {name,type,required[,options]} where type ∈ text|number|bool|select).
-- This MUST stay byte-equivalent to preconsult.PreConsultFields() in
-- backend/internal/health/preconsult/schema.go (slug 'pre-consult', version 1).
-- Idempotent: ON CONFLICT (slug,version) DO NOTHING.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.health_intake_schemas (slug, version, kind, schema_json, active) VALUES
  ('pre-consult', 1, 'PRE_CONSULT',
   '[{"name":"reason_for_visit","type":"text","required":true},{"name":"reason_category","type":"select","required":false,"options":["general","skin","respiratory","digestive","mental_health","sexual_health","pain","injury","chronic_followup","other"]},{"name":"symptom_onset","type":"select","required":true,"options":["today","few_days","about_a_week","few_weeks","over_a_month"]},{"name":"symptom_severity","type":"number","required":true},{"name":"symptom_better_worse","type":"text","required":false},{"name":"meds_none","type":"bool","required":false},{"name":"current_medications","type":"text","required":false},{"name":"allergies_none","type":"bool","required":false},{"name":"allergies","type":"text","required":false},{"name":"chronic_conditions","type":"text","required":false},{"name":"chronic_other","type":"text","required":false},{"name":"pregnancy_status","type":"select","required":false,"options":["not_applicable","pregnant","breastfeeding"]},{"name":"smoking","type":"select","required":false,"options":["never","former","current"]},{"name":"alcohol","type":"select","required":false,"options":["never","occasional","weekly","daily"]},{"name":"temp_c","type":"number","required":false},{"name":"bp_systolic","type":"number","required":false},{"name":"bp_diastolic","type":"number","required":false},{"name":"weight_kg","type":"number","required":false},{"name":"height_cm","type":"number","required":false},{"name":"pulse","type":"number","required":false}]'::jsonb,
   true)
ON CONFLICT (slug, version) DO NOTHING;

COMMIT;
