-- Migration: nutrition_engine_core
-- Module: Nutrition Resolution Engine (NRE) — estimated nutrition + allergen data
--          for every orderable dish on the Spotlight marketplace.
-- ADDITIVE ONLY. No DROP, no column renames, no type narrowing.
--
-- Design principles encoded in the schema:
--   * NRE BINDS to existing menu_items (uuid PK); it NEVER widens menu_items.
--     Profiles/recipes/allergens are separate rows keyed by menu_item_id.
--   * "Never an anonymous number": every resolved value stores its source +
--     confidence + the composition_version it was pinned against.
--   * Allergens are SAFETY-CRITICAL and modelled separately + stricter than
--     nutrition. The AI-never-CONTAINS/FREE_FROM rule and the FREE_FROM
--     cross-contamination acknowledgement are enforced as DB CHECK constraints
--     (illegal states unreachable), not just in app code.
--   * Reference data is versioned; profiles pin the version used.
--   * Object-level authz: vendor actions are owned via
--     menu_items.restaurant_id -> restaurants.owner_id (the restaurant module's
--     assertOwner chain). We denormalize restaurant_id onto NRE rows for that.
--
-- NUTRITION values are real-number nutrient quantities (g / mg / kcal) — NUMERIC,
-- NOT integer kobo. (This is not a money module.)

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) composition_reference — seeded per-100g-edible-portion food composition.
--    Sources: WAFCT (FAO/INFOODS West African table), NFCT (Nigerian table),
--    OFF (Open Food Facts), FALLBACK (Western APIs, lowest precedence), CUSTOM.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.composition_reference (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  food_code    TEXT        NOT NULL,
  name         TEXT        NOT NULL,
  source       TEXT        NOT NULL CHECK (source IN ('WAFCT','NFCT','OFF','FALLBACK','CUSTOM')),
  prep_method  TEXT        NOT NULL DEFAULT 'raw'
                 CHECK (prep_method IN ('raw','boiled','grilled','stewed','fried','baked','roasted')),
  -- per 100 g edible portion
  energy_kcal  NUMERIC(8,2) CHECK (energy_kcal  >= 0),
  protein_g    NUMERIC(8,2) CHECK (protein_g    >= 0),
  carb_g       NUMERIC(8,2) CHECK (carb_g       >= 0),
  sugar_g      NUMERIC(8,2) CHECK (sugar_g      >= 0),
  fat_g        NUMERIC(8,2) CHECK (fat_g        >= 0),
  sat_fat_g    NUMERIC(8,2) CHECK (sat_fat_g    >= 0),
  fiber_g      NUMERIC(8,2) CHECK (fiber_g      >= 0),
  sodium_mg    NUMERIC(10,2) CHECK (sodium_mg   >= 0),
  micros       JSONB       NOT NULL DEFAULT '{}'::jsonb,  -- key micronutrients {iron_mg, vit_a_ug, ...}
  version      INTEGER     NOT NULL DEFAULT 1,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (food_code, source, prep_method, version)
);
CREATE INDEX IF NOT EXISTS idx_composition_reference_name ON public.composition_reference USING gin (to_tsvector('simple', name));
CREATE INDEX IF NOT EXISTS idx_composition_reference_code ON public.composition_reference (food_code);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) nutrition_dish_library — curated Nigerian composite dishes (Tier 2 source).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nutrition_dish_library (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  slug              TEXT        NOT NULL UNIQUE,
  name              TEXT        NOT NULL,
  aliases           TEXT[]      NOT NULL DEFAULT '{}',          -- for fuzzy name match
  standard_portion_g NUMERIC(8,2) NOT NULL CHECK (standard_portion_g > 0),
  cook_method       TEXT,
  components        JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{food_code,source,quantity_g,prep_method}]
  per_serving       JSONB       NOT NULL DEFAULT '{}'::jsonb,   -- precomputed {nutrient:{value,low,high}}
  composition_version INTEGER   NOT NULL DEFAULT 1,
  version           INTEGER     NOT NULL DEFAULT 1,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dish_library_name ON public.nutrition_dish_library USING gin (to_tsvector('simple', name));

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) dish_recipe — optional vendor-declared recipe (drives Tier 1, highest est.).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dish_recipe (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  UUID        NOT NULL UNIQUE REFERENCES public.menu_items(id) ON DELETE CASCADE,
  restaurant_id UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,  -- denormalized for authz
  ingredients   JSONB       NOT NULL DEFAULT '[]'::jsonb,   -- [{food_code,source,quantity_g,prep_method}]
  portion_size_g NUMERIC(8,2) NOT NULL CHECK (portion_size_g > 0),
  cook_method   TEXT,
  version       INTEGER     NOT NULL DEFAULT 1,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dish_recipe_restaurant ON public.dish_recipe (restaurant_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) dish_nutrition_profile — the resolved output bound to a menu item.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.dish_nutrition_profile (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id        UUID        NOT NULL UNIQUE REFERENCES public.menu_items(id) ON DELETE CASCADE,
  restaurant_id       UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,  -- authz denorm
  -- v2 (onboarding-first): grounding records WHERE the estimate came from (the
  -- AI is grounded on the composition tables/library; LABEL is the packaged
  -- fast-path; RECIPE is the optional hidden power-user path).
  grounding           TEXT        NOT NULL CHECK (grounding IN ('LABEL','LIBRARY_MATCHED','FREE_ESTIMATED','RECIPE')),
  confidence          TEXT        NOT NULL CHECK (confidence IN ('EXACT','MEDIUM','LOW')),
  -- Honesty machine: AI_ESTIMATE auto-published at menu upload; RESTAURANT_CONFIRMED
  -- is vendor-approved but STILL an estimate (approval != exact); EXACT is label-only.
  status              TEXT        NOT NULL DEFAULT 'AI_ESTIMATE'
                        CHECK (status IN ('AI_ESTIMATE','RESTAURANT_CONFIRMED','EXACT','STALE')),
  portion_label       TEXT        NOT NULL DEFAULT 'regular' CHECK (portion_label IN ('small','regular','large')),
  portion_size_g      NUMERIC(8,2) NOT NULL CHECK (portion_size_g > 0),
  -- {nutrient:{value,low,high}} per serving. EXACT/HIGH ⇒ low=high=value.
  per_serving         JSONB       NOT NULL DEFAULT '{}'::jsonb,
  composition_version INTEGER,                                  -- pinned reference version
  confirmed_by        UUID        REFERENCES auth.users(id),
  confirmed_at        TIMESTAMPTZ,
  resolved_at         TIMESTAMPTZ,
  version             INTEGER     NOT NULL DEFAULT 0,           -- optimistic lock for the status machine
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_dish_profile_restaurant ON public.dish_nutrition_profile (restaurant_id);
CREATE INDEX IF NOT EXISTS idx_dish_profile_status     ON public.dish_nutrition_profile (status);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4b) nutrition_library_feedback — the learn-from-edits loop (§11.6). When a
--     vendor edits a dish that matched a library entry, the edited per-serving is
--     recorded here so Ops can refine the library's standard profile over time.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nutrition_library_feedback (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  library_slug  TEXT        NOT NULL,                          -- the matched dish library slug
  menu_item_id  UUID        REFERENCES public.menu_items(id) ON DELETE SET NULL,
  restaurant_id UUID        REFERENCES public.restaurants(id) ON DELETE SET NULL,
  portion_size_g NUMERIC(8,2),
  per_serving   JSONB       NOT NULL DEFAULT '{}'::jsonb,      -- the vendor-edited values
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nutrition_feedback_slug ON public.nutrition_library_feedback (library_slug, created_at);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) allergen_declaration — SAFETY-CRITICAL, separate + stricter than nutrition.
--    DB constraints enforce the non-negotiable safety rules structurally.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.allergen_declaration (
  id            UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id  UUID        NOT NULL REFERENCES public.menu_items(id) ON DELETE CASCADE,
  restaurant_id UUID        NOT NULL REFERENCES public.restaurants(id) ON DELETE CASCADE,  -- authz denorm
  allergen      TEXT        NOT NULL CHECK (allergen IN (
                   'peanut','tree_nut','milk','egg','fish','crustacean_shellfish',
                   'soy','wheat_gluten','sesame','mustard','celery','sulphites','lupin')),
  declaration_type TEXT     NOT NULL CHECK (declaration_type IN ('CONTAINS','MAY_CONTAIN','FREE_FROM')),
  source        TEXT        NOT NULL DEFAULT 'VENDOR' CHECK (source IN ('VENDOR','AI')),
  attested_by   UUID        REFERENCES auth.users(id),
  attested_at   TIMESTAMPTZ,
  cross_contamination_ack BOOLEAN NOT NULL DEFAULT FALSE,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (menu_item_id, allergen, source),
  -- SAFETY RULE 1: AI may NEVER set CONTAINS or FREE_FROM (suggestions only, as MAY_CONTAIN).
  CONSTRAINT allergen_ai_may_contain_only
    CHECK (NOT (source = 'AI' AND declaration_type IN ('CONTAINS','FREE_FROM'))),
  -- SAFETY RULE 2: CONTAINS / FREE_FROM are vendor-ATTESTED only (require an attester).
  CONSTRAINT allergen_definitive_requires_attestation
    CHECK (declaration_type = 'MAY_CONTAIN' OR attested_by IS NOT NULL),
  -- SAFETY RULE 3: FREE_FROM requires explicit cross-contamination acknowledgement.
  CONSTRAINT allergen_free_from_requires_ack
    CHECK (declaration_type <> 'FREE_FROM' OR cross_contamination_ack = TRUE)
);
CREATE INDEX IF NOT EXISTS idx_allergen_decl_item ON public.allergen_declaration (menu_item_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) nutrition_audit_log — immutable record of AI estimates + vendor attestations.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.nutrition_audit_log (
  id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  menu_item_id UUID        REFERENCES public.menu_items(id) ON DELETE CASCADE,
  actor_id     UUID,                                           -- vendor/admin; NULL = system/AI
  action       TEXT        NOT NULL,                           -- NUTRITION_ESTIMATE | NUTRITION_CONFIRM | ALLERGEN_ATTEST | ...
  before       JSONB,
  after        JSONB,
  metadata     JSONB       NOT NULL DEFAULT '{}'::jsonb,       -- {model, tier, source, confidence}
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_nutrition_audit_item ON public.nutrition_audit_log (menu_item_id, created_at);

-- updated_at triggers (reuse shared public.handle_updated_at()).
DROP TRIGGER IF EXISTS trg_composition_reference_updated ON public.composition_reference;
CREATE TRIGGER trg_composition_reference_updated BEFORE UPDATE ON public.composition_reference FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_dish_library_updated         ON public.nutrition_dish_library;
CREATE TRIGGER trg_dish_library_updated         BEFORE UPDATE ON public.nutrition_dish_library  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_dish_recipe_updated          ON public.dish_recipe;
CREATE TRIGGER trg_dish_recipe_updated          BEFORE UPDATE ON public.dish_recipe             FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_dish_profile_updated         ON public.dish_nutrition_profile;
CREATE TRIGGER trg_dish_profile_updated         BEFORE UPDATE ON public.dish_nutrition_profile  FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();
DROP TRIGGER IF EXISTS trg_allergen_decl_updated        ON public.allergen_declaration;
CREATE TRIGGER trg_allergen_decl_updated        BEFORE UPDATE ON public.allergen_declaration    FOR EACH ROW EXECUTE FUNCTION public.handle_updated_at();

-- ─────────────────────────────────────────────────────────────────────────────
-- RLS — reference + profiles + allergens are world-readable (buyer-facing). Only
-- service_role (Go pgx pool) writes. dish_recipe is vendor-owned (read via owner).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.composition_reference   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_dish_library  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dish_recipe             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dish_nutrition_profile  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.allergen_declaration    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_audit_log     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nutrition_library_feedback ENABLE ROW LEVEL SECURITY;  -- service_role only (no policy)

DROP POLICY IF EXISTS "composition_reference_read" ON public.composition_reference;
CREATE POLICY "composition_reference_read" ON public.composition_reference FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "dish_library_read" ON public.nutrition_dish_library;
CREATE POLICY "dish_library_read" ON public.nutrition_dish_library FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "dish_profile_read" ON public.dish_nutrition_profile;
CREATE POLICY "dish_profile_read" ON public.dish_nutrition_profile FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "allergen_decl_read" ON public.allergen_declaration;
CREATE POLICY "allergen_decl_read" ON public.allergen_declaration FOR SELECT TO anon, authenticated USING (TRUE);
DROP POLICY IF EXISTS "dish_recipe_read_own" ON public.dish_recipe;
CREATE POLICY "dish_recipe_read_own" ON public.dish_recipe FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM public.restaurants r WHERE r.id = dish_recipe.restaurant_id AND r.owner_id = auth.uid()));

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED — REPRESENTATIVE SAMPLE ONLY (idempotent). These are illustrative values
-- to make the engine runnable end-to-end. The full FAO/INFOODS WAFCT 2019
-- (~1,028 items) + NFCT 2017 (282 foods) ingestion is a DATA task to run with the
-- official CSVs via the ingestion scaffold (scripts/nutrition/ingest_wafct.*);
-- these seeds are tagged version=1 and must be superseded by the real import.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.composition_reference
  (food_code, name, source, prep_method, energy_kcal, protein_g, carb_g, sugar_g, fat_g, sat_fat_g, fiber_g, sodium_mg)
