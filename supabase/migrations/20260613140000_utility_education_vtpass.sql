-- Migration: utility_education_vtpass
-- Adds the Education category and a VTPass provider shell without storing credentials.

ALTER TABLE public.utility_billers
  DROP CONSTRAINT IF EXISTS utility_billers_category_check,
  ADD CONSTRAINT utility_billers_category_check
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education'));

ALTER TABLE public.utility_products
  DROP CONSTRAINT IF EXISTS utility_products_category_check,
  ADD CONSTRAINT utility_products_category_check
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education'));

ALTER TABLE public.utility_routing_rules
  DROP CONSTRAINT IF EXISTS utility_routing_rules_category_check,
  ADD CONSTRAINT utility_routing_rules_category_check
    CHECK (category IS NULL OR category IN ('airtime','data','electricity','cable_tv','internet','education'));

ALTER TABLE public.utility_transactions
  DROP CONSTRAINT IF EXISTS utility_transactions_category_check,
  ADD CONSTRAINT utility_transactions_category_check
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education'));

ALTER TABLE public.saved_utility_beneficiaries
  DROP CONSTRAINT IF EXISTS saved_utility_beneficiaries_category_check,
  ADD CONSTRAINT saved_utility_beneficiaries_category_check
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education'));

ALTER TABLE public.utility_category_settings
  DROP CONSTRAINT IF EXISTS utility_category_settings_category_check,
  ADD CONSTRAINT utility_category_settings_category_check
    CHECK (category IN ('airtime','data','electricity','cable_tv','internet','education'));

INSERT INTO public.utility_category_settings (category, enabled, daily_limit_kobo, min_amount_kobo, max_amount_kobo)
VALUES ('education', true, 5000000, 100000, 5000000)
ON CONFLICT (category) DO NOTHING;

INSERT INTO public.utility_providers (name, code, adapter_code, supported_categories, priority, health_status)
VALUES ('VTPASS', 'vtpass', 'vtpass', ARRAY['airtime','data','internet','electricity','cable_tv','education'], 20, 'unknown')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  adapter_code = EXCLUDED.adapter_code,
  supported_categories = EXCLUDED.supported_categories,
  updated_at = now();

INSERT INTO public.utility_billers (category, name, code, requires_validation, customer_reference_label)
VALUES ('education', 'WAEC Result Checker', 'waec', false, 'Phone number')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_products (biller_id, category, name, code, amount_type, amount_kobo, provider_discount_bps, convenience_fee_kobo)
SELECT b.id, 'education', 'WAEC Result Checker PIN', 'waec-result-checker-pin', 'fixed', 535000, 0, 0
FROM public.utility_billers b
WHERE b.code = 'waec'
ON CONFLICT (code) DO NOTHING;

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
SELECT pr.category, pr.biller_id, pr.id, p.id, 20
FROM public.utility_providers p
JOIN public.utility_products pr ON pr.code = 'waec-result-checker-pin'
WHERE p.code = 'vtpass'
ON CONFLICT DO NOTHING;
