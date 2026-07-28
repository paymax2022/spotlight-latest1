-- Paymax Health — Phase 3 VETERINARY vertical.
-- Ref: docs/prd/health/HEALTH-BUILD.md §5 (Appointment + Consult state machines),
--      §6 (Veterinary API), §7C (Veterinary), invariants
--      HL-1/2/3/8/9/10/11/12; root CLAUDE.md NL-1..12.
--
-- DESIGN DECISION (documented): the Appointment state machine is REUSED from the
-- shared health platform — vet appointments are health_appointments rows with
-- subject_type='PET', driven by the healthscheduling engine (REQUESTED → ACCEPTED
-- → CONFIRMED → IN_PROGRESS → COMPLETED; (any) → CANCELLED|NO_SHOW; CONFIRMED →
-- RESCHEDULED → CONFIRMED). This file does NOT create a parallel vet_appointments
-- table; instead it adds vet_appointment_payments — the HL-9 escrow money leg
-- (HELD on booking → RELEASED on COMPLETED → REFUNDED on CANCELLED) + care-loop
-- refs (consult id, home-visit dispatch, lab referral) pinned 1:1 to the shared
-- appointment row. Pet clinical history REUSES health_records (subject_type='PET',
-- pet_ref=<pet id>); tele-consults REUSE health_consults; e-prescriptions REUSE
-- health_prescriptions; vaccination reminders REUSE the shared scheduler.
--
-- ADDITIVE-ONLY. No DROP TABLE / DROP COLUMN / DROP TYPE / RENAME / type narrowing
-- (DROP POLICY IF EXISTS only — the documented re-runnable pattern). Money is
-- BIGINT kobo (NL-8). FKs to auth.users(id) + the Phase-0 health_* tables. PostGIS
-- vet discovery rides health_providers.geo (already a geography(Point,4326) with a
-- GIST index — no geo column added here). RLS: owner owns own pets/appointments/
-- vaccinations; vet scoped to capability; service_role full. RBAC health.vet.*
-- seeded.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- PETS — owner-scoped animal profiles. The owner (auth.users) is the data-subject
-- anchor for object-level authZ (HL-8: an owner reads only their own pets).
-- Clinical pet history lives in the shared health_records vault (subject='PET').
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  species        text NOT NULL,                      -- e.g. DOG, CAT
  breed          text NOT NULL DEFAULT '',
  sex            text NOT NULL DEFAULT '',
  birth_date     date,
  weight_kg      double precision,
  notes          text NOT NULL DEFAULT '',
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pets_owner ON public.pets (owner_user_id, created_at);