VALUES
  ('WAFCT-0010','Rice, white, boiled',        'WAFCT','boiled', 130, 2.7, 28.0, 0.1, 0.3, 0.1, 0.4,   1),
  ('WAFCT-0042','Rice, jollof (composite)',   'WAFCT','stewed', 165, 3.2, 24.0, 1.8, 6.0, 1.6, 1.0, 380),
  ('WAFCT-0101','Egusi soup (composite)',     'WAFCT','stewed', 180, 8.0,  6.0, 1.2,14.0, 3.5, 2.5, 420),
  ('WAFCT-0150','Beans, cowpea, boiled',      'WAFCT','boiled', 116, 7.7, 20.0, 0.6, 0.5, 0.1, 6.5,   2),
  ('WAFCT-0160','Plantain, ripe, fried (dodo)','WAFCT','fried', 220, 1.5, 32.0,14.0,10.0, 4.0, 2.2,   6),
  ('WAFCT-0200','Beef suya (grilled, spiced)','WAFCT','grilled',240,26.0,  3.0, 0.5,13.0, 5.0, 0.8, 520),
  ('WAFCT-0210','Chicken, grilled',           'WAFCT','grilled',190,29.0,  0.0, 0.0, 7.5, 2.1, 0.0,  85),
  ('NFCT-0301', 'Amala (yam flour), cooked',  'NFCT', 'boiled', 120, 1.4, 28.0, 0.4, 0.2, 0.0, 1.6,   3),
  ('NFCT-0305', 'Ewedu soup',                 'NFCT', 'boiled',  45, 3.0,  5.0, 0.8, 1.0, 0.2, 3.0, 180),
  ('NFCT-0320', 'Pepper soup (assorted meat)','NFCT', 'stewed',  95,11.0,  2.0, 0.6, 4.5, 1.5, 0.5, 300),
  ('WAFCT-0400','Palm oil',                   'WAFCT','raw',     884, 0.0,  0.0, 0.0,100.0,49.3, 0.0,   0)
