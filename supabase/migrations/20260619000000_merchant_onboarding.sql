-- Merchant Onboarding & Role-Upgrade subsystem.
-- Additive-only — no DROP, no RENAME, no type narrowing.
-- Reuses existing RBAC tables: public.roles, public.user_roles, public.audit_logs.
-- All onboarding tables are namespaced onb_* to avoid collisions with generic names.

-- ─── onb_module ───────────────────────────────────────────────────────────────
-- A super-app vertical that can accept merchant onboarding (Health, Marketplace…).
CREATE TABLE IF NOT EXISTS onb_module (
    id          TEXT PRIMARY KEY,
    slug        TEXT NOT NULL UNIQUE,
    name        TEXT NOT NULL,
    description TEXT,
    icon        TEXT,
    icon_color  TEXT,
    bg_color    TEXT,
    status      TEXT NOT NULL DEFAULT 'closed'
                    CHECK (status IN ('open','closed','coming_soon')),
    sort_order  INT  NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS onb_module_status_idx ON onb_module(status);

-- ─── onb_merchant_type ────────────────────────────────────────────────────────
-- A role a user can apply for within a module (Medical Practitioner, Pharmacy…).
CREATE TABLE IF NOT EXISTS onb_merchant_type (
    id                   TEXT PRIMARY KEY,
    module_id            TEXT NOT NULL REFERENCES onb_module(id),
    slug                 TEXT NOT NULL,
    name                 TEXT NOT NULL,
    description          TEXT,
    icon                 TEXT,
    requirements_summary JSONB NOT NULL DEFAULT '[]'::jsonb,
    expected_review_label TEXT,
    required_kyc_tier    INT  NOT NULL DEFAULT 0,
    role_to_grant        TEXT NOT NULL,
    current_form_schema_id TEXT,
    status               TEXT NOT NULL DEFAULT 'closed'
                            CHECK (status IN ('open','closed','coming_soon')),
    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (module_id, slug)
);
CREATE INDEX IF NOT EXISTS onb_merchant_type_module_idx ON onb_merchant_type(module_id);
CREATE INDEX IF NOT EXISTS onb_merchant_type_status_idx ON onb_merchant_type(status);

-- ─── onb_form_schema ──────────────────────────────────────────────────────────
-- A versioned, multi-step form definition for a merchant type.
CREATE TABLE IF NOT EXISTS onb_form_schema (
    id              TEXT PRIMARY KEY,
    merchant_type_id TEXT NOT NULL REFERENCES onb_merchant_type(id),
    version         INT  NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft','published','retired')),
    steps           JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (merchant_type_id, version)
);
CREATE INDEX IF NOT EXISTS onb_form_schema_type_idx ON onb_form_schema(merchant_type_id);

-- ─── onb_application ──────────────────────────────────────────────────────────
-- A user's onboarding application for one (module, merchant_type).
CREATE TABLE IF NOT EXISTS onb_application (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL,
    merchant_type_id   TEXT NOT NULL REFERENCES onb_merchant_type(id),
    form_schema_id     TEXT REFERENCES onb_form_schema(id),
    form_schema_version INT,
    status             TEXT NOT NULL DEFAULT 'DRAFT'
                          CHECK (status IN ('DRAFT','SUBMITTED','UNDER_REVIEW',
                                            'NEEDS_MORE_INFO','APPROVED','REJECTED')),
    data               JSONB NOT NULL DEFAULT '{}'::jsonb,
    checks             JSONB NOT NULL DEFAULT '[]'::jsonb,
    decision_reason    TEXT,
    info_checklist     JSONB NOT NULL DEFAULT '[]'::jsonb,
    submit_idem_key    TEXT,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    submitted_at       TIMESTAMPTZ,
    decided_at         TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS onb_application_user_idx   ON onb_application(user_id);
CREATE INDEX IF NOT EXISTS onb_application_status_idx ON onb_application(status);
CREATE INDEX IF NOT EXISTS onb_application_type_idx   ON onb_application(merchant_type_id);
-- At most one active (non-terminal) application per (user, merchant_type).
CREATE UNIQUE INDEX IF NOT EXISTS onb_application_active_uniq
    ON onb_application(user_id, merchant_type_id)
    WHERE status IN ('DRAFT','SUBMITTED','UNDER_REVIEW','NEEDS_MORE_INFO');

-- ─── onb_merchant_profile ─────────────────────────────────────────────────────
-- The activated merchant identity created on approval.
CREATE TABLE IF NOT EXISTS onb_merchant_profile (
    id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id          UUID NOT NULL,
    module_id        TEXT NOT NULL REFERENCES onb_module(id),
    merchant_type_id TEXT NOT NULL REFERENCES onb_merchant_type(id),
    application_id   UUID REFERENCES onb_application(id),
    role_granted     TEXT NOT NULL,
    status           TEXT NOT NULL DEFAULT 'PROVISIONING'
                        CHECK (status IN ('PROVISIONING','ACTIVE','SUSPENDED',
                                          'OFFBOARDED','UNDER_REVERIFICATION')),
    workspace_route  TEXT,
    activated_at     TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, merchant_type_id)
);
CREATE INDEX IF NOT EXISTS onb_merchant_profile_user_idx ON onb_merchant_profile(user_id);

-- ─── onb_document ─────────────────────────────────────────────────────────────
-- Uploaded supporting documents attached to an application field.
CREATE TABLE IF NOT EXISTS onb_document (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES onb_application(id),
    field_key      TEXT NOT NULL,
    file_url       TEXT NOT NULL,
    file_name      TEXT,
    expires_at     TIMESTAMPTZ,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS onb_document_app_idx ON onb_document(application_id);

-- ─── onb_review_task ──────────────────────────────────────────────────────────
-- A reviewer-facing task tracking the review lifecycle of an application.
CREATE TABLE IF NOT EXISTS onb_review_task (
    id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    application_id UUID NOT NULL REFERENCES onb_application(id),
    status         TEXT NOT NULL DEFAULT 'OPEN'
                        CHECK (status IN ('OPEN','ESCALATED','CLOSED')),
    assigned_to    UUID,
    escalated      BOOLEAN NOT NULL DEFAULT FALSE,
    note           TEXT,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS onb_review_task_app_idx    ON onb_review_task(application_id);
CREATE INDEX IF NOT EXISTS onb_review_task_status_idx ON onb_review_task(status);

-- ─── Seed: roles to grant (reuse existing public.roles) ───────────────────────
INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES
    ('Health Provider',   'health_provider',   'Verified medical practitioner merchant', 'merchant', true),
    ('Pharmacy Provider', 'pharmacy_provider', 'Verified pharmacy merchant',             'merchant', true),
    ('Marketplace Seller','marketplace_seller','Verified marketplace seller merchant',   'merchant', true)
ON CONFLICT (slug) DO NOTHING;

-- ─── Seed: modules ────────────────────────────────────────────────────────────
INSERT INTO onb_module (id, slug, name, description, icon, icon_color, bg_color, status, sort_order)
VALUES
    ('mod-health','health','Health','Offer consultations, run a pharmacy, lab or clinic.',
     'Stethoscope','#EF4444','rgba(239,68,68,0.08)','open',1),
    ('mod-marketplace','marketplace','Marketplace','Sell products to customers across the app.',
     'Store','#3B82F6','rgba(59,130,246,0.08)','open',2),
    ('mod-food','food','Food & Logistics','List a restaurant or join the delivery fleet.',
     'UtensilsCrossed','#F97316','rgba(249,115,22,0.08)','closed',3)
ON CONFLICT (id) DO NOTHING;

-- ─── Seed: merchant types ─────────────────────────────────────────────────────
INSERT INTO onb_merchant_type (id, module_id, slug, name, description, icon,
    requirements_summary, expected_review_label, required_kyc_tier, role_to_grant,
    current_form_schema_id, status)
VALUES
    ('mt-doctor','mod-health','medical-practitioner','Medical Practitioner',
     'Provide video, chat or in-person consultations to patients.','Stethoscope',
     '["Valid MDCN licence","Specialty & years of experience","Govt-issued ID"]'::jsonb,
     '24–48 hours',2,'health_provider','fs-doctor-v2','open'),
    ('mt-pharmacy','mod-health','pharmacy','Pharmacy',
     'Dispense and deliver prescriptions to patients.','Pill',
     '["PCN premises licence","Superintendent pharmacist details","Premises address"]'::jsonb,
     '3–5 business days',2,'pharmacy_provider','fs-pharmacy-v1','open'),
    ('mt-seller','mod-marketplace','seller','Marketplace Seller',
     'List and sell physical goods to customers.','ShoppingBag',
     '["CAC business registration","Settlement bank account","Product categories"]'::jsonb,
     '1–2 business days',1,'marketplace_seller','fs-seller-v1','open')
ON CONFLICT (id) DO NOTHING;

-- ─── Seed: form schemas (mirror mobile merchant.constants.ts) ──────────────────
INSERT INTO onb_form_schema (id, merchant_type_id, version, status, steps) VALUES
('fs-doctor-v2','mt-doctor',2,'published', $json$
[
  {"key":"identity","title":"About you","description":"Tell us who you are.","fields":[
    {"key":"full_name","type":"text","label":"Full name","placeholder":"Dr. Amaka Obi","required":true},
    {"key":"specialty","type":"select","label":"Primary specialty","required":true,"options":[
      {"label":"General Practice","value":"gp"},
      {"label":"Paediatrics","value":"paeds"},
      {"label":"Cardiology","value":"cardio"},
      {"label":"Dermatology","value":"derm"},
      {"label":"Obstetrics & Gynaecology","value":"obgyn"},
      {"label":"Psychiatry","value":"psych"}]},
    {"key":"years_experience","type":"number","label":"Years of experience","placeholder":"e.g. 12","required":true,"min":0,"max":60}]},
  {"key":"credentials","title":"Credentials","description":"We verify these against the MDCN register.","fields":[
    {"key":"license_number","type":"text","label":"MDCN registration number","placeholder":"MDCN/R/45821","required":true},
    {"key":"issuing_body","type":"select","label":"Issuing body","required":true,"options":[
      {"label":"MDCN","value":"mdcn"},{"label":"Other council","value":"other"}]},
    {"key":"license_doc","type":"document","label":"Medical licence","helpText":"PDF, JPG or PNG","required":true,"hasExpiry":true},
    {"key":"government_id","type":"document","label":"Government-issued ID","required":true}]},
  {"key":"practice","title":"Practice & consultation","description":"How you want to consult.","fields":[
    {"key":"consult_modes","type":"multiselect","label":"Consultation modes","required":true,"maxSelections":3,"options":[
      {"label":"Video","value":"video"},{"label":"Chat","value":"chat"},{"label":"In-person","value":"in_person"}]},
    {"key":"consult_fee","type":"currency","label":"Consultation fee","placeholder":"0.00","required":true,"min":0},
    {"key":"has_clinic","type":"boolean","label":"I consult from a physical clinic","required":false},
    {"key":"clinic_address","type":"address","label":"Clinic address","required":true,"visibleWhen":{"field":"has_clinic","equals":true}},
    {"key":"availability","type":"text","label":"Typical availability","placeholder":"e.g. Mon–Fri, 9am–5pm","required":false}]}
]
$json$::jsonb),
('fs-pharmacy-v1','mt-pharmacy',1,'published', $json$
[
  {"key":"business","title":"Pharmacy details","fields":[
    {"key":"pharmacy_name","type":"text","label":"Registered pharmacy name","required":true},
    {"key":"pcn_number","type":"text","label":"PCN premises licence no.","required":true},
    {"key":"pcn_doc","type":"document","label":"PCN premises licence","required":true,"hasExpiry":true}]},
  {"key":"superintendent","title":"Superintendent pharmacist","fields":[
    {"key":"superintendent_name","type":"text","label":"Full name","required":true},
    {"key":"superintendent_pcn","type":"text","label":"Superintendent PCN no.","required":true},
    {"key":"premises_address","type":"address","label":"Premises address","required":true},
    {"key":"delivery_radius","type":"number","label":"Delivery radius (km)","required":false,"min":1,"max":50}]}
]
$json$::jsonb),
('fs-seller-v1','mt-seller',1,'published', $json$
[
  {"key":"business","title":"Business","fields":[
    {"key":"store_name","type":"text","label":"Store name","required":true},
    {"key":"cac_number","type":"text","label":"CAC registration number","required":false},
    {"key":"categories","type":"multiselect","label":"Product categories","required":true,"maxSelections":4,"options":[
      {"label":"Electronics","value":"electronics"},{"label":"Fashion","value":"fashion"},
      {"label":"Home & Living","value":"home"},{"label":"Beauty","value":"beauty"},
      {"label":"Groceries","value":"groceries"}]}]},
  {"key":"settlement","title":"Settlement","fields":[
    {"key":"contact_email","type":"email","label":"Business email","required":true},
    {"key":"contact_phone","type":"phone","label":"Business phone","required":true},
    {"key":"cac_doc","type":"document","label":"CAC certificate","required":false}]}
]
$json$::jsonb)
ON CONFLICT (id) DO NOTHING;

-- ─── Seed: reviewer permission (reuse existing RBAC) ──────────────────────────
INSERT INTO public.permissions(name, slug, module, resource, action, description, is_system_permission)
VALUES
('Review Onboarding','onboarding.review','onboarding','application','review','Can review merchant onboarding applications',true),
('Configure Onboarding','onboarding.configure','onboarding','catalogue','configure','Can configure onboarding modules/types/schemas',true)
ON CONFLICT (slug) DO NOTHING;

-- Grant onboarding permissions to super-admin so there is at least one reviewer.
WITH r AS (SELECT id FROM public.roles WHERE slug = 'super-admin'),
     p AS (SELECT id FROM public.permissions WHERE slug IN ('onboarding.review','onboarding.configure'))
INSERT INTO public.role_permissions(role_id, permission_id)
SELECT r.id, p.id FROM r, p
ON CONFLICT (role_id, permission_id) DO NOTHING;
