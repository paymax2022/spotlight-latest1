-- Migration: utility_payment_engine
-- Additive foundation for provider-agnostic bills payment.

CREATE TABLE IF NOT EXISTS public.utility_providers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  adapter_code TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled','maintenance')),
  supported_categories TEXT[] NOT NULL DEFAULT '{}',
  priority INTEGER NOT NULL DEFAULT 100,
  health_status TEXT NOT NULL DEFAULT 'unknown'
    CHECK (health_status IN ('healthy','degraded','down','unknown')),
  last_health_check_at TIMESTAMPTZ,
  credentials JSONB,
  config JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.utility_billers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT NOT NULL
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education')),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  country TEXT NOT NULL DEFAULT 'NG',
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  requires_validation BOOLEAN NOT NULL DEFAULT false,
  customer_reference_label TEXT NOT NULL DEFAULT 'Customer reference',
  dynamic_fields JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.utility_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  biller_id UUID NOT NULL REFERENCES public.utility_billers(id),
  category TEXT NOT NULL
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education')),
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  amount_type TEXT NOT NULL DEFAULT 'fixed'
    CHECK (amount_type IN ('fixed','variable')),
  amount_kobo BIGINT CHECK (amount_kobo IS NULL OR amount_kobo > 0),
  min_amount_kobo BIGINT CHECK (min_amount_kobo IS NULL OR min_amount_kobo > 0),
  max_amount_kobo BIGINT CHECK (max_amount_kobo IS NULL OR max_amount_kobo > 0),
  convenience_fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (convenience_fee_kobo >= 0),
  markup_bps INTEGER NOT NULL DEFAULT 0 CHECK (markup_bps >= 0),
  provider_discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (provider_discount_bps >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.utility_provider_product_mappings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id UUID NOT NULL REFERENCES public.utility_providers(id),
  product_id UUID NOT NULL REFERENCES public.utility_products(id),
  provider_product_code TEXT NOT NULL,
  provider_biller_code TEXT,
  provider_cost_kobo BIGINT CHECK (provider_cost_kobo IS NULL OR provider_cost_kobo > 0),
  provider_discount_bps INTEGER NOT NULL DEFAULT 0 CHECK (provider_discount_bps >= 0),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (provider_id, product_id)
);

CREATE TABLE IF NOT EXISTS public.utility_routing_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  category TEXT
    CHECK (category IS NULL OR category IN ('airtime','data','electricity','cable_tv','internet','education')),
  biller_id UUID REFERENCES public.utility_billers(id),
  product_id UUID REFERENCES public.utility_products(id),
  provider_id UUID NOT NULL REFERENCES public.utility_providers(id),
  priority INTEGER NOT NULL DEFAULT 100,
  min_amount_kobo BIGINT,
  max_amount_kobo BIGINT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active','disabled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.utility_transactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education')),
  biller_id UUID NOT NULL REFERENCES public.utility_billers(id),
  product_id UUID REFERENCES public.utility_products(id),
  provider_id UUID REFERENCES public.utility_providers(id),
  provider_mapping_id UUID REFERENCES public.utility_provider_product_mappings(id),
  customer_reference TEXT NOT NULL,
  customer_name TEXT,
  amount_kobo BIGINT NOT NULL CHECK (amount_kobo > 0),
  convenience_fee_kobo BIGINT NOT NULL DEFAULT 0 CHECK (convenience_fee_kobo >= 0),
  retail_amount_kobo BIGINT NOT NULL CHECK (retail_amount_kobo > 0),
  provider_cost_kobo BIGINT NOT NULL CHECK (provider_cost_kobo > 0),
  gross_profit_kobo BIGINT NOT NULL DEFAULT 0,
  gross_margin_bps INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'initiated'
    CHECK (status IN ('initiated','wallet_debited','provider_pending','successful','failed','reversed','disputed')),
  provider_reference TEXT,
  token TEXT,
  receipt_number TEXT UNIQUE,
  idempotency_key TEXT NOT NULL UNIQUE,
  payment_source TEXT NOT NULL DEFAULT 'wallet' CHECK (payment_source IN ('wallet')),
  failure_reason TEXT,
  provider_response JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.utility_transaction_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.utility_transactions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.saved_utility_beneficiaries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  category TEXT NOT NULL
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education')),
  biller_id UUID NOT NULL REFERENCES public.utility_billers(id),
  label TEXT NOT NULL,
  customer_reference TEXT NOT NULL,
  customer_name TEXT,
  last_transaction_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (user_id, biller_id, customer_reference)
);

