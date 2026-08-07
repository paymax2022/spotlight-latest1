-- ─────────────────────────────────────────────────────────────────────────────
-- Seed: insurance_products catalog (Protection module — 2 rails).
--
-- ADDITIVE-ONLY. Pure INSERT ... ON CONFLICT (code) DO NOTHING — no DROP, no
-- column change, no type narrowing. Re-runnable and safe to replay.
--
-- Aligns the live catalog with the mobile "Protection" hub so USE_MOCK=false
-- renders real routing data. Column conventions the code depends on:
--   • product_line : UPPERCASE enum — matches the mobile ?line= filter and the
--                    catalog.ListForMember `product_line = $` predicate.
--   • provider     : lowercase aggregator key ('mycover' | 'octamile') — matches
--                    gateway.NewRouter's adapter registry (adapter.Name()).
--   • binding_mode : CHECK ∈ ('direct','embedded').
--   • *_kobo money : integers in minor units (kobo). Never floats.
--
-- ⚠️ provider_product_code values below are placeholders keyed to our internal
--    codes. Before LIVE binding, replace each with the real plan/product code
--    from the MyCover.ai / Octamile dashboards (admin PATCH /routing/:code also
--    re-routes without a migration).
-- ─────────────────────────────────────────────────────────────────────────────

INSERT INTO public.insurance_products
  (code, display_name, product_line, provider, provider_product_code, binding_mode,
   underwriter_display, premium_model, required_kyc_tier, required_fields_schema_ref,
   sum_insured_rules, cancellation_policy_ref, active)
VALUES
  -- ── MyCover.ai rail (health / identity / financial lines) ──────────────────
  ('mycover.health.micro.v1', 'MicroHealth Essential', 'HEALTH', 'mycover',
   'MYCOVER-HEALTH-MICRO-V1', 'direct', 'Hygeia HMO', 'tiered', 1,
   '{"fields":[{"name":"fullName","type":"string","required":true},{"name":"dateOfBirth","type":"date","required":true},{"name":"phone","type":"string","required":true},{"name":"plan","type":"select","required":true},{"name":"dependents","type":"integer","required":false}]}'::jsonb,
   '{"min":25000000,"max":200000000,"basis":"fixed"}'::jsonb, 'cancel-policy-health-v1', true),

  ('mycover.pa.income.v1', 'Personal Accident Shield', 'PERSONAL_ACCIDENT', 'mycover',
   'MYCOVER-PA-INCOME-V1', 'direct', 'Leadway Assurance', 'flat', 1,
   '{"fields":[{"name":"fullName","type":"string","required":true},{"name":"dateOfBirth","type":"date","required":true},{"name":"occupation","type":"string","required":true},{"name":"coverAmount","type":"integer","required":true}]}'::jsonb,
   '{"min":50000000,"max":500000000,"basis":"fixed"}'::jsonb, 'cancel-policy-pa-v1', true),

  ('mycover.device.gadget.v1', 'Gadget Guard', 'DEVICE', 'mycover',
   'MYCOVER-DEVICE-GADGET-V1', 'direct', 'Sovereign Trust Insurance', 'tiered', 1,
   '{"fields":[{"name":"fullName","type":"string","required":true},{"name":"deviceType","type":"select","required":true},{"name":"deviceValue","type":"integer","required":true},{"name":"imei","type":"string","required":true}]}'::jsonb,
   '{"min":5000000,"max":300000000,"basis":"declared_value"}'::jsonb, 'cancel-policy-device-v1', true),

  ('mycover.sme.bundle.v1', 'SME Protect Bundle', 'SME', 'mycover',
   'MYCOVER-SME-BUNDLE-V1', 'direct', 'AIICO Insurance', 'tiered', 2,
   '{"fields":[{"name":"businessName","type":"string","required":true},{"name":"assetValue","type":"integer","required":true}]}'::jsonb,
   '{"min":100000000,"max":2000000000,"basis":"declared_value"}'::jsonb, 'cancel-policy-sme-v1', true),

  -- ── Octamile rail (motor / goods-in-transit) ───────────────────────────────
  ('octamile.motor.comprehensive.v1', 'Motor Comprehensive', 'MOTOR', 'octamile',
   'OCTAMILE-MOTOR-COMP-V1', 'direct', 'AXA Mansard', 'declared_value', 2,
   '{"fields":[{"name":"vehicleValue","type":"integer","required":true},{"name":"plateNumber","type":"string","required":true}]}'::jsonb,
   '{"min":150000000,"max":5000000000,"basis":"declared_value"}'::jsonb, 'cancel-policy-motor-v1', true),

  ('octamile.motor.thirdparty.v1', 'Motor Third-Party', 'MOTOR', 'octamile',
   'OCTAMILE-MOTOR-TP-V1', 'direct', 'AXA Mansard', 'flat', 1,
   '{"fields":[{"name":"plateNumber","type":"string","required":true}]}'::jsonb,
   '{"min":300000000,"max":300000000,"basis":"fixed"}'::jsonb, 'cancel-policy-motor-tp-v1', true),

  ('octamile.git.parcel.v1', 'Goods-in-Transit (Parcel)', 'GOODS_IN_TRANSIT', 'octamile',
   'OCTAMILE-GIT-PARCEL-V1', 'embedded', 'AXA Mansard', 'per_shipment', 1,
   '{"fields":[{"name":"declaredValue","type":"integer","required":true},{"name":"shipmentRef","type":"string","required":false}]}'::jsonb,
   '{"min":1000000,"max":500000000,"basis":"declared_value"}'::jsonb, 'cancel-policy-git-v1', true)
ON CONFLICT (code) DO NOTHING;
