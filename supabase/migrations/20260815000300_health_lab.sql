-- Paymax Health — Phase 2 LABORATORY vertical.
-- Ref: docs/prd/health/HEALTH-BUILD.md §5 (LabOrder + Sample/ChainOfCustody SMs),
--      §6 (Laboratory API), §7B (Laboratory), invariants
--      HL-1/2/6/7/8/9/10/12; root CLAUDE.md NL-1..12.
--
-- ADDITIVE-ONLY. No DROP TABLE / DROP COLUMN / DROP TYPE / RENAME / type narrowing
-- (DROP POLICY IF EXISTS only — the documented re-runnable pattern). Money is
-- BIGINT kobo (NL-8). FKs to auth.users(id) + the Phase-0 health_* tables. RLS:
-- patient owns own orders/results; lab/phlebotomist/scientist scoped to capability;
-- service_role full. HL-6: chain-of-custody events are immutable (append-only, no
-- UPDATE/DELETE policy for authenticated) and accession requires an unbroken chain
-- (enforced in the Go service). HL-7: critical/abnormal results escalate (human
-- notification recorded). HL-8: result release writes to the records vault
-- (consent-gated, signed-URL there). HL-9: payment HELD->RELEASE->REFUND rides the
-- existing escrow_holds (escrow_id ref). RBAC health.lab.* seeded.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- CATALOG — tests + packages. prep_instructions + tat_hours (turnaround) are
-- surfaced to the patient before booking; price_kobo is minor units (NL-8). A
-- test/package is listed only by a verified MLSCN lab (HL-2, enforced in service).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lab_tests (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_provider_id   uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  code              text NOT NULL DEFAULT '',
  name              text NOT NULL,
  specimen          text NOT NULL DEFAULT '',              -- e.g. BLOOD, URINE
  prep_instructions text NOT NULL DEFAULT '',              -- e.g. fasting 8h
  tat_hours         int  NOT NULL DEFAULT 0 CHECK (tat_hours >= 0), -- turnaround
  ref_range         text NOT NULL DEFAULT '',
  price_kobo        bigint NOT NULL CHECK (price_kobo > 0), -- NL-8 minor units
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_tests_provider ON public.lab_tests (lab_provider_id, active);

CREATE TABLE IF NOT EXISTS public.lab_packages (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lab_provider_id   uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  name              text NOT NULL,
  description       text NOT NULL DEFAULT '',
  prep_instructions text NOT NULL DEFAULT '',
  tat_hours         int  NOT NULL DEFAULT 0 CHECK (tat_hours >= 0),
  price_kobo        bigint NOT NULL CHECK (price_kobo > 0), -- NL-8
  test_ids          uuid[] NOT NULL DEFAULT '{}',
  active            boolean NOT NULL DEFAULT true,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_packages_provider ON public.lab_packages (lab_provider_id, active);

-- ============================================================================
-- ORDERS — LabOrder state machine (HEALTH-BUILD §5). payment HELD on CREATED ->
-- RELEASED on RELEASED -> REFUNDED on CANCELLED (HL-9), referencing the shared
-- escrow_holds row by escrow_id. delivery_ref is the transport last-mile job
-- (phlebotomist dispatch / results courier). result_record_id pins the vault
-- record written on release (HL-8).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lab_orders (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  lab_provider_id   uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  state             text NOT NULL DEFAULT 'CREATED'
                      CHECK (state IN ('CREATED','SCHEDULED','SAMPLE_COLLECTED','IN_TRANSIT',
                                       'ACCESSIONED','PROCESSING','RESULT_READY','ESCALATED',
                                       'RELEASED','CLOSED','CANCELLED','REFUNDED')),
  collection_method text NOT NULL CHECK (collection_method IN ('HOME','WALK_IN')),
  total_kobo        bigint NOT NULL CHECK (total_kobo > 0), -- NL-8, server-computed
  escrow_id         uuid,                          -- FK-by-ref to escrow_holds (HL-9)
  delivery_ref      text,                          -- transport last-mile reference
  result_record_id  uuid REFERENCES public.health_records(id) ON DELETE SET NULL, -- HL-8 vault
  cancel_reason     text NOT NULL DEFAULT '',
  idempotency_key   text NOT NULL,                 -- HL-9: replay-safe order + money leg
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_lab_orders_patient ON public.lab_orders (patient_id, state);
CREATE INDEX IF NOT EXISTS idx_lab_orders_lab     ON public.lab_orders (lab_provider_id, state);

CREATE TABLE IF NOT EXISTS public.lab_order_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES public.lab_orders(id) ON DELETE CASCADE,
  test_id          uuid NOT NULL REFERENCES public.lab_tests(id) ON DELETE RESTRICT,
  test_name        text NOT NULL,
  unit_price_kobo  bigint NOT NULL CHECK (unit_price_kobo > 0), -- NL-8
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_order_lines_order ON public.lab_order_lines (order_id);

-- ============================================================================
-- SAMPLES — one specimen per order, tracked through the chain of custody (HL-6).
-- A BREACHED / RECOLLECT_REQUIRED sample can never be accessioned and yields no
-- result (enforced in the Go service).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lab_samples (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id          uuid NOT NULL REFERENCES public.lab_orders(id) ON DELETE CASCADE,
  state             text NOT NULL DEFAULT 'COLLECTED'
                      CHECK (state IN ('COLLECTED','IN_CUSTODY','HANDED_OVER','ACCESSIONED',
                                       'BREACHED','RECOLLECT_REQUIRED')),
  collection_method text NOT NULL CHECK (collection_method IN ('HOME','WALK_IN')),
  custodian_id      uuid REFERENCES auth.users(id) ON DELETE SET NULL, -- current holder
  barcode_ref       text NOT NULL,
  collected_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  collected_at      timestamptz NOT NULL DEFAULT now()
);
-- One sample per order (HL-6: the order's specimen is a single tracked entity).
CREATE UNIQUE INDEX IF NOT EXISTS uq_lab_samples_order ON public.lab_samples (order_id);
CREATE INDEX IF NOT EXISTS idx_lab_samples_state ON public.lab_samples (state);

-- ============================================================================
-- CHAIN-OF-CUSTODY EVENTS — IMMUTABLE, append-only (HL-6/HL-12). One row per
-- sample transition / handover. There is intentionally NO update/delete policy for
-- authenticated; service_role inserts only. The unbroken chain is the precondition
-- for accession (enforced in the Go service).
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lab_custody_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sample_id       uuid NOT NULL REFERENCES public.lab_samples(id) ON DELETE CASCADE,
  from_state      text NOT NULL DEFAULT '',
  to_state        text NOT NULL,
  actor_id        uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  from_custodian  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  to_custodian    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note            text NOT NULL DEFAULT '',
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_custody_sample ON public.lab_custody_events (sample_id, occurred_at);

-- ============================================================================
-- RESULTS — scientist-entered, validated lines. status drives HL-7 escalation;
-- escalated_at marks the human-escalation point; released_at marks sign-off
-- release (HL-7/HL-8). The authoritative copy is written to the records vault on
-- release; this table backs the structured in-app viewer.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lab_results (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id        uuid NOT NULL REFERENCES public.lab_orders(id) ON DELETE CASCADE,
  test_id         uuid NOT NULL REFERENCES public.lab_tests(id) ON DELETE RESTRICT,
  test_name       text NOT NULL,
  value           text NOT NULL DEFAULT '',
  unit            text NOT NULL DEFAULT '',
  ref_range       text NOT NULL DEFAULT '',
  status          text NOT NULL CHECK (status IN ('NORMAL','ABNORMAL','CRITICAL')), -- HL-7
  validated_by    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  released_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  escalated_at    timestamptz,                   -- HL-7 human escalation point
  released_at     timestamptz,                   -- HL-7/HL-8 sign-off release
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_results_order ON public.lab_results (order_id);
CREATE INDEX IF NOT EXISTS idx_lab_results_status ON public.lab_results (status)
  WHERE status IN ('ABNORMAL','CRITICAL');

-- ============================================================================
-- CRITICAL NOTIFICATIONS — durable record of the HL-7 human escalation (patient +
-- clinician), so a critical/abnormal result is never a silent in-app flag.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.lab_critical_notifications (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id    uuid NOT NULL REFERENCES public.lab_orders(id) ON DELETE CASCADE,
  patient_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  status      text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_lab_critical_order ON public.lab_critical_notifications (order_id);

-- ============================================================================
-- ROW LEVEL SECURITY — patient owns own orders/results; the owning lab scoped to
-- owner; the sample custodian/collector scoped to self; service_role full (the Go
-- service writes via service_role; RLS guards direct authenticated reads).
-- public.is_admin() reused from the admin shell.
-- ============================================================================
ALTER TABLE public.lab_tests                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_packages               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_orders                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_order_lines            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_samples                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_custody_events         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_results                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_critical_notifications ENABLE ROW LEVEL SECURITY;

-- Catalog: active tests/packages of any lab are readable by authenticated
-- (discovery); the owning lab sees its own; admin sees all.
DROP POLICY IF EXISTS lab_tests_read ON public.lab_tests;
CREATE POLICY lab_tests_read ON public.lab_tests
  FOR SELECT TO authenticated USING (
    public.is_admin() OR active = true OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = lab_tests.lab_provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS lab_tests_service ON public.lab_tests;
CREATE POLICY lab_tests_service ON public.lab_tests
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS lab_packages_read ON public.lab_packages;
CREATE POLICY lab_packages_read ON public.lab_packages
  FOR SELECT TO authenticated USING (
    public.is_admin() OR active = true OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = lab_packages.lab_provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS lab_packages_service ON public.lab_packages;
CREATE POLICY lab_packages_service ON public.lab_packages
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Orders: the patient who owns the order, or the owning lab, may read.
DROP POLICY IF EXISTS lab_orders_party ON public.lab_orders;
CREATE POLICY lab_orders_party ON public.lab_orders
  FOR SELECT TO authenticated USING (
    public.is_admin() OR patient_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = lab_orders.lab_provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS lab_orders_service ON public.lab_orders;
CREATE POLICY lab_orders_service ON public.lab_orders
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS lab_order_lines_party ON public.lab_order_lines;
CREATE POLICY lab_order_lines_party ON public.lab_order_lines
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.lab_orders o
      WHERE o.id = lab_order_lines.order_id
        AND (o.patient_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.health_providers p
          WHERE p.id = o.lab_provider_id AND p.owner_user_id = auth.uid()
        ))
    )
  );
DROP POLICY IF EXISTS lab_order_lines_service ON public.lab_order_lines;
CREATE POLICY lab_order_lines_service ON public.lab_order_lines
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Samples: the patient (own order), the owning lab, the collector/custodian, admin.
DROP POLICY IF EXISTS lab_samples_party ON public.lab_samples;
CREATE POLICY lab_samples_party ON public.lab_samples
  FOR SELECT TO authenticated USING (
    public.is_admin() OR collected_by = auth.uid() OR custodian_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.lab_orders o
      WHERE o.id = lab_samples.order_id
        AND (o.patient_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.health_providers p
          WHERE p.id = o.lab_provider_id AND p.owner_user_id = auth.uid()
        ))
    )
  );
DROP POLICY IF EXISTS lab_samples_service ON public.lab_samples;
CREATE POLICY lab_samples_service ON public.lab_samples
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Custody events: IMMUTABLE (HL-6). Authenticated parties may only SELECT (no
-- INSERT/UPDATE/DELETE policy → those are denied for authenticated); service_role
-- inserts only and never updates/deletes (the Go service appends, never mutates).
DROP POLICY IF EXISTS lab_custody_read ON public.lab_custody_events;
CREATE POLICY lab_custody_read ON public.lab_custody_events
  FOR SELECT TO authenticated USING (
    public.is_admin() OR actor_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.lab_samples sm
      JOIN public.lab_orders o ON o.id = sm.order_id
      WHERE sm.id = lab_custody_events.sample_id
        AND (o.patient_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.health_providers p
          WHERE p.id = o.lab_provider_id AND p.owner_user_id = auth.uid()
        ))
    )
  );
DROP POLICY IF EXISTS lab_custody_service_insert ON public.lab_custody_events;
CREATE POLICY lab_custody_service_insert ON public.lab_custody_events
  FOR INSERT TO service_role WITH CHECK (TRUE);
DROP POLICY IF EXISTS lab_custody_service_read ON public.lab_custody_events;
CREATE POLICY lab_custody_service_read ON public.lab_custody_events
  FOR SELECT TO service_role USING (TRUE);

-- Results: the patient (own order), the owning lab, admin (HL-8 object-level).
DROP POLICY IF EXISTS lab_results_party ON public.lab_results;
CREATE POLICY lab_results_party ON public.lab_results
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.lab_orders o
      WHERE o.id = lab_results.order_id
        AND (o.patient_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.health_providers p
          WHERE p.id = o.lab_provider_id AND p.owner_user_id = auth.uid()
        ))
    )
  );
