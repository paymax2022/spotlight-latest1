-- Paymax Health — Phase 1 PHARMACY vertical.
-- Ref: docs/prd/health/HEALTH-BUILD.md §5 (PharmacyOrder SM), §6 (Pharmacy API),
--      §7A (Pharmacy), invariants HL-1/2/3/4/5/8/9/10/12; root CLAUDE.md NL-1..12.
--
-- ADDITIVE-ONLY. No DROP TABLE / DROP COLUMN / DROP TYPE / RENAME / type narrowing
-- (DROP POLICY IF EXISTS only — the documented re-runnable pattern). Money is
-- BIGINT kobo (NL-8). FKs to auth.users(id) + the Phase-0 health_* tables. RLS:
-- patient owns own orders; pharmacy scoped to owner; service_role full. HL-5:
-- NAFDAC reference required + only REGISTERED products listable (also rejected at
-- write in the Go service). HL-4: is_controlled forbidden at MVP (CHECK = false).
-- HL-9: payment HELD->RELEASE->REFUND rides the existing escrow_holds (escrow_id ref).
-- RBAC health.pharmacy.* seeded.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ============================================================================
-- CATALOG — NAFDAC-gated products (HL-5). A product MUST carry a NAFDAC reference
-- and only a REGISTERED status is listable; unregistered/banned items are rejected
-- at write time by the Go service AND filtered here. rx_required (HL-3) is the
-- config-driven POM flag. is_controlled (HL-4) is forbidden at MVP via CHECK.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pharmacy_products (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pharmacy_provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  name                 text NOT NULL,
  nafdac_ref           text NOT NULL,                 -- HL-5: NAFDAC registration reference (required)
  nafdac_status        text NOT NULL DEFAULT 'REGISTERED'
                         CHECK (nafdac_status IN ('REGISTERED','UNREGISTERED','BANNED','SUSPENDED')),
  rx_required          boolean NOT NULL DEFAULT false, -- HL-3 config-driven POM flag
  -- HL-4: controlled substances excluded at MVP — a true value is rejected at write.
  is_controlled        boolean NOT NULL DEFAULT false CHECK (is_controlled = false),
  price_kobo           bigint NOT NULL CHECK (price_kobo > 0),  -- NL-8 minor units
  stock_qty            int NOT NULL DEFAULT 0 CHECK (stock_qty >= 0),
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- HL-5: a NAFDAC reference must be present for any catalog row.
  CHECK (length(btrim(nafdac_ref)) > 0)
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_products_provider
  ON public.pharmacy_products (pharmacy_provider_id, active);
-- Catalog read path (HL-5: only registered+active surface).
CREATE INDEX IF NOT EXISTS idx_pharmacy_products_listable
  ON public.pharmacy_products (pharmacy_provider_id)
  WHERE active = true AND nafdac_status = 'REGISTERED';

-- ============================================================================
-- ORDERS — PharmacyOrder state machine (HEALTH-BUILD §5). payment HELD on CREATED
-- -> RELEASED on DELIVERED/COLLECTED -> REFUNDED on CANCELLED (HL-9), referencing
-- the shared escrow_holds row by escrow_id. prescription_id pins the e-Rx (HL-3)
-- for Rx-required orders. delivery_ref is the transport last-mile job reference.
-- ============================================================================
CREATE TABLE IF NOT EXISTS public.pharmacy_orders (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  patient_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  pharmacy_provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE,
  prescription_id      uuid REFERENCES public.health_prescriptions(id) ON DELETE SET NULL, -- HL-3 e-Rx
  state                text NOT NULL DEFAULT 'CREATED'
                         CHECK (state IN ('CREATED','RX_PENDING_VERIFICATION','CONFIRMED','DISPENSED',
                                          'IN_DELIVERY','READY_FOR_PICKUP','DELIVERED','COLLECTED',
                                          'CLOSED','CANCELLED','REFUNDED')),
  fulfilment_method    text NOT NULL CHECK (fulfilment_method IN ('DELIVERY','PICKUP')),
  total_kobo           bigint NOT NULL CHECK (total_kobo > 0), -- NL-8 minor units, server-computed
  escrow_id            uuid,                          -- FK-by-ref to escrow_holds (HL-9 funds hold)
  delivery_ref         text,                          -- transport last-mile delivery reference
  pickup_code          text,                          -- one-time pickup credential (PICKUP)
  cancel_reason        text NOT NULL DEFAULT '',
  idempotency_key      text NOT NULL,                 -- HL-9: replay-safe order + money leg
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_patient  ON public.pharmacy_orders (patient_id, state);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_pharmacy ON public.pharmacy_orders (pharmacy_provider_id, state);
CREATE INDEX IF NOT EXISTS idx_pharmacy_orders_rx       ON public.pharmacy_orders (prescription_id);

CREATE TABLE IF NOT EXISTS public.pharmacy_order_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES public.pharmacy_orders(id) ON DELETE CASCADE,
  product_id       uuid NOT NULL REFERENCES public.pharmacy_products(id) ON DELETE RESTRICT,
  product_name     text NOT NULL,
  rx_required      boolean NOT NULL DEFAULT false,    -- HL-3 snapshot at order time
  quantity         int NOT NULL CHECK (quantity > 0),
  unit_price_kobo  bigint NOT NULL CHECK (unit_price_kobo > 0),  -- NL-8
  line_total_kobo  bigint NOT NULL CHECK (line_total_kobo > 0),  -- NL-8
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_order_lines_order ON public.pharmacy_order_lines (order_id);

-- DISPENSE RECORDS — immutable record of the pharmacist's dispense action (HL-1
-- clinical action by the licensed pharmacist; HL-12 audit). dispense-once for the
-- e-Rx itself is enforced upstream by healthrx; here a single row per dispensed
-- order documents who filled it.
CREATE TABLE IF NOT EXISTS public.dispense_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id         uuid NOT NULL REFERENCES public.pharmacy_orders(id) ON DELETE CASCADE,
  prescription_id  uuid REFERENCES public.health_prescriptions(id) ON DELETE SET NULL,
  pharmacist_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dispense_records_order ON public.dispense_records (order_id);
CREATE INDEX IF NOT EXISTS idx_dispense_records_rx    ON public.dispense_records (prescription_id);
-- One dispense record per order (the pharmacist fills an order once).
CREATE UNIQUE INDEX IF NOT EXISTS uq_dispense_records_order ON public.dispense_records (order_id);

-- ============================================================================
-- ROW LEVEL SECURITY — patient owns own orders; pharmacy scoped to owner;
-- service_role full (the Go service writes via service_role; RLS guards direct
-- authenticated reads). public.is_admin() reused from the admin shell.
-- ============================================================================
ALTER TABLE public.pharmacy_products    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_orders      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_order_lines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dispense_records     ENABLE ROW LEVEL SECURITY;

-- Catalog: REGISTERED + active products of any APPROVED pharmacy are readable by
-- authenticated (HL-5 discovery); the owning pharmacy sees its own; admin sees all.
DROP POLICY IF EXISTS pharmacy_products_read ON public.pharmacy_products;
CREATE POLICY pharmacy_products_read ON public.pharmacy_products
  FOR SELECT TO authenticated USING (
    public.is_admin()
    OR (active = true AND nafdac_status = 'REGISTERED')
    OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = pharmacy_products.pharmacy_provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS pharmacy_products_service ON public.pharmacy_products;
CREATE POLICY pharmacy_products_service ON public.pharmacy_products
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Orders: the patient who owns the order, or the owning pharmacy, may read.
DROP POLICY IF EXISTS pharmacy_orders_party ON public.pharmacy_orders;
CREATE POLICY pharmacy_orders_party ON public.pharmacy_orders
  FOR SELECT TO authenticated USING (
    public.is_admin() OR patient_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.health_providers p
      WHERE p.id = pharmacy_orders.pharmacy_provider_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS pharmacy_orders_service ON public.pharmacy_orders;
CREATE POLICY pharmacy_orders_service ON public.pharmacy_orders
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS pharmacy_order_lines_party ON public.pharmacy_order_lines;
CREATE POLICY pharmacy_order_lines_party ON public.pharmacy_order_lines
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.pharmacy_orders o
      WHERE o.id = pharmacy_order_lines.order_id
        AND (o.patient_id = auth.uid() OR EXISTS (
          SELECT 1 FROM public.health_providers p
          WHERE p.id = o.pharmacy_provider_id AND p.owner_user_id = auth.uid()
        ))
    )
  );
DROP POLICY IF EXISTS pharmacy_order_lines_service ON public.pharmacy_order_lines;
CREATE POLICY pharmacy_order_lines_service ON public.pharmacy_order_lines
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Dispense records: the dispensing pharmacist, the order's pharmacy, or admin.
DROP POLICY IF EXISTS dispense_records_party ON public.dispense_records;
CREATE POLICY dispense_records_party ON public.dispense_records
  FOR SELECT TO authenticated USING (
    public.is_admin() OR pharmacist_id = auth.uid() OR EXISTS (
      SELECT 1 FROM public.pharmacy_orders o
      JOIN public.health_providers p ON p.id = o.pharmacy_provider_id
      WHERE o.id = dispense_records.order_id AND p.owner_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS dispense_records_service ON public.dispense_records;
CREATE POLICY dispense_records_service ON public.dispense_records
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ============================================================================
-- RBAC — health.pharmacy.* permissions (admin oversight). Additive.
-- ============================================================================
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Pharmacy PCN Audit (Admin)',         'health.pharmacy.pcn',     'health','pharmacy','view',  'PCN/premises credential audit (HL-2)',            true),
  ('Pharmacy Catalog Governance (Admin)','health.pharmacy.catalog', 'health','pharmacy','manage','Catalog/NAFDAC governance (HL-5)',                true),
  ('Pharmacy Order Oversight (Admin)',   'health.pharmacy.orders',  'health','pharmacy','view',  'Order/delivery oversight',                        true),
  ('Pharmacy Rx/Controlled Audit (Admin)','health.pharmacy.audit',  'health','pharmacy','view',  'Rx/controlled + dispense audit (HL-3/HL-4/HL-12)',true),
  ('Pharmacy Recall (Admin)',            'health.pharmacy.recall',  'health','pharmacy','manage','Pharmacovigilance / product recall',              true),
  ('Pharmacy Payouts (Admin)',           'health.pharmacy.payouts', 'health','pharmacy','manage','Settlement/payout oversight (HL-10)',             true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.pharmacy.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.pharmacy.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

COMMIT;
