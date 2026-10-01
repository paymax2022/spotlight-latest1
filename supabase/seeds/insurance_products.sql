-- =============================================================================
-- Insurance / Protection — member catalog seed (LOCAL DEV ONLY)
-- =============================================================================
-- Loaded via [db.seed] sql_paths in supabase/config.toml, so it runs on
-- `supabase db reset` and NEVER on `db push` — nothing here reaches production.
--
-- WHY THIS EXISTS (AUD-QA-002):
--   The member catalog (GET /api/v1/insurance/products → Go
--   ListForMember) serves only rows where
--       active = true AND purchasable = true AND provider_missing = false
--       AND binding_mode = 'direct' AND required_kyc_tier <= member tier.
--   The real catalog is populated by the provider catalog sync
--   (POST /api/insurance/admin/catalog/sync), which needs live MyCover
--   credentials a local dev box does not have. Worse, migration
--   20270136000000 deliberately retired the nine fictional scaffolding
--   products — so after a reset the table has rows but none of them are
--   visible, and the Protection hub renders an empty catalog.
--
--   These rows mirror what a real sync writes (same code convention
--   `mycover:<route_name>`, lowercase product_line vocabulary, integer-kobo
--   pricing, provider UUID identity, verified single buy path) so the local
--   catalog, product detail, schema and quote surfaces exercise the REAL
--   read path. Purchases still cannot complete without provider credentials —
--   the adapter fails closed at the outbound call — but everything up to the
--   provider call is now exercisable end to end.
--
-- IDEMPOTENT: ON CONFLICT (code) DO NOTHING — safe to re-run; a row already
-- synced from the live provider under the same code is never downgraded by
-- this seed.
--
-- MONEY: every *_kobo column is an integer in minor units (kobo). rate_bps is
-- basis points (5% = 500). No floats, no strings for money.
--
-- Apply manually (without a full reset):
--   psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" \
--     -f supabase/seeds/insurance_products.sql
-- =============================================================================

BEGIN;

