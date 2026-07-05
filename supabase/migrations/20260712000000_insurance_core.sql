-- Paymax Insurance / Protection — Core (IB0)
-- Ref: docs/prd/Insurance/PRD_Paymax_Microinsurance_Integration.md §9.2 (data model),
--      docs/prd/Insurance/INSURANCE-BUILD-PLAN.md §3 (shared DB contract IB0 owns).
--
-- ADDITIVE-ONLY: CREATE TABLE/INDEX/POLICY IF NOT EXISTS, idempotent seeds.
--   NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing.
--   DROP POLICY IF EXISTS is used only to re-create policies idempotently.
-- Money columns are BIGINT kobo (minor units). FKs to auth.users(id).
--
-- Money movement REUSES the finance ledger/wallet (ledger_accounts/ledger_entries);
-- these tables carry ONLY domain references to the posted ledger entries — no
-- balance column is ever added. Reuses public.is_admin() + public.handle_updated_at().
-- RLS on every table with a service_role bypass (engine writes via service-role).

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- CATALOG — versioned products; product.provider IS the routing table (single
-- source of truth: product_line → provider derives from these rows).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_products (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code                      text NOT NULL UNIQUE,
  display_name              text NOT NULL,
  product_line              text NOT NULL,
  provider                  text NOT NULL,                 -- aggregator key: mycover | octamile
  provider_product_code     text NOT NULL,
  binding_mode              text NOT NULL DEFAULT 'direct'
                              CHECK (binding_mode IN ('direct','embedded')),
  underwriter_display       text NOT NULL DEFAULT '',      -- disclosed risk-carrier (surfaced from provider)
  premium_model             text NOT NULL DEFAULT 'fixed',
  required_kyc_tier         int  NOT NULL DEFAULT 0 CHECK (required_kyc_tier BETWEEN 0 AND 3),
  required_fields_schema_ref jsonb NOT NULL DEFAULT '{}'::jsonb,
  sum_insured_rules         jsonb NOT NULL DEFAULT '{}'::jsonb,
  cancellation_policy_ref   text NOT NULL DEFAULT '',
  version                   int  NOT NULL DEFAULT 1,
  active                    boolean NOT NULL DEFAULT false,
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_products_line_active
  ON public.insurance_products (product_line, active);
CREATE INDEX IF NOT EXISTS idx_insurance_products_provider
  ON public.insurance_products (provider);

-- Optional explicit routing override table (product_line → provider). The catalog
-- service derives routing from products.provider, so this is a future hook only.
CREATE TABLE IF NOT EXISTS public.insurance_routing (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_line  text NOT NULL UNIQUE,
  provider      text NOT NULL,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

-- ════════════════════════════════════════════════════════════════════════════
-- QUOTES — ephemeral, TTL-bounded; carry provider ref + disclosure for bind.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_quote (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_code       text NOT NULL,
  provider           text NOT NULL,
  underwriter        text NOT NULL DEFAULT '',
  provider_quote_ref text NOT NULL DEFAULT '',
  premium_kobo       bigint NOT NULL CHECK (premium_kobo >= 0),
  sum_insured_kobo   bigint NOT NULL CHECK (sum_insured_kobo >= 0),
  currency           text NOT NULL DEFAULT 'NGN',
  commission_kobo    bigint NOT NULL DEFAULT 0 CHECK (commission_kobo >= 0),
  terms              jsonb NOT NULL DEFAULT '{}'::jsonb,
  expires_at         timestamptz NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_quote_user
  ON public.insurance_quote (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_insurance_quote_expires
  ON public.insurance_quote (expires_at);

-- ════════════════════════════════════════════════════════════════════════════
-- POLICY — guarded lifecycle projection (state machine lives in the backend).
-- provider_policy_ref is set after a successful bind; UNIQUE(provider, ref).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_policy (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policyholder_user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_code         text NOT NULL,
  provider             text NOT NULL,                       -- aggregator
  provider_policy_ref  text,                                -- NULL until bound
  underwriter          text NOT NULL DEFAULT '',            -- disclosed (from provider)
  binding_mode         text NOT NULL DEFAULT 'direct'
                         CHECK (binding_mode IN ('direct','embedded')),
  state                text NOT NULL DEFAULT 'QUOTED'
                         CHECK (state IN ('QUOTED','PENDING_PAYMENT','BINDING','ACTIVE',
                                          'RENEWAL_DUE','CANCELLED','EXPIRED',
                                          'BIND_FAILED','PAYMENT_FAILED','VOID')),
  sum_insured_kobo     bigint NOT NULL DEFAULT 0 CHECK (sum_insured_kobo >= 0),
  premium_amount_kobo  bigint NOT NULL DEFAULT 0 CHECK (premium_amount_kobo >= 0),
  currency             text NOT NULL DEFAULT 'NGN',
  commission_kobo      bigint NOT NULL DEFAULT 0 CHECK (commission_kobo >= 0),
  certificate_ref      text,
  effective_at         timestamptz,
  expires_at           timestamptz,
  source_event_id      text,                                -- embedded binds only
  version              int NOT NULL DEFAULT 1,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
-- One provider policy ref is globally unique per aggregator.
CREATE UNIQUE INDEX IF NOT EXISTS uq_insurance_policy_provider_ref
  ON public.insurance_policy (provider, provider_policy_ref)
  WHERE provider_policy_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_insurance_policy_holder_state
  ON public.insurance_policy (policyholder_user_id, state);
CREATE INDEX IF NOT EXISTS idx_insurance_policy_product_state
  ON public.insurance_policy (product_code, state);
CREATE INDEX IF NOT EXISTS idx_insurance_policy_expires
  ON public.insurance_policy (expires_at);
-- Embedded binds are idempotent on source_event_id.
CREATE UNIQUE INDEX IF NOT EXISTS uq_insurance_policy_source_event
  ON public.insurance_policy (source_event_id)
  WHERE source_event_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════
-- PREMIUM TRANSACTION — domain record of each premium money move; references the
-- ledger entry. idempotency_key UNIQUE makes a retried debit a safe no-op.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_premium_transaction (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id               uuid NOT NULL REFERENCES public.insurance_policy(id) ON DELETE CASCADE,
  wallet_ledger_ref       text NOT NULL,
  idempotency_key         text NOT NULL UNIQUE,
  amount_kobo             bigint NOT NULL CHECK (amount_kobo >= 0),
  direction               text NOT NULL DEFAULT 'DEBIT'
                            CHECK (direction IN ('DEBIT','REVERSAL')),
  status                  text NOT NULL DEFAULT 'posted'
                            CHECK (status IN ('posted','reversed')),
  provider_remittance_ref text,
  created_at              timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_premium_tx_policy
  ON public.insurance_premium_transaction (policy_id, created_at DESC);

-- ════════════════════════════════════════════════════════════════════════════
-- BENEFICIARY
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_beneficiary (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id     uuid NOT NULL REFERENCES public.insurance_policy(id) ON DELETE CASCADE,
  full_name     text NOT NULL,
  relationship  text NOT NULL DEFAULT '',
  share_percent int  NOT NULL DEFAULT 100 CHECK (share_percent BETWEEN 1 AND 100),
  phone         text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_beneficiary_policy
  ON public.insurance_beneficiary (policy_id);

-- ════════════════════════════════════════════════════════════════════════════
-- PREMIUM SCHEDULE — recurring / one-off premium billing (bill-pay link).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_premium_schedule (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  policy_id     uuid NOT NULL REFERENCES public.insurance_policy(id) ON DELETE CASCADE,
  cadence       text NOT NULL DEFAULT 'one_off'
                  CHECK (cadence IN ('one_off','monthly','quarterly','annual')),
  amount_kobo   bigint NOT NULL CHECK (amount_kobo >= 0),
  next_due_at   timestamptz,
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_insurance_premium_schedule_due
  ON public.insurance_premium_schedule (active, next_due_at);

-- ════════════════════════════════════════════════════════════════════════════
-- CONSENT — versioned NDPA consent; gates any provider PII data-share.
-- UNIQUE(user, product, version, scope) makes re-grant idempotent.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.insurance_consent (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  product_code  text NOT NULL,
  version       text NOT NULL,
  scope         text NOT NULL DEFAULT 'provider_data_share',
  granted_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, product_code, version, scope)
);
CREATE INDEX IF NOT EXISTS idx_insurance_consent_user
  ON public.insurance_consent (user_id, product_code);

-- ════════════════════════════════════════════════════════════════════════════
-- updated_at triggers (reuse the shared helper).
-- ════════════════════════════════════════════════════════════════════════════
DROP TRIGGER IF EXISTS trg_insurance_products_updated ON public.insurance_products;
CREATE TRIGGER trg_insurance_products_updated BEFORE UPDATE ON public.insurance_products
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_insurance_routing_updated ON public.insurance_routing;
CREATE TRIGGER trg_insurance_routing_updated BEFORE UPDATE ON public.insurance_routing
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_insurance_policy_updated ON public.insurance_policy;
CREATE TRIGGER trg_insurance_policy_updated BEFORE UPDATE ON public.insurance_policy
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_insurance_premium_schedule_updated ON public.insurance_premium_schedule;
CREATE TRIGGER trg_insurance_premium_schedule_updated BEFORE UPDATE ON public.insurance_premium_schedule
  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; owner SELECT; service_role bypass.
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.insurance_products              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_routing               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_quote                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_policy                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_premium_transaction   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_beneficiary           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_premium_schedule      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.insurance_consent               ENABLE ROW LEVEL SECURITY;

-- Catalog + routing: public read of ACTIVE products to authenticated; admin reads
-- all; service_role full.
DROP POLICY IF EXISTS insurance_products_read ON public.insurance_products;
CREATE POLICY insurance_products_read ON public.insurance_products
  FOR SELECT TO authenticated USING (active = true OR public.is_admin());
DROP POLICY IF EXISTS insurance_products_service ON public.insurance_products;
CREATE POLICY insurance_products_service ON public.insurance_products
  TO service_role USING (TRUE) WITH CHECK (TRUE);

DROP POLICY IF EXISTS insurance_routing_admin ON public.insurance_routing;
CREATE POLICY insurance_routing_admin ON public.insurance_routing
  FOR SELECT TO authenticated USING (public.is_admin());
DROP POLICY IF EXISTS insurance_routing_service ON public.insurance_routing;
CREATE POLICY insurance_routing_service ON public.insurance_routing
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Quote: owner select.
DROP POLICY IF EXISTS insurance_quote_own ON public.insurance_quote;
CREATE POLICY insurance_quote_own ON public.insurance_quote
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS insurance_quote_service ON public.insurance_quote;
CREATE POLICY insurance_quote_service ON public.insurance_quote
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Policy: owner select (object-level ownership).
DROP POLICY IF EXISTS insurance_policy_own ON public.insurance_policy;
CREATE POLICY insurance_policy_own ON public.insurance_policy
  FOR SELECT TO authenticated USING (policyholder_user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS insurance_policy_service ON public.insurance_policy;
CREATE POLICY insurance_policy_service ON public.insurance_policy
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Premium transaction: owner-of-policy select; service_role full.
DROP POLICY IF EXISTS insurance_premium_tx_own ON public.insurance_premium_transaction;
CREATE POLICY insurance_premium_tx_own ON public.insurance_premium_transaction
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.insurance_policy p
      WHERE p.id = insurance_premium_transaction.policy_id
        AND p.policyholder_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS insurance_premium_tx_service ON public.insurance_premium_transaction;
CREATE POLICY insurance_premium_tx_service ON public.insurance_premium_transaction
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Beneficiary: owner-of-policy select; service_role full.
DROP POLICY IF EXISTS insurance_beneficiary_own ON public.insurance_beneficiary;
CREATE POLICY insurance_beneficiary_own ON public.insurance_beneficiary
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.insurance_policy p
      WHERE p.id = insurance_beneficiary.policy_id
        AND p.policyholder_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS insurance_beneficiary_service ON public.insurance_beneficiary;
CREATE POLICY insurance_beneficiary_service ON public.insurance_beneficiary
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Premium schedule: owner-of-policy select; service_role full.
DROP POLICY IF EXISTS insurance_premium_schedule_own ON public.insurance_premium_schedule;
CREATE POLICY insurance_premium_schedule_own ON public.insurance_premium_schedule
  FOR SELECT TO authenticated USING (
    public.is_admin() OR EXISTS (
      SELECT 1 FROM public.insurance_policy p
      WHERE p.id = insurance_premium_schedule.policy_id
        AND p.policyholder_user_id = auth.uid()
    )
  );
DROP POLICY IF EXISTS insurance_premium_schedule_service ON public.insurance_premium_schedule;
CREATE POLICY insurance_premium_schedule_service ON public.insurance_premium_schedule
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- Consent: owner select + owner insert (a user grants their own consent).
DROP POLICY IF EXISTS insurance_consent_own ON public.insurance_consent;
CREATE POLICY insurance_consent_own ON public.insurance_consent
  FOR SELECT TO authenticated USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS insurance_consent_service ON public.insurance_consent;
CREATE POLICY insurance_consent_service ON public.insurance_consent
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- RBAC permissions (additive; ON CONFLICT DO NOTHING).
-- Reuses the enterprise RBAC tables (permissions / roles / role_permissions).
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('View Insurance Catalog',         'insurance.catalog.view',          'insurance','catalog',       'view',   'View insurance product catalog',                 true),
  ('Manage Insurance Catalog',       'insurance.catalog.manage',        'insurance','catalog',       'manage', 'Create/activate insurance products',             true),
  ('Manage Insurance Routing',       'insurance.routing.manage',        'insurance','routing',       'manage', 'Re-route a product to a different aggregator',    true),
  ('Manage Insurance Provider',      'insurance.provider.manage',       'insurance','provider',      'manage', 'Manage provider/aggregator configuration',       true),
  ('View Insurance Policies',        'insurance.policy.view',           'insurance','policy',        'view',   'Search/view policies across users',              true),
  ('View Insurance Claims',          'insurance.claim.view',            'insurance','claim',         'view',   'View claims across users',                       true),
  ('Manage Insurance Claims',        'insurance.claim.manage',          'insurance','claim',         'manage', 'Assess/decide/settle claims',                    true),
  ('View Insurance Reconciliation',  'insurance.reconciliation.view',   'insurance','reconciliation','view',   'View provider reconciliation records',           true),
  ('Resolve Insurance Reconciliation','insurance.reconciliation.resolve','insurance','reconciliation','resolve','Resolve reconciliation breaks',                 true),
  ('View Insurance Commission',      'insurance.commission.view',       'insurance','commission',    'view',   'View insurance commission ledger',               true),
  ('Manage Insurance Refunds',       'insurance.refund.manage',         'insurance','refund',        'manage', 'Action the insurance refund queue',              true),
  ('View Insurance Audit',           'insurance.audit.view',            'insurance','audit',         'view',   'View/export insurance audit + consent log',      true)
ON CONFLICT (slug) DO NOTHING;

-- Grant the full insurance.* set to super-admin and system-admin.
WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'insurance.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'insurance.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- SEED — two sandbox-illustrative catalog products (active=false until live keys
-- + production routing are confirmed). Codes are illustrative, NOT real plans.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.insurance_products
  (code, display_name, product_line, provider, provider_product_code, binding_mode,
   underwriter_display, premium_model, required_kyc_tier, required_fields_schema_ref,
   sum_insured_rules, cancellation_policy_ref, active)
VALUES
  ('device-protect-basic', 'Device Protection (Basic)', 'device', 'mycover',
   'MYCOVER-DEVICE-BASIC', 'direct', 'Sandbox Underwriter (disclosed at quote)', 'fixed', 1,
   '{"fields":[{"name":"device_imei","type":"string","required":true},{"name":"device_value_kobo","type":"integer","required":true}]}'::jsonb,
   '{"min_kobo":1000000,"max_kobo":50000000}'::jsonb, 'cancel-policy-device-v1', false),
  ('trip-passenger-ride', 'Passenger Ride Protection', 'transport', 'octamile',
   'OCTAMILE-RIDE-PAX', 'embedded', 'Sandbox Underwriter (disclosed at quote)', 'per_event', 0,
   '{"fields":[{"name":"trip_id","type":"string","required":true}]}'::jsonb,
   '{"fixed_kobo":50000000}'::jsonb, 'cancel-policy-ride-v1', false)
ON CONFLICT (code) DO NOTHING;

COMMIT;