ON CONFLICT (food_code, source, prep_method, version) DO NOTHING;

INSERT INTO public.nutrition_dish_library
  (slug, name, aliases, standard_portion_g, cook_method, per_serving)
VALUES
  ('jollof-rice','Jollof Rice', ARRAY['jollof','party rice','jollof rice'], 350, 'stewed',
     '{"energy_kcal":{"value":578,"low":520,"high":640},"protein_g":{"value":11,"low":9,"high":14},"carb_g":{"value":84,"low":76,"high":92},"sugar_g":{"value":6,"low":4,"high":9},"fat_g":{"value":21,"low":16,"high":26},"sat_fat_g":{"value":6,"low":4,"high":8},"fiber_g":{"value":4,"low":3,"high":5},"sodium_mg":{"value":1330,"low":1100,"high":1600}}'::jsonb),
  ('fried-rice','Nigerian Fried Rice', ARRAY['fried rice'], 350, 'stir-fried',
     '{"energy_kcal":{"value":560,"low":500,"high":620},"protein_g":{"value":13,"low":10,"high":16},"carb_g":{"value":80,"low":72,"high":88},"sugar_g":{"value":5,"low":3,"high":8},"fat_g":{"value":20,"low":15,"high":25},"sat_fat_g":{"value":5,"low":4,"high":7},"fiber_g":{"value":4,"low":3,"high":6},"sodium_mg":{"value":1250,"low":1000,"high":1500}}'::jsonb),
  ('egusi-soup','Egusi Soup', ARRAY['egusi','melon soup'], 300, 'stewed',
     '{"energy_kcal":{"value":540,"low":470,"high":610},"protein_g":{"value":24,"low":19,"high":29},"carb_g":{"value":18,"low":13,"high":23},"sugar_g":{"value":4,"low":2,"high":6},"fat_g":{"value":42,"low":34,"high":50},"sat_fat_g":{"value":11,"low":8,"high":14},"fiber_g":{"value":8,"low":6,"high":10},"sodium_mg":{"value":1260,"low":1000,"high":1500}}'::jsonb),
  ('ofada-rice','Ofada Rice & Ayamase', ARRAY['ofada','designer stew'], 380, 'stewed',
     '{"energy_kcal":{"value":610,"low":540,"high":680},"protein_g":{"value":15,"low":11,"high":19},"carb_g":{"value":78,"low":70,"high":86},"sugar_g":{"value":5,"low":3,"high":8},"fat_g":{"value":27,"low":21,"high":33},"sat_fat_g":{"value":7,"low":5,"high":9},"fiber_g":{"value":5,"low":3,"high":7},"sodium_mg":{"value":1400,"low":1150,"high":1650}}'::jsonb),
  ('amala-ewedu','Amala & Ewedu', ARRAY['amala','amala ewedu gbegiri'], 400, 'boiled',
     '{"energy_kcal":{"value":430,"low":370,"high":490},"protein_g":{"value":12,"low":9,"high":15},"carb_g":{"value":74,"low":66,"high":82},"sugar_g":{"value":3,"low":2,"high":5},"fat_g":{"value":9,"low":6,"high":12},"sat_fat_g":{"value":2,"low":1,"high":3},"fiber_g":{"value":7,"low":5,"high":9},"sodium_mg":{"value":760,"low":600,"high":950}}'::jsonb),
  ('beans-plantain','Beans & Plantain', ARRAY['beans and dodo','ewa dodo'], 380, 'boiled',
     '{"energy_kcal":{"value":520,"low":460,"high":580},"protein_g":{"value":18,"low":14,"high":22},"carb_g":{"value":82,"low":74,"high":90},"sugar_g":{"value":12,"low":9,"high":16},"fat_g":{"value":14,"low":10,"high":18},"sat_fat_g":{"value":4,"low":3,"high":6},"fiber_g":{"value":14,"low":11,"high":17},"sodium_mg":{"value":420,"low":300,"high":560}}'::jsonb),
  ('suya','Beef Suya', ARRAY['suya','tsire'], 180, 'grilled',
     '{"energy_kcal":{"value":430,"low":380,"high":480},"protein_g":{"value":47,"low":40,"high":54},"carb_g":{"value":5,"low":3,"high":8},"sugar_g":{"value":1,"low":0,"high":2},"fat_g":{"value":23,"low":18,"high":28},"sat_fat_g":{"value":9,"low":6,"high":12},"fiber_g":{"value":1,"low":0,"high":2},"sodium_mg":{"value":940,"low":700,"high":1200}}'::jsonb),
  ('pepper-soup','Pepper Soup', ARRAY['pepper soup','point and kill'], 350, 'stewed',
     '{"energy_kcal":{"value":230,"low":180,"high":290},"protein_g":{"value":28,"low":22,"high":34},"carb_g":{"value":6,"low":3,"high":9},"sugar_g":{"value":2,"low":1,"high":3},"fat_g":{"value":11,"low":7,"high":15},"sat_fat_g":{"value":4,"low":2,"high":6},"fiber_g":{"value":2,"low":1,"high":3},"sodium_mg":{"value":1050,"low":800,"high":1300}}'::jsonb)
ON CONFLICT (slug) DO NOTHING;

COMMIT;