INSERT INTO public.insurance_products (
  code, display_name, description, product_line, provider_category,
  provider, provider_product_code, provider_product_id, provider_prefix,
  provider_buy_path, provider_buy_family, buy_path_verified,
  binding_mode, underwriter_display,
  premium_model, required_kyc_tier,
  is_percentage, base_price_kobo, rate_bps, default_sum_insured_kobo,
  distributor_commission_bps, mca_commission_bps, provider_commission_bps,
  commission_from,
  cover_period_days, is_renewable, is_claimable, is_certificateable,
  currency,
  key_benefits_html, how_to_claim_html,
  form_schema, form_schema_source,
  required_fields_schema_ref, sum_insured_rules, cancellation_policy_ref,
  indicative_premium_kobo, premium_cadence,
  purchasable, provider_config_status, provider_config_error,
  provider_missing, deactivated_reason,
  active
) VALUES

  -- ── HEALTH — Bastion FlexiCare Mini (flat ₦4,000/month plan-1 price) ──────
  ('mycover:bastion-flexicare-mini', 'FlexiCare Mini',
   'Everyday health cover — consultations, tests and hospital cash.',
   'health', 'Health',
   'mycover', 'bastion-flexicare-mini', '5c1b1a48-7f45-4b1a-9c15-2f3d1e6a9b01', 'bastion',
   '/products/buy', 'bastion', true,
   'direct', 'Bastion Health',
   'fixed', 0,
   false, 400000, 0, 25000000,
   1500, 1000, 7500, 'final_premium',
   30, true, true, true,
   'NGN',
   '<ul><li>Unlimited GP consultations</li><li>Malaria and typhoid tests</li><li>Hospital cash for overnight stays</li></ul>',
   '<p>Present your policy number at any partner hospital.</p>',
   '{"fields":[
      {"name":"first_name","label":"First name","type":"text","required":true,"min_length":2},
      {"name":"last_name","label":"Last name","type":"text","required":true,"min_length":2},
      {"name":"email","label":"Email","type":"email","required":true},
      {"name":"phone_number","label":"Phone number","type":"phone","required":true},
      {"name":"date_of_birth","label":"Date of birth","type":"date","required":true,"max_date":"today"},
      {"name":"gender","label":"Gender","type":"select","required":true,
        "options":[{"value":"Male","label":"Male"},{"value":"Female","label":"Female"}]},
      {"name":"nin","label":"NIN","type":"nin","required":true,"min_length":11,"max_length":11},
      {"name":"image_url","label":"Passport photo","type":"image","required":true},
      {"name":"payment_plan","label":"Payment plan","type":"number","required":true,"min":1,"max":12},
      {"name":"product_id","label":"Product","type":"text","required":true,"hidden":true}
    ]}'::jsonb, 'seed',
   '{}'::jsonb, '{"min":25000000,"max":25000000,"basis":"fixed"}'::jsonb,
   'cancel-policy-health-v1',
   400000, 'monthly',
   true, 'ok', NULL,
   false, NULL,
   true),

  -- ── HEALTH — Bastion FlexiCare (flat ₦9,000/month plan-1 price) ───────────
  ('mycover:bastion-flexicare', 'FlexiCare',
   'Broader health cover — consultations, labs, pharmacy and hospital cash.',
   'health', 'Health',
   'mycover', 'bastion-flexicare', '5c1b1a48-7f45-4b1a-9c15-2f3d1e6a9b02', 'bastion',
   '/products/buy', 'bastion', true,
   'direct', 'Bastion Health',
   'fixed', 0,
   false, 900000, 0, 75000000,
   1500, 1000, 7500, 'final_premium',
   30, true, true, true,
   'NGN',
   '<ul><li>Everything in FlexiCare Mini</li><li>Specialist consultations</li><li>Pharmacy benefit up to plan limit</li></ul>',
   '<p>Present your policy number at any partner hospital.</p>',
   '{"fields":[
      {"name":"first_name","label":"First name","type":"text","required":true,"min_length":2},
      {"name":"last_name","label":"Last name","type":"text","required":true,"min_length":2},
      {"name":"email","label":"Email","type":"email","required":true},
      {"name":"phone_number","label":"Phone number","type":"phone","required":true},
      {"name":"date_of_birth","label":"Date of birth","type":"date","required":true,"max_date":"today"},
      {"name":"gender","label":"Gender","type":"select","required":true,
        "options":[{"value":"Male","label":"Male"},{"value":"Female","label":"Female"}]},
      {"name":"nin","label":"NIN","type":"nin","required":true,"min_length":11,"max_length":11},
      {"name":"image_url","label":"Passport photo","type":"image","required":true},
      {"name":"payment_plan","label":"Payment plan","type":"number","required":true,"min":1,"max":12},
      {"name":"product_id","label":"Product","type":"text","required":true,"hidden":true}
    ]}'::jsonb, 'seed',
   '{}'::jsonb, '{"min":75000000,"max":75000000,"basis":"fixed"}'::jsonb,
   'cancel-policy-health-v1',
   900000, 'monthly',
   true, 'ok', NULL,
   false, NULL,
   true),

  -- ── AUTO — Sovereign Trust Comprehensive (5% of declared vehicle value) ───
  ('mycover:sti-comprehensive', 'Comprehensive Auto',
   'Comprehensive motor cover for private and commercial vehicles.',
   'auto', 'Auto',
   'mycover', 'sti-comprehensive', 'b0d0f39c-0b8a-452f-a876-78bef8de3347', 'sti',
   '/products/buy', 'sti', true,
   'direct', 'Sovereign Trust Insurance Plc',
   'percentage_of_sum_insured', 0,
   true, 500, 500, 0,
   1500, 1000, 7500, 'final_premium',
   365, true, true, true,
   'NGN',
   '<ul><li>Accidental damage to your vehicle</li><li>Fire and theft</li><li>Third-party property damage up to ₦1,000,000</li></ul>',
   '<p>Report the incident within 48 hours and submit an inspection.</p>',
   '{"fields":[
      {"name":"first_name","label":"First name","type":"text","required":true,"min_length":2},
      {"name":"last_name","label":"Last name","type":"text","required":true,"min_length":2},
      {"name":"email","label":"Email","type":"email","required":true},
      {"name":"phone_number","label":"Phone number","type":"phone","required":true},
      {"name":"address","label":"Address","type":"address","required":true,"min_length":6},
      {"name":"vehicle_make","label":"Vehicle make","type":"select","required":true,
        "options":[{"value":"Toyota","label":"Toyota"},{"value":"Honda","label":"Honda"},
                   {"value":"Lexus","label":"Lexus"},{"value":"Hyundai","label":"Hyundai"}]},
      {"name":"vehicle_model","label":"Vehicle model","type":"text","required":true},
      {"name":"value","label":"Vehicle value","type":"money","required":true,
        "min":1000000,"unit":"naira"},
      {"name":"registration_number","label":"Vehicle registration number","type":"text","required":true,"min_length":2},
      {"name":"product_id","label":"Product","type":"text","required":true,"hidden":true}
    ]}'::jsonb, 'seed',
   '{}'::jsonb, '{"min":100000000,"max":5000000000,"basis":"declared_value"}'::jsonb,
   'cancel-policy-motor-v1',
   0, 'annual',
   true, 'ok', NULL,
   false, NULL,
   true),

  -- ── AUTO — Sovereign Trust Third-Party Bike (flat ₦3,000/year) ────────────
  ('mycover:sti-third-party-bike', 'Third Party Bike',
   'Third-party cover for motorcycles — the legal minimum for riders.',
   'auto', 'Auto',
   'mycover', 'sti-third-party-bike', 'c1d2e3f4-0000-4a02-bb70-77c4e1d2f501', 'sti',
   '/products/buy', 'sti', true,
   'direct', 'Sovereign Trust Insurance Plc',
   'fixed', 0,
   false, 300000, 0, 300000000,
   1500, 1000, 7500, 'final_premium',
   365, true, true, true,
   'NGN',
   '<ul><li>Third-party bodily injury and property damage</li><li>Instant certificate</li></ul>',
   '<p>Report the incident within 48 hours with your certificate number.</p>',
   '{"fields":[
      {"name":"vehicle_make","label":"Vehicle make","type":"select","required":true,
        "options":[{"value":"Bajaj","label":"Bajaj"},{"value":"TVS","label":"TVS"},
                   {"value":"Honda","label":"Honda"},{"value":"Qlink","label":"Qlink"}]},
      {"name":"vehicle_model","label":"Vehicle model","type":"text","required":true},
      {"name":"value","label":"Vehicle value","type":"money","required":true,
        "min":100000,"unit":"naira"},
      {"name":"registration_number","label":"Vehicle registration number","type":"text","required":true},
      {"name":"product_id","label":"Product","type":"text","required":true,"hidden":true}
    ]}'::jsonb, 'seed',
   '{}'::jsonb, '{"min":300000000,"max":300000000,"basis":"fixed"}'::jsonb,
   'cancel-policy-motor-tp-v1',
   300000, 'annual',
   true, 'ok', NULL,
   false, NULL,
   true),

  -- ── AUTO — AIICO Comprehensive Auto (4.5% of declared vehicle value) ──────
  ('mycover:aiico-comprehensive', 'Comprehensive Auto (AIICO)',
   'Comprehensive motor cover underwritten by AIICO Insurance.',
   'auto', 'Auto',
   'mycover', 'aiico-comprehensive', '24140c74-fc6f-42f5-a0d2-24800b22d80a', 'aiico',
   '/products/buy', 'aiico', true,
   'direct', 'AIICO Insurance Plc',
   'percentage_of_sum_insured', 1,
   true, 500, 450, 0,
   1200, 800, 8000, 'final_premium',
   365, true, true, true,
   'NGN',
   '<ul><li>Accidental damage to your vehicle</li><li>Fire and theft</li><li>Third-party liability</li></ul>',
   '<p>Report the incident within 48 hours and submit an inspection.</p>',
   '{"fields":[
      {"name":"first_name","label":"First name","type":"text","required":true,"min_length":2},
      {"name":"last_name","label":"Last name","type":"text","required":true,"min_length":2},
      {"name":"email","label":"Email","type":"email","required":true},
      {"name":"phone_number","label":"Phone number","type":"phone","required":true},
      {"name":"vehicle_make","label":"Vehicle make","type":"select","required":true,
        "options":[{"value":"Toyota","label":"Toyota"},{"value":"Honda","label":"Honda"},
                   {"value":"Lexus","label":"Lexus"},{"value":"Hyundai","label":"Hyundai"}]},
      {"name":"vehicle_model","label":"Vehicle model","type":"text","required":true},
      {"name":"value","label":"Vehicle value","type":"money","required":true,
        "min":1000000,"unit":"naira"},
      {"name":"registration_number","label":"Vehicle registration number","type":"text","required":true,"min_length":2},
      {"name":"product_id","label":"Product","type":"text","required":true,"hidden":true}
    ]}'::jsonb, 'seed',
   '{}'::jsonb, '{"min":100000000,"max":5000000000,"basis":"declared_value"}'::jsonb,
   'cancel-policy-motor-v1',
   0, 'annual',
   true, 'ok', NULL,
   false, NULL,
   true),

  -- ── PACKAGE — STI Annual Goods-in-Transit (0.5% of declared goods value) ──
  ('mycover:sti-git-annual', 'Annual Goods In Transit',
   'Annual goods-in-transit cover for parcels, stock and freight.',
   'package', 'Package',
   'mycover', 'sti-git-annual', '6e417faa-e042-4768-8d5d-916fd531a478', 'sti',
   '/products/buy', 'sti', true,
   'direct', 'Sovereign Trust Insurance Plc',
   'percentage_of_sum_insured', 0,
   true, 50, 50, 0,
   1500, 1000, 7500, 'final_premium',
   365, true, true, true,
   'NGN',
   '<p>Cover for goods while they are being moved.</p>',
   '<p>Report loss or damage within 48 hours with the waybill reference.</p>',
   '{"fields":[
      {"name":"business_name","label":"Business name","type":"text","required":true},
      {"name":"goods_type","label":"Goods type","type":"select","required":true,
        "options":[{"value":"General merchandise","label":"General merchandise"},
                   {"value":"Electronics","label":"Electronics"},
                   {"value":"Perishables","label":"Perishables"}]},
      {"name":"declared_value","label":"Declared goods value","type":"money","required":true,
        "min":100000,"unit":"naira"},
      {"name":"product_id","label":"Product","type":"text","required":true,"hidden":true}
    ]}'::jsonb, 'seed',
   '{}'::jsonb, '{"min":10000000,"max":500000000,"basis":"declared_value"}'::jsonb,
   'cancel-policy-git-v1',
   0, 'annual',
   true, 'ok', NULL,
   false, NULL,
   true),

  -- ── TRAVEL — Allianz Travel Cover (flat ₦15,000 per trip) ─────────────────
  ('mycover:allianz-travel-cover', 'Travel Cover',
   'Emergency medical, baggage and trip cover for travel out of Nigeria.',
   'travel', 'Travel',
   'mycover', 'allianz-travel-cover', 'aa11ce00-0000-4000-8000-0000000000a1', 'allianz',
   '/products/buy', 'allianz', true,
   'direct', 'Allianz Nigeria Insurance Plc',
   'fixed', 1,
   false, 1500000, 0, 500000000,
   1500, 1000, 7500, 'final_premium',
   30, false, true, true,
   'NGN',
   '<ul><li>Emergency medical expenses abroad</li><li>Lost or delayed baggage</li><li>Trip cancellation cover</li></ul>',
   '<p>Contact the 24/7 assistance line on your certificate before incurring costs.</p>',
   '{"fields":[
      {"name":"first_name","label":"First name","type":"text","required":true,"min_length":2},
      {"name":"last_name","label":"Last name","type":"text","required":true,"min_length":2},
      {"name":"passport_number","label":"Passport number","type":"text","required":true},
      {"name":"destination","label":"Destination","type":"text","required":true},
      {"name":"departure_date","label":"Departure date","type":"date","required":true},
      {"name":"return_date","label":"Return date","type":"date","required":true},
      {"name":"product_id","label":"Product","type":"text","required":true,"hidden":true}
    ]}'::jsonb, 'seed',
   '{}'::jsonb, '{"min":500000000,"max":500000000,"basis":"fixed"}'::jsonb,
   'cancel-policy-travel-v1',
   1500000, 'per-trip',
   true, 'ok', NULL,
   false, NULL,
   true),

  -- ── LIFE — Coronation Life Cover ──────────────────────────────────────────
  -- Seeded DARK (active=false, purchasable=false): in the live MyCover catalog
  -- this product's sharing formula is null, so it can be browsed and described
  -- but never sold. Keeping one realistically-broken row exercises the admin
  -- console's "cannot activate — the provider cannot sell it" path without
  -- polluting the member catalog.
  ('mycover:coronation-life-cover', 'Life Cover',
   'Term life cover paying a lump sum to named beneficiaries.',
   'life', 'Life',
   'mycover', 'coronation-life-cover', '9a2f5c31-1d84-4a02-bb70-77c4e1d2f5aa', 'coronation',
   '/products/buy', 'coronation', false,
   'direct', 'Coronation Insurance Plc',
   'fixed', 1,
   false, 250000, 0, 1000000000,
   0, 0, 0, 'final_premium',
   365, true, true, true,
   'NGN',
   '<ul><li>Guaranteed lump-sum payout to beneficiaries</li></ul>',
   '<p>Beneficiaries submit a claim with the death certificate and policy number.</p>',
   '{}'::jsonb, 'seed',
   '{}'::jsonb, '{"min":1000000000,"max":1000000000,"basis":"fixed"}'::jsonb,
   'cancel-policy-life-v1',
   250000, 'annual',
   false, 'broken', 'provider has no sharing formula for this product (zero distributor commission)',
   false, 'The provider has no commission-sharing formula for this product, so it cannot be priced.',
   false)

ON CONFLICT (code) DO NOTHING;

COMMIT;