CREATE TABLE IF NOT EXISTS public.utility_disputes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transaction_id UUID NOT NULL REFERENCES public.utility_transactions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open','investigating','resolved','rejected')),
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_utility_billers_category ON public.utility_billers(category);
CREATE INDEX IF NOT EXISTS idx_utility_products_biller ON public.utility_products(biller_id);
CREATE INDEX IF NOT EXISTS idx_utility_mappings_product ON public.utility_provider_product_mappings(product_id);
CREATE INDEX IF NOT EXISTS idx_utility_transactions_user_created ON public.utility_transactions(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_transactions_status ON public.utility_transactions(status);
CREATE INDEX IF NOT EXISTS idx_utility_transactions_provider ON public.utility_transactions(provider_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_utility_events_transaction ON public.utility_transaction_events(transaction_id, created_at);
CREATE INDEX IF NOT EXISTS idx_utility_beneficiaries_user ON public.saved_utility_beneficiaries(user_id, category);

ALTER TABLE public.utility_providers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_billers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_provider_product_mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_routing_rules ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_transactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_transaction_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.saved_utility_beneficiaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.utility_disputes ENABLE ROW LEVEL SECURITY;

CREATE POLICY "utility_billers_read_active" ON public.utility_billers
  FOR SELECT TO authenticated USING (status = 'active');
CREATE POLICY "utility_products_read_active" ON public.utility_products
  FOR SELECT TO authenticated USING (status = 'active');
CREATE POLICY "utility_transactions_read_own" ON public.utility_transactions
  FOR SELECT TO authenticated USING (auth.uid() = user_id);
CREATE POLICY "utility_events_read_own" ON public.utility_transaction_events
  FOR SELECT TO authenticated USING (
    transaction_id IN (SELECT id FROM public.utility_transactions WHERE user_id = auth.uid())
  );
CREATE POLICY "utility_beneficiaries_own" ON public.saved_utility_beneficiaries
  FOR ALL TO authenticated USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
CREATE POLICY "utility_disputes_read_own" ON public.utility_disputes
  FOR SELECT TO authenticated USING (auth.uid() = user_id);

INSERT INTO public.utility_providers (name, code, adapter_code, supported_categories, priority, health_status)
VALUES ('Spotlight Sandbox Provider', 'spotlight_sandbox', 'sandbox', ARRAY['airtime','data','electricity','cable_tv','internet'], 10, 'healthy')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_providers (name, code, adapter_code, supported_categories, priority, health_status)
VALUES ('VTPASS', 'vtpass', 'vtpass', ARRAY['airtime','data','internet','electricity','cable_tv','education'], 20, 'unknown')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_billers (category, name, code, requires_validation, customer_reference_label)
VALUES
  ('airtime', 'MTN Nigeria', 'mtn', false, 'Phone number'),
  ('data', 'MTN Nigeria Data', 'mtn-data', false, 'Phone number'),
  ('electricity', 'Ikeja Electric', 'ikeja-electric', true, 'Meter number'),
  ('cable_tv', 'DStv', 'dstv', true, 'Smartcard number'),
  ('internet', 'Spectranet', 'spectranet', true, 'Customer ID'),
  ('education', 'WAEC Result Checker', 'waec', false, 'Phone number')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_products (biller_id, category, name, code, amount_type, amount_kobo, min_amount_kobo, max_amount_kobo, provider_discount_bps, convenience_fee_kobo)
SELECT b.id, 'airtime', 'MTN Airtime', 'mtn-airtime-variable', 'variable', NULL, 5000, 5000000, 300, 0
FROM public.utility_billers b WHERE b.code = 'mtn'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_products (biller_id, category, name, code, amount_type, amount_kobo, provider_discount_bps, convenience_fee_kobo)
SELECT b.id, 'data', 'MTN 1GB Data', 'mtn-data-1gb', 'fixed', 50000, 500, 0
FROM public.utility_billers b WHERE b.code = 'mtn-data'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_products (biller_id, category, name, code, amount_type, min_amount_kobo, max_amount_kobo, provider_discount_bps, convenience_fee_kobo)
SELECT b.id, 'electricity', 'Ikeja Electric Prepaid', 'ikeja-prepaid-variable', 'variable', 100000, 10000000, 200, 10000
FROM public.utility_billers b WHERE b.code = 'ikeja-electric'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_products (biller_id, category, name, code, amount_type, amount_kobo, provider_discount_bps, convenience_fee_kobo)
SELECT b.id, 'education', 'WAEC Result Checker PIN', 'waec-result-checker-pin', 'fixed', 535000, 0, 0
FROM public.utility_billers b WHERE b.code = 'waec'
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_provider_product_mappings (
  provider_id,
  product_id,
  provider_product_code,
  provider_biller_code,
  provider_discount_bps
)
SELECT p.id, pr.id, pr.code, b.code, pr.provider_discount_bps
FROM public.utility_providers p
JOIN public.utility_products pr ON pr.code IN ('mtn-airtime-variable','mtn-data-1gb','ikeja-prepaid-variable')
JOIN public.utility_billers b ON b.id = pr.biller_id
WHERE p.code = 'spotlight_sandbox'
ON CONFLICT (provider_id, product_id) DO NOTHING;

INSERT INTO public.utility_provider_product_mappings (
  provider_id,
  product_id,
  provider_product_code,
  provider_biller_code,
  provider_discount_bps
)
SELECT p.id, pr.id, 'waecdirect', 'waec', pr.provider_discount_bps
FROM public.utility_providers p
JOIN public.utility_products pr ON pr.code = 'waec-result-checker-pin'
WHERE p.code = 'vtpass'
ON CONFLICT (provider_id, product_id) DO NOTHING;

INSERT INTO public.utility_routing_rules (category, biller_id, product_id, provider_id, priority)
SELECT pr.category, pr.biller_id, pr.id, p.id, 10
FROM public.utility_providers p
JOIN public.utility_products pr ON pr.code IN ('mtn-airtime-variable','mtn-data-1gb','ikeja-prepaid-variable')
WHERE p.code = 'spotlight_sandbox'
ON CONFLICT DO NOTHING;

INSERT INTO public.utility_routing_rules (category, biller_id, product_id, provider_id, priority)
SELECT pr.category, pr.biller_id, pr.id, p.id, 20
FROM public.utility_providers p
JOIN public.utility_products pr ON pr.code = 'waec-result-checker-pin'
WHERE p.code = 'vtpass'
ON CONFLICT DO NOTHING;
