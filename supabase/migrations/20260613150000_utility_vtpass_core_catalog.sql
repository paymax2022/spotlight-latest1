-- Migration: utility_vtpass_core_catalog
-- Seeds a practical VTPass catalogue shell across enabled utility categories.
-- Credentials are intentionally not stored here; the VTPass adapter reads secure env vars.

INSERT INTO public.utility_providers (name, code, adapter_code, supported_categories, priority, health_status)
VALUES ('VTPASS', 'vtpass', 'vtpass', ARRAY['airtime','data','internet','electricity','cable_tv','education'], 20, 'unknown')
ON CONFLICT (code) DO UPDATE SET
  name = EXCLUDED.name,
  adapter_code = EXCLUDED.adapter_code,
  supported_categories = EXCLUDED.supported_categories,
  updated_at = now();

INSERT INTO public.utility_billers (category, name, code, requires_validation, customer_reference_label)
VALUES
  ('airtime', 'MTN Airtime', 'vtpass-mtn-airtime', false, 'Phone number'),
  ('airtime', 'Airtel Airtime', 'vtpass-airtel-airtime', false, 'Phone number'),
  ('airtime', 'Glo Airtime', 'vtpass-glo-airtime', false, 'Phone number'),
  ('airtime', '9mobile Airtime', 'vtpass-9mobile-airtime', false, 'Phone number'),
  ('data', 'MTN Data', 'vtpass-mtn-data', false, 'Phone number'),
  ('data', 'Airtel Data', 'vtpass-airtel-data', false, 'Phone number'),
  ('data', 'Glo Data', 'vtpass-glo-data', false, 'Phone number'),
  ('data', '9mobile Data', 'vtpass-9mobile-data', false, 'Phone number'),
  ('internet', 'Smile Internet', 'vtpass-smile-internet', true, 'Smile account number'),
  ('electricity', 'Ikeja Electric', 'vtpass-ikeja-electric', true, 'Meter number'),
  ('electricity', 'Eko Electric', 'vtpass-eko-electric', true, 'Meter number'),
  ('electricity', 'Abuja Electric', 'vtpass-abuja-electric', true, 'Meter number'),
  ('electricity', 'Kano Electric', 'vtpass-kano-electric', true, 'Meter number'),
  ('electricity', 'Port Harcourt Electric', 'vtpass-portharcourt-electric', true, 'Meter number'),
  ('electricity', 'Jos Electric', 'vtpass-jos-electric', true, 'Meter number'),
  ('electricity', 'Kaduna Electric', 'vtpass-kaduna-electric', true, 'Meter number'),
  ('electricity', 'Enugu Electric', 'vtpass-enugu-electric', true, 'Meter number'),
  ('electricity', 'Ibadan Electric', 'vtpass-ibadan-electric', true, 'Meter number'),
  ('electricity', 'Benin Electric', 'vtpass-benin-electric', true, 'Meter number'),
  ('electricity', 'Aba Electric', 'vtpass-aba-electric', true, 'Meter number'),
  ('electricity', 'Yola Electric', 'vtpass-yola-electric', true, 'Meter number'),
  ('cable_tv', 'DStv', 'vtpass-dstv', true, 'Smartcard number'),
  ('cable_tv', 'GOtv', 'vtpass-gotv', true, 'IUC number'),
  ('cable_tv', 'Startimes', 'vtpass-startimes', true, 'Smartcard number'),
  ('education', 'WAEC Result Checker', 'vtpass-waec', false, 'Phone number'),
  ('education', 'WAEC Registration PIN', 'vtpass-waec-registration', false, 'Phone number')
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_products (biller_id, category, name, code, amount_type, amount_kobo, min_amount_kobo, max_amount_kobo, provider_discount_bps, convenience_fee_kobo)
SELECT b.id, b.category, x.product_name, x.product_code, x.amount_type, x.amount_kobo, x.min_amount_kobo, x.max_amount_kobo, x.discount_bps, x.fee_kobo
FROM (
  VALUES
    ('vtpass-mtn-airtime', 'MTN Airtime', 'vtpass-mtn-airtime-variable', 'variable', NULL::BIGINT, 5000::BIGINT, 5000000::BIGINT, 0, 0),
    ('vtpass-airtel-airtime', 'Airtel Airtime', 'vtpass-airtel-airtime-variable', 'variable', NULL::BIGINT, 5000::BIGINT, 5000000::BIGINT, 0, 0),
    ('vtpass-glo-airtime', 'Glo Airtime', 'vtpass-glo-airtime-variable', 'variable', NULL::BIGINT, 5000::BIGINT, 5000000::BIGINT, 0, 0),
    ('vtpass-9mobile-airtime', '9mobile Airtime', 'vtpass-9mobile-airtime-variable', 'variable', NULL::BIGINT, 5000::BIGINT, 5000000::BIGINT, 0, 0),
    ('vtpass-ikeja-electric', 'Ikeja Electric Prepaid/Postpaid', 'vtpass-ikeja-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-eko-electric', 'Eko Electric Prepaid/Postpaid', 'vtpass-eko-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-abuja-electric', 'Abuja Electric Prepaid/Postpaid', 'vtpass-abuja-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-kano-electric', 'Kano Electric Prepaid/Postpaid', 'vtpass-kano-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-portharcourt-electric', 'Port Harcourt Electric Prepaid/Postpaid', 'vtpass-portharcourt-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-jos-electric', 'Jos Electric Prepaid/Postpaid', 'vtpass-jos-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-kaduna-electric', 'Kaduna Electric Prepaid/Postpaid', 'vtpass-kaduna-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-enugu-electric', 'Enugu Electric Prepaid/Postpaid', 'vtpass-enugu-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-ibadan-electric', 'Ibadan Electric Prepaid/Postpaid', 'vtpass-ibadan-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-benin-electric', 'Benin Electric Prepaid/Postpaid', 'vtpass-benin-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-aba-electric', 'Aba Electric Prepaid/Postpaid', 'vtpass-aba-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000),
    ('vtpass-yola-electric', 'Yola Electric Payment', 'vtpass-yola-electric-variable', 'variable', NULL::BIGINT, 100000::BIGINT, 20000000::BIGINT, 0, 10000)
) AS x(biller_code, product_name, product_code, amount_type, amount_kobo, min_amount_kobo, max_amount_kobo, discount_bps, fee_kobo)
JOIN public.utility_billers b ON b.code = x.biller_code
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_products (biller_id, category, name, code, amount_type, amount_kobo, provider_discount_bps, convenience_fee_kobo)
SELECT b.id, b.category, x.product_name, x.product_code, 'fixed', x.amount_kobo, 0, 0
FROM (
  VALUES
    ('vtpass-mtn-data', 'MTN 1.5GB Weekly Plan', 'vtpass-mtn-1500mb-1000', 100000::BIGINT),
    ('vtpass-airtel-data', 'Airtel 1.5GB Weekly Plan', 'vtpass-airtel-1000-7', 100000::BIGINT),
    ('vtpass-glo-data', 'Glo 1.1GB Monthly Plan', 'vtpass-glo-monthly-1000', 100000::BIGINT),
    ('vtpass-9mobile-data', '9mobile 2GB Monthly Plan', 'vtpass-eti-1000', 100000::BIGINT),
    ('vtpass-smile-internet', 'Smile Freedom Mobile 30 Days', 'vtpass-smile-freedom-mobile-30days', 500000::BIGINT),
    ('vtpass-dstv', 'DStv Padi', 'vtpass-dstv-padi', 440000::BIGINT),
    ('vtpass-dstv', 'DStv Yanga', 'vtpass-dstv-yanga', 600000::BIGINT),
    ('vtpass-dstv', 'DStv Confam', 'vtpass-dstv-confam', 1100000::BIGINT),
    ('vtpass-gotv', 'GOtv Jinja', 'vtpass-gotv-jinja', 390000::BIGINT),
    ('vtpass-gotv', 'GOtv Jolli', 'vtpass-gotv-jolli', 580000::BIGINT),
    ('vtpass-gotv', 'GOtv Max', 'vtpass-gotv-max', 850000::BIGINT),
    ('vtpass-startimes', 'Startimes Nova Monthly', 'vtpass-startimes-nova', 210000::BIGINT),
    ('vtpass-startimes', 'Startimes Basic Monthly', 'vtpass-startimes-basic', 400000::BIGINT),
    ('vtpass-startimes', 'Startimes Classic Monthly', 'vtpass-startimes-classic', 600000::BIGINT),
    ('vtpass-waec', 'WAEC Result Checker PIN', 'vtpass-waecdirect', 535000::BIGINT),
    ('vtpass-waec-registration', 'WAEC Registration PIN', 'vtpass-waec-registration-pin', 3750000::BIGINT)
) AS x(biller_code, product_name, product_code, amount_kobo)
JOIN public.utility_billers b ON b.code = x.biller_code
ON CONFLICT (code) DO NOTHING;

INSERT INTO public.utility_provider_product_mappings (
  provider_id,
  product_id,
  provider_product_code,
  provider_biller_code,
  provider_discount_bps
)
SELECT p.id, pr.id, x.provider_product_code, x.provider_biller_code, 0
FROM public.utility_providers p
CROSS JOIN (
  VALUES
    ('vtpass-mtn-airtime-variable', 'mtn', 'mtn'),
    ('vtpass-airtel-airtime-variable', 'airtel', 'airtel'),
    ('vtpass-glo-airtime-variable', 'glo', 'glo'),
    ('vtpass-9mobile-airtime-variable', 'etisalat', 'etisalat'),
    ('vtpass-mtn-1500mb-1000', 'mtn-1500mb-1000', 'mtn-data'),
    ('vtpass-airtel-1000-7', 'airt-1000-7', 'airtel-data'),
    ('vtpass-glo-monthly-1000', 'glo-monthly-1000', 'glo-data'),
    ('vtpass-eti-1000', 'eti-1000', 'etisalat-data'),
    ('vtpass-smile-freedom-mobile-30days', '758', 'smile-direct'),
    ('vtpass-ikeja-electric-variable', 'ikeja-electric', 'ikeja-electric'),
    ('vtpass-eko-electric-variable', 'eko-electric', 'eko-electric'),
    ('vtpass-abuja-electric-variable', 'abuja-electric', 'abuja-electric'),
    ('vtpass-kano-electric-variable', 'kano-electric', 'kano-electric'),
    ('vtpass-portharcourt-electric-variable', 'portharcourt-electric', 'portharcourt-electric'),
    ('vtpass-jos-electric-variable', 'jos-electric', 'jos-electric'),
    ('vtpass-kaduna-electric-variable', 'kaduna-electric', 'kaduna-electric'),
    ('vtpass-enugu-electric-variable', 'enugu-electric', 'enugu-electric'),
    ('vtpass-ibadan-electric-variable', 'ibadan-electric', 'ibadan-electric'),
    ('vtpass-benin-electric-variable', 'benin-electric', 'benin-electric'),
    ('vtpass-aba-electric-variable', 'aba-electric', 'aba-electric'),
    ('vtpass-yola-electric-variable', 'yola-electric', 'yola-electric'),
    ('vtpass-dstv-padi', 'dstv-padi', 'dstv'),
    ('vtpass-dstv-yanga', 'dstv-yanga', 'dstv'),
    ('vtpass-dstv-confam', 'dstv-confam', 'dstv'),
    ('vtpass-gotv-jinja', 'gotv-jinja', 'gotv'),
    ('vtpass-gotv-jolli', 'gotv-jolli', 'gotv'),
    ('vtpass-gotv-max', 'gotv-max', 'gotv'),
    ('vtpass-startimes-nova', 'nova', 'startimes'),
    ('vtpass-startimes-basic', 'basic', 'startimes'),
    ('vtpass-startimes-classic', 'classic', 'startimes'),
    ('vtpass-waecdirect', 'waecdirect', 'waec'),
    ('vtpass-waec-registration-pin', 'waec-registraion', 'waec-registration')
) AS x(product_code, provider_product_code, provider_biller_code)
JOIN public.utility_products pr ON pr.code = x.product_code
WHERE p.code = 'vtpass'
ON CONFLICT (provider_id, product_id) DO UPDATE SET
  provider_product_code = EXCLUDED.provider_product_code,
  provider_biller_code = EXCLUDED.provider_biller_code,
  updated_at = now();

INSERT INTO public.utility_routing_rules (category, biller_id, product_id, provider_id, priority)
SELECT pr.category, pr.biller_id, pr.id, p.id, 20
FROM public.utility_providers p
JOIN public.utility_products pr ON pr.code LIKE 'vtpass-%'
WHERE p.code = 'vtpass'
ON CONFLICT DO NOTHING;