-- ============================================================================
-- VET SERVICES / FEES — a priced service a verified VCN vet offers (HL-2). The
-- appointment total is computed server-side from the pinned service price (NL-8,
-- never client-set). visit_type matches the appointment delivery mode.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vet_services (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id   uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  code          text NOT NULL DEFAULT '',
  name          text NOT NULL,
  visit_type    text NOT NULL CHECK (visit_type IN ('TELE','HOME','CLINIC')),
  price_kobo    bigint NOT NULL CHECK (price_kobo > 0), -- NL-8 minor units
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vet_services_provider ON public.vet_services (provider_id, active);

-- ============================================================================
-- VET APPOINTMENT PAYMENTS — the HL-9 escrow money leg + care-loop refs pinned
-- 1:1 to a shared health_appointments row (subject_type='PET'). payment HELD on
-- booking -> RELEASED on COMPLETED -> REFUNDED on CANCELLED, referencing the
-- shared escrow_holds row by escrow_id. consult_id pins the tele-consult;
-- delivery_ref pins the home-visit dispatch on the transport rail. idempotency_key
-- is UNIQUE so the order + money leg are replay-safe (HL-9).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vet_appointment_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,   -- pet owner / payer
  provider_id     uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  pet_id          uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  service_id      uuid REFERENCES public.vet_services(id) ON DELETE SET NULL,
  visit_type      text NOT NULL CHECK (visit_type IN ('TELE','HOME','CLINIC')),
  total_kobo      bigint NOT NULL CHECK (total_kobo > 0), -- NL-8, server-computed
  escrow_id       uuid,                          -- FK-by-ref to escrow_holds (HL-9)
  pay_state       text NOT NULL DEFAULT 'HELD'
                    CHECK (pay_state IN ('HELD','RELEASED','REFUNDED')),
  consult_id      uuid REFERENCES public.health_consults(id) ON DELETE SET NULL, -- tele-consult ref
  delivery_ref    text,                          -- transport home-visit dispatch reference
  cancel_reason   text NOT NULL DEFAULT '',
  idempotency_key text NOT NULL,                 -- HL-9: replay-safe order + money leg
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (appointment_id),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_vet_pay_owner    ON public.vet_appointment_payments (owner_id, pay_state);
CREATE INDEX IF NOT EXISTS idx_vet_pay_provider ON public.vet_appointment_payments (provider_id, pay_state);

-- ============================================================================
-- VACCINATION SCHEDULES — a due/administered vaccine for a pet. due_at drives the
-- reminder fired on the shared scheduler (REUSE); reminder_job_id pins the job.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vaccination_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pet_id          uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  owner_user_id   uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  vaccine         text NOT NULL,
  due_at          timestamptz NOT NULL,
  administered_at timestamptz,
  reminder_job_id uuid,                          -- FK-by-ref to the shared scheduler job
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vacc_pet   ON public.vaccination_schedules (pet_id, due_at);
CREATE INDEX IF NOT EXISTS idx_vacc_owner ON public.vaccination_schedules (owner_user_id, due_at);

-- ============================================================================
-- VET LAB REFERRALS — care-loop handoff: a vet orders a pet lab test during a
-- consult; the lab vertical owns the LabOrder + its own escrow payment, this row
-- records the referral so the owner can complete the booking against the lab.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.vet_lab_referrals (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  appointment_id  uuid NOT NULL REFERENCES public.health_appointments(id) ON DELETE CASCADE,
  pet_id          uuid NOT NULL REFERENCES public.pets(id) ON DELETE CASCADE,
  owner_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lab_provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  test_ids        uuid[] NOT NULL DEFAULT '{}',
  ordered_by      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE, -- vet owner
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_vet_lab_ref_owner ON public.vet_lab_referrals (owner_id, created_at);

-- ============================================================================
-- ROW LEVEL SECURITY — owner owns own pets/appointments/vaccinations/referrals;
-- the owning vet scoped to owner_user_id of the provider; service_role full (the
-- Go service writes via service_role; RLS guards direct authenticated reads).
-- public.is_admin() reused from the admin shell.
-- ============================================================================
ALTER TABLE public.pets                       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_services               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_appointment_payments   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vaccination_schedules      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vet_lab_referrals          ENABLE ROW LEVEL SECURITY;

-- Pets: the owner reads/owns their own pets; admin sees all (HL-8 object-level).
DROP POLICY IF EXISTS pets_owner ON public.pets;
CREATE POLICY pets_owner ON public.pets
  FOR SELECT TO authenticated USING (
    public.is_admin() OR owner_user_id = auth.uid()
  );
DROP POLICY IF EXISTS pets_service ON public.pets;
CREATE POLICY pets_service ON public.pets
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Vet services: active services of any vet are readable by authenticated
-- (discovery); the owning vet sees its own; admin sees all.
DROP POLICY IF EXISTS vet_services_read ON public.vet_services;
CREATE POLICY vet_services_read ON public.vet_services
  FOR SELECT TO authenticated USING (
    public.is_admin() OR active = true OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = vet_services.provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS vet_services_service ON public.vet_services;
CREATE POLICY vet_services_service ON public.vet_services
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Appointment payments: the owner who booked, or the owning vet, may read.
DROP POLICY IF EXISTS vet_pay_party ON public.vet_appointment_payments;
CREATE POLICY vet_pay_party ON public.vet_appointment_payments
  FOR SELECT TO authenticated USING (
    public.is_admin() OR owner_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = vet_appointment_payments.provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS vet_pay_service ON public.vet_appointment_payments;
CREATE POLICY vet_pay_service ON public.vet_appointment_payments
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Vaccinations: the pet owner + admin may read; service_role full.
DROP POLICY IF EXISTS vacc_owner ON public.vaccination_schedules;
CREATE POLICY vacc_owner ON public.vaccination_schedules
  FOR SELECT TO authenticated USING (
    public.is_admin() OR owner_user_id = auth.uid()
  );
DROP POLICY IF EXISTS vacc_service ON public.vaccination_schedules;
CREATE POLICY vacc_service ON public.vaccination_schedules
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Lab referrals: the owner, the ordering vet, the receiving lab, admin.
DROP POLICY IF EXISTS vet_lab_ref_party ON public.vet_lab_referrals;
CREATE POLICY vet_lab_ref_party ON public.vet_lab_referrals
  FOR SELECT TO authenticated USING (
    public.is_admin() OR owner_id = auth.uid() OR ordered_by = auth.uid() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = vet_lab_referrals.lab_provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS vet_lab_ref_service ON public.vet_lab_referrals;
CREATE POLICY vet_lab_ref_service ON public.vet_lab_referrals
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- RBAC — health.vet.* permissions (admin oversight). Additive.
-- ============================================================================
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Vet VCN Audit (Admin)',          'health.vet.vcn',          'health','vet','view',  'VCN vet credential audit (HL-2/HL-12)',                 true),
  ('Vet Service/Fee Governance (Admin)','health.vet.services',  'health','vet','manage','Service/fee catalog governance',                        true),
  ('Vet Appointment Oversight (Admin)','health.vet.appointments','health','vet','view', 'Appointment oversight',                                 true),
  ('Vet e-Rx Audit (Admin)',         'health.vet.erx',          'health','vet','view',  'E-prescription audit (HL-3/HL-12)',                     true),
  ('Vet Payouts (Admin)',            'health.vet.payouts',      'health','vet','manage','Settlement/payout oversight (HL-10)',                   true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.vet.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.vet.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