DROP POLICY IF EXISTS lab_results_service ON public.lab_results;
CREATE POLICY lab_results_service ON public.lab_results
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Critical notifications: the patient + admin may read; service_role full.
DROP POLICY IF EXISTS lab_critical_party ON public.lab_critical_notifications;
CREATE POLICY lab_critical_party ON public.lab_critical_notifications
  FOR SELECT TO authenticated USING (
    public.is_admin() OR patient_id = auth.uid()
  );
DROP POLICY IF EXISTS lab_critical_service ON public.lab_critical_notifications;
CREATE POLICY lab_critical_service ON public.lab_critical_notifications
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- RBAC — health.lab.* permissions (admin oversight). Additive.
-- ============================================================================
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Lab MLSCN Audit (Admin)',        'health.lab.mlscn',       'health','lab','view',  'MLSCN lab/scientist credential audit (HL-2)',           true),
  ('Lab Catalog Governance (Admin)', 'health.lab.catalog',     'health','lab','manage','Test/package catalog governance',                       true),
  ('Lab Order Oversight (Admin)',    'health.lab.orders',      'health','lab','view',  'Order/results oversight',                               true),
  ('Lab Chain-of-Custody (Admin)',   'health.lab.custody',     'health','lab','view',  'Chain-of-custody oversight (HL-6/HL-12)',               true),
  ('Lab Results Audit (Admin)',      'health.lab.results',     'health','lab','view',  'Results audit & release controls (HL-8/HL-12)',         true),
  ('Lab Escalation (Admin)',         'health.lab.escalation',  'health','lab','view',  'Critical-result escalation oversight (HL-7)',           true),
  ('Lab Phlebotomist Mgmt (Admin)',  'health.lab.phlebotomist','health','lab','manage','Phlebotomist management',                               true),
  ('Lab Payouts (Admin)',            'health.lab.payouts',     'health','lab','manage','Settlement/payout oversight (HL-10)',                   true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.lab.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.lab.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
