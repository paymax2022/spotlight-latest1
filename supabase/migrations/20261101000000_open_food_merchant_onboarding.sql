-- Open the Food & Logistics module for self-serve restaurant onboarding.
--
-- Routes restaurant/food-vendor onboarding through the generic merchant-onboarding
-- engine (onb_*) — reusing its schema-driven wizard, KYC/tier gating, document
-- capture, application state machine, admin review queue and role grant — instead
-- of the restaurant module's bare is_open admin toggle.
--
-- Additive-only: no DROP, no RENAME, no type narrowing. Idempotent via
-- ON CONFLICT DO NOTHING / a guarded UPDATE. Mirrors the seed shapes in
-- 20260619000000_merchant_onboarding.sql and mobile merchant.constants.ts.

-- ─── Role granted on approval ────────────────────────────────────────────────
INSERT INTO public.roles (name, slug, description, role_type, is_system_role)
VALUES
    ('Restaurant Merchant','restaurant_merchant','Verified restaurant / food-delivery merchant','merchant', true)
ON CONFLICT (slug) DO NOTHING;

-- ─── Open the Food module ────────────────────────────────────────────────────
UPDATE onb_module SET status = 'open' WHERE id = 'mod-food' AND status <> 'open';

-- ─── Merchant type: Restaurant ───────────────────────────────────────────────
-- Inserted before its form schema, matching the ordering used by the base seed
-- (current_form_schema_id is repointed by publishing; the reverse FK lives on
-- onb_form_schema.merchant_type_id). requires_business defaults TRUE (added by
-- 20261002000000) so the CAC gate applies when the business registry is enabled.
INSERT INTO onb_merchant_type (id, module_id, slug, name, description, icon,
    requirements_summary, expected_review_label, required_kyc_tier, role_to_grant,
    current_form_schema_id, status)
VALUES
    ('mt-restaurant','mod-food','restaurant','Restaurant',
     'List your restaurant, build a menu and receive delivery orders.','UtensilsCrossed',
     '["Food handling / NAFDAC permit","Owner government ID","Settlement account"]'::jsonb,
     '1–2 business days',1,'restaurant_merchant','fs-restaurant-v1','open')
ON CONFLICT (id) DO NOTHING;

-- ─── Published form schema: fs-restaurant-v1 ─────────────────────────────────
INSERT INTO onb_form_schema (id, merchant_type_id, version, status, steps) VALUES
('fs-restaurant-v1','mt-restaurant',1,'published', $json$
[
  {"key":"business","title":"Restaurant details","description":"Tell us about your restaurant.","fields":[
    {"key":"restaurant_name","type":"text","label":"Restaurant name","placeholder":"Blue Yam Kitchen","required":true},
    {"key":"cuisine_types","type":"multiselect","label":"Cuisine types","required":true,"maxSelections":4,"options":[
      {"label":"Nigerian","value":"nigerian"},
      {"label":"Fast food","value":"fast_food"},
      {"label":"Continental","value":"continental"},
      {"label":"Chinese","value":"chinese"},
      {"label":"Healthy","value":"healthy"},
      {"label":"Bakery & Desserts","value":"bakery"}]},
    {"key":"description","type":"textarea","label":"Short description","placeholder":"What you're known for","required":false}]},
  {"key":"location","title":"Location & service","description":"Where you cook and how far you deliver.","fields":[
    {"key":"address","type":"address","label":"Restaurant address","required":true},
    {"key":"delivery_radius","type":"number","label":"Delivery radius (km)","placeholder":"e.g. 8","required":true,"min":1,"max":30},
    {"key":"prep_time","type":"number","label":"Typical prep time (mins)","placeholder":"e.g. 25","required":false,"min":5,"max":120}]},
  {"key":"documents","title":"Documents","description":"We verify these before you go live.","fields":[
    {"key":"cac_doc","type":"document","label":"CAC certificate","required":false},
    {"key":"food_permit","type":"document","label":"Food handling / NAFDAC permit","required":true,"hasExpiry":true},
    {"key":"owner_id_doc","type":"document","label":"Owner's government-issued ID","required":true}]},
  {"key":"settlement","title":"Contact & settlement","description":"How we reach you and pay out earnings.","fields":[
    {"key":"contact_email","type":"email","label":"Business email","required":true},
    {"key":"contact_phone","type":"phone","label":"Business phone","required":true},
    {"key":"account_name","type":"text","label":"Settlement account name","placeholder":"As it appears on your bank account","required":true}]}
]
$json$::jsonb)
ON CONFLICT (id) DO NOTHING;
