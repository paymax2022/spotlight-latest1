-- Migration: pharmacy_symptom_search
-- Module: Pharmacy symptom-based medication search — pharmacist-approved
--         taxonomy (term → concept → condition cluster → therapeutic class →
--         live SKUs) with triage tiers T1–T4 and a gated review-case machine.
-- Ref: contracts/openapi.yaml (/pharmacy/symptom-search, /pharmacy/classes/{id}/skus,
--      /admin/pharmacy/mappings, /admin/pharmacy/reviews/{id}/decision),
--      docs/adr/ADR-016-pharmacy-symptom-search.md.
-- Gated by FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED (default off).
--
-- ADDITIVE ONLY. No DROP TABLE / DROP COLUMN / RENAME / type narrowing
-- (DROP POLICY IF EXISTS only — the documented re-runnable pattern).
-- Existing pharmacy_products / pharmacy_orders are NOT altered — SKU-level
-- commerce attributes live in the new pharmacy_skus table.
--
-- Design principles encoded in the schema:
--   * NOT diagnosis, NOT prescribing. The taxonomy resolves symptoms to
--     "options for your symptoms" — copy is versioned (symptom_disclaimer_versions).
--   * Everything user-visible is pharmacist-approved: AI_SUGGESTED rows are
--     invisible until APPROVED (status machine + approved_at CHECK).
--   * Taxonomy rows are never hard-deleted — status = RETIRED only.
--   * Fail-closed safety: unclassified SKUs default to BLOCKED_ONLINE;
--     T3/T4 clusters can never map to product classes (enforced by trigger-free
--     app logic + surfaced only via APPROVED cluster_class_map rows).
--   * NDPR: symptom queries are sensitive health data — symptom_search_events
--     is service_role-only, keyed by device_hash for rate limiting, and holds
--     the unmatched-term curation loop.
--
-- ── cluster_rule expression grammar (evaluated in Go, stored as text) ─────────
--   rule        := or_expr
--   or_expr     := and_expr { "OR" and_expr }
--   and_expr    := unary { "AND" unary }
--   unary       := [ "NOT" ] primary
--   primary     := "(" or_expr ")" | predicate
--   predicate   := "concept:" CODE                    -- CODE := [a-z][a-z0-9_]*
--                | "who:" COHORT                      -- COHORT ∈ {ADULT, CHILD_6_12,
--                                                     --   CHILD_UNDER_6, PREGNANT_OR_BF}
--                | "duration_days" OP INT             -- OP ∈ { < , <= , = , >= , > }
--                | "term_count" OP INT
--   Precedence: NOT > AND > OR. Keywords are case-sensitive UPPERCASE.
--   Semantics: concept:X is true iff X is among the concepts the user's terms
--   resolved to; who: matches only an EXPLICITLY selected cohort refiner;
--   duration buckets map TODAY→1, D2_3→3, GT_3D→4 days.
--   Fail-closed: an APPROVED rule that fails to parse at evaluation time forces
--   escalation to T3 (never silently skipped).
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) symptom_concepts — canonical clinical concepts terms resolve to.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.symptom_concepts (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name         text NOT NULL,
  description  text NOT NULL DEFAULT '',
  status       text NOT NULL DEFAULT 'AI_SUGGESTED'
                 CHECK (status IN ('AI_SUGGESTED','APPROVED','RETIRED')),
  suggested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  -- nothing AI-drafted is user-visible until approval is stamped
  CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) symptom_terms — multilingual surface forms (EN / Pidgin / Hausa / Yoruba /
--    Igbo) mapping raw user input to a concept.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.symptom_terms (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  term         text NOT NULL CHECK (length(btrim(term)) BETWEEN 2 AND 80),
  language     text NOT NULL CHECK (language IN ('en','pcm','ha','yo','ig')),
  concept_id   uuid NOT NULL REFERENCES public.symptom_concepts(id) ON DELETE RESTRICT,
  status       text NOT NULL DEFAULT 'AI_SUGGESTED'
                 CHECK (status IN ('AI_SUGGESTED','APPROVED','RETIRED')),
  suggested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_symptom_terms_term_lang
  ON public.symptom_terms (lower(btrim(term)), language);
CREATE INDEX IF NOT EXISTS idx_symptom_terms_concept ON public.symptom_terms (concept_id);
CREATE INDEX IF NOT EXISTS idx_symptom_terms_lookup
  ON public.symptom_terms (lower(btrim(term))) WHERE status = 'APPROVED';

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) symptom_clusters — condition clusters carrying the BASE triage tier.
--    T1 self-care · T2 pharmacist-guided · T3 consult · T4 emergency.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.symptom_clusters (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name         text NOT NULL,
  triage_tier  text NOT NULL CHECK (triage_tier IN ('T1','T2','T3','T4')),
  status       text NOT NULL DEFAULT 'AI_SUGGESTED'
                 CHECK (status IN ('AI_SUGGESTED','APPROVED','RETIRED')),
  suggested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL)
);

-- membership: cluster matches when ANY member concept matched
CREATE TABLE IF NOT EXISTS public.symptom_cluster_concepts (
  cluster_id  uuid NOT NULL REFERENCES public.symptom_clusters(id) ON DELETE CASCADE,
  concept_id  uuid NOT NULL REFERENCES public.symptom_concepts(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, concept_id)
);
CREATE INDEX IF NOT EXISTS idx_cluster_concepts_concept
  ON public.symptom_cluster_concepts (concept_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) therapeutic_classes — product class groups (created before cluster_rules,
--    which FK-references it for SUPPRESS_CLASS effects).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.therapeutic_classes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code         text NOT NULL UNIQUE CHECK (code ~ '^[a-z][a-z0-9_]*$'),
  name         text NOT NULL,                    -- e.g. "Pain & fever relief (Paracetamol-based)"
  usage_note   text NOT NULL DEFAULT '',         -- label-level guidance ONLY, never dosing advice
  status       text NOT NULL DEFAULT 'AI_SUGGESTED'
                 CHECK (status IN ('AI_SUGGESTED','APPROVED','RETIRED')),
  suggested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at  timestamptz,
  version      integer NOT NULL DEFAULT 1,
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL)
);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) symptom_cluster_rules — expression-driven refinements on a matched cluster.
--    Exactly one effect shape per row (CHECK-enforced): ESCALATE raises the tier,
--    REQUIRE_CONFIRMATION forces the T2 pharmacist gate, SUPPRESS_CLASS removes
--    a therapeutic class entirely (never shown-but-disabled).
--    Lower priority = evaluated first; all matching rules apply; highest
--    resulting tier wins.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.symptom_cluster_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  cluster_id        uuid NOT NULL REFERENCES public.symptom_clusters(id) ON DELETE CASCADE,
  expression        text NOT NULL
                      CHECK (length(btrim(expression)) BETWEEN 1 AND 500)
                      -- token whitelist guard; full grammar parsed in Go (see header)
                      CHECK (expression ~ '^[A-Za-z0-9_():<>= -]+$'),
  priority          integer NOT NULL DEFAULT 100,
  effect            text NOT NULL
                      CHECK (effect IN ('ESCALATE','REQUIRE_CONFIRMATION','SUPPRESS_CLASS')),
  escalate_to_tier  text CHECK (escalate_to_tier IN ('T2','T3','T4')),
  suppress_class_id uuid REFERENCES public.therapeutic_classes(id) ON DELETE CASCADE,
  reason            text NOT NULL DEFAULT '',  -- human-readable, surfaces in escalation_card.flagged
  status            text NOT NULL DEFAULT 'AI_SUGGESTED'
                      CHECK (status IN ('AI_SUGGESTED','APPROVED','RETIRED')),
  suggested_by      uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_by       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  approved_at       timestamptz,
  version           integer NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'APPROVED' OR approved_at IS NOT NULL),
  -- effect shape: illegal states unreachable
  CHECK (
    (effect = 'ESCALATE'             AND escalate_to_tier IS NOT NULL AND suppress_class_id IS NULL) OR
    (effect = 'SUPPRESS_CLASS'       AND suppress_class_id IS NOT NULL AND escalate_to_tier IS NULL) OR
    (effect = 'REQUIRE_CONFIRMATION' AND escalate_to_tier IS NULL     AND suppress_class_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS idx_cluster_rules_cluster
  ON public.symptom_cluster_rules (cluster_id, priority) WHERE status = 'APPROVED';

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) symptom_cluster_class_map — cluster→class surface (T1/T2 clusters only;
--    red-flag clusters map to nothing).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.symptom_cluster_class_map (
  cluster_id  uuid NOT NULL REFERENCES public.symptom_clusters(id) ON DELETE CASCADE,
  class_id    uuid NOT NULL REFERENCES public.therapeutic_classes(id) ON DELETE CASCADE,
  rank        integer NOT NULL DEFAULT 1 CHECK (rank >= 1),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (cluster_id, class_id)
);
CREATE INDEX IF NOT EXISTS idx_cluster_class_map_class
  ON public.symptom_cluster_class_map (class_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) pharmacy_skus — SKU-level commerce attributes for the symptom surface.
--    Kept as a NEW table so existing pharmacy_products is untouched (brownfield).
--    Fail-closed: classification defaults to BLOCKED_ONLINE — an unclassified
--    SKU can never surface from symptom search. Only OTC / PHARMACY_ONLY are
--    ever returned on this surface (read-path filter in Go).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pharmacy_skus (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id           uuid NOT NULL REFERENCES public.pharmacy_products(id) ON DELETE CASCADE,
  therapeutic_class_id uuid REFERENCES public.therapeutic_classes(id) ON DELETE SET NULL,
  brand                text NOT NULL DEFAULT '',
  pack_size            text NOT NULL DEFAULT '',
  price_kobo           bigint NOT NULL CHECK (price_kobo > 0),  -- minor units, never floats
  nafdac_reg_no        text,                                    -- NULL ⇒ falls back to product.nafdac_ref
  classification       text NOT NULL DEFAULT 'BLOCKED_ONLINE'
                         CHECK (classification IN ('OTC','PHARMACY_ONLY','POM','BLOCKED_ONLINE')),
  region               text NOT NULL DEFAULT '',                -- fulfilment region (e.g. lagos); '' = all
  in_stock             boolean NOT NULL DEFAULT false,
  age_min_years        integer CHECK (age_min_years IS NULL OR age_min_years >= 0),
  pregnancy_safe       boolean NOT NULL DEFAULT false,          -- fail-closed for PREGNANT_OR_BF cohort
  max_qty_per_window   integer CHECK (max_qty_per_window IS NULL OR max_qty_per_window > 0),
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_pharmacy_skus_class_live
  ON public.pharmacy_skus (therapeutic_class_id)
  WHERE active = true AND in_stock = true AND classification IN ('OTC','PHARMACY_ONLY');
CREATE INDEX IF NOT EXISTS idx_pharmacy_skus_product ON public.pharmacy_skus (product_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 8) pharmacy_review_cases — gated review state machine for T2 checkouts.
--    SUBMITTED → AUTO_CLEARED | PHARMACIST_REVIEW; PHARMACIST_REVIEW →
--    APPROVED | REJECTED | NEEDS_INFO; NEEDS_INFO → PHARMACIST_REVIEW.
--    Object-level authz: a pharmacist decides only cases of their premises
--    tenant (pharmacy_provider_id). REJECT triggers the ledger refund path.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pharmacy_review_cases (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id             uuid NOT NULL UNIQUE REFERENCES public.pharmacy_orders(id) ON DELETE CASCADE,
  pharmacy_provider_id uuid NOT NULL REFERENCES public.health_providers(id) ON DELETE CASCADE, -- premises tenant (authz)
  tier                 text NOT NULL CHECK (tier IN ('T1','T2','T3','T4')),
  state                text NOT NULL DEFAULT 'SUBMITTED'
                         CHECK (state IN ('SUBMITTED','AUTO_CLEARED','PHARMACIST_REVIEW',
                                          'NEEDS_INFO','APPROVED','REJECTED')),
  pharmacist_id        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  decision_note        text,
  sla_deadline         timestamptz NOT NULL,
  version              integer NOT NULL DEFAULT 0,   -- optimistic lock for the state machine
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  -- REJECTED / NEEDS_INFO always carry a note
  CHECK (state NOT IN ('REJECTED','NEEDS_INFO') OR decision_note IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_review_cases_tenant_state
  ON public.pharmacy_review_cases (pharmacy_provider_id, state);
CREATE INDEX IF NOT EXISTS idx_review_cases_sla
  ON public.pharmacy_review_cases (sla_deadline) WHERE state IN ('SUBMITTED','PHARMACIST_REVIEW');

-- ─────────────────────────────────────────────────────────────────────────────
-- 9) symptom_search_events — NDPR-sensitive query log. Service-role only.
--    Drives per-device rate limiting and the unmatched-term curation loop.
--    Excluded from general analytics by construction (no RLS read path).
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.symptom_search_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  device_hash     text NOT NULL,          -- salted hash; never the raw device id
  terms           text[] NOT NULL,
  refiners        jsonb NOT NULL DEFAULT '{}'::jsonb,
  matched         boolean NOT NULL,
  resolved_tier   text CHECK (resolved_tier IN ('T1','T2','T3','T4')),
  unmatched_terms text[] NOT NULL DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_symptom_events_device
  ON public.symptom_search_events (device_hash, created_at);
CREATE INDEX IF NOT EXISTS idx_symptom_events_unmatched
  ON public.symptom_search_events (created_at) WHERE matched = false;

-- ─────────────────────────────────────────────────────────────────────────────
-- 10) symptom_disclaimer_versions — versioned surface copy ("options for your
--    symptoms", never "treatment for your condition").
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.symptom_disclaimer_versions (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version    integer NOT NULL UNIQUE,
  body       text NOT NULL,
  active     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ─────────────────────────────────────────────────────────────────────────────
-- ROW LEVEL SECURITY — the taxonomy is server-mediated (anti-scraping: raw
-- mappings are never exposed to clients; resolution happens via the Go service
-- with service_role). Admin console reads via is_admin(). Search events are
-- service_role ONLY (sensitive health data).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.symptom_concepts            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_terms               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_clusters            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_cluster_concepts    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_cluster_rules       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.therapeutic_classes         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_cluster_class_map   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_skus               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pharmacy_review_cases       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_search_events       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.symptom_disclaimer_versions ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'symptom_concepts','symptom_terms','symptom_clusters','symptom_cluster_concepts',
    'symptom_cluster_rules','therapeutic_classes','symptom_cluster_class_map',
    'pharmacy_skus','pharmacy_review_cases','symptom_search_events',
    'symptom_disclaimer_versions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_service', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I TO service_role USING (TRUE) WITH CHECK (TRUE)',
      t || '_service', t);
  END LOOP;
END $$;

-- Admin console read on taxonomy + review cases (NOT on search events).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'symptom_concepts','symptom_terms','symptom_clusters','symptom_cluster_concepts',
    'symptom_cluster_rules','therapeutic_classes','symptom_cluster_class_map',
    'pharmacy_skus','pharmacy_review_cases','symptom_disclaimer_versions'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_admin_read', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_admin())',
      t || '_admin_read', t);
  END LOOP;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- RBAC — pharmacist console permissions. Additive; mirrors health.pharmacy.*.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Pharmacy Symptom Taxonomy (Pharmacist Console)', 'health.pharmacy.symptom.mappings', 'health','pharmacy','manage',
   'Suggest/approve/retire symptom taxonomy: terms, concepts, clusters, cluster rules, therapeutic classes, cluster-class maps', true),
  ('Pharmacy Symptom Review Cases (Pharmacist Console)', 'health.pharmacy.symptom.reviews', 'health','pharmacy','manage',
   'Decide gated review cases (APPROVE / REJECT / NEEDS_INFO) for own premises tenant', true)
ON CONFLICT (slug) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.pharmacy.symptom.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'super-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

WITH p AS (SELECT id FROM public.permissions WHERE slug LIKE 'health.pharmacy.symptom.%')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT (SELECT id FROM public.roles WHERE slug = 'system-admin'), p.id FROM p
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- SEED DATA — pharmacist-approved starter taxonomy (fixed UUIDs for FK wiring).
-- approved_by is NULL for system seeds; approved_at satisfies the CHECK.
-- ─────────────────────────────────────────────────────────────────────────────

-- concepts
INSERT INTO public.symptom_concepts (id, code, name, status, approved_at) VALUES
  ('c0000000-0000-4000-8000-000000000001','fever',          'Fever / high temperature','APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000002','headache',       'Headache',                'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000003','cough',          'Cough',                   'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000004','catarrh',        'Catarrh / nasal congestion','APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000005','sore_throat',    'Sore throat',             'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000006','body_pain',      'Body pain / aches',       'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000007','diarrhea',       'Diarrhoea / purging',     'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000008','chest_pain',     'Chest pain',              'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000009','blood_in_stool', 'Blood in stool',          'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000000a','convulsion',     'Convulsion / seizure',    'APPROVED', now())
ON CONFLICT (code) DO NOTHING;

-- terms (multilingual surface forms)
INSERT INTO public.symptom_terms (term, language, concept_id, status, approved_at) VALUES
  ('fever',          'en',  'c0000000-0000-4000-8000-000000000001','APPROVED', now()),
  ('temperature',    'en',  'c0000000-0000-4000-8000-000000000001','APPROVED', now()),
  ('body dey hot',   'pcm', 'c0000000-0000-4000-8000-000000000001','APPROVED', now()),
  ('zazzabi',        'ha',  'c0000000-0000-4000-8000-000000000001','APPROVED', now()),
  ('iba',            'yo',  'c0000000-0000-4000-8000-000000000001','APPROVED', now()),
  ('ahu oku',        'ig',  'c0000000-0000-4000-8000-000000000001','APPROVED', now()),
  ('headache',       'en',  'c0000000-0000-4000-8000-000000000002','APPROVED', now()),
  ('head dey pain me','pcm','c0000000-0000-4000-8000-000000000002','APPROVED', now()),
  ('ciwon kai',      'ha',  'c0000000-0000-4000-8000-000000000002','APPROVED', now()),
  ('efori',          'yo',  'c0000000-0000-4000-8000-000000000002','APPROVED', now()),
  ('isi mgbu',       'ig',  'c0000000-0000-4000-8000-000000000002','APPROVED', now()),
  ('cough',          'en',  'c0000000-0000-4000-8000-000000000003','APPROVED', now()),
  ('catarrh',        'en',  'c0000000-0000-4000-8000-000000000004','APPROVED', now()),
  ('sore throat',    'en',  'c0000000-0000-4000-8000-000000000005','APPROVED', now()),
  ('throat dey pain','pcm', 'c0000000-0000-4000-8000-000000000005','APPROVED', now()),
  ('body pain',      'en',  'c0000000-0000-4000-8000-000000000006','APPROVED', now()),
  ('diarrhea',       'en',  'c0000000-0000-4000-8000-000000000007','APPROVED', now()),
  ('purging',        'en',  'c0000000-0000-4000-8000-000000000007','APPROVED', now()),
  ('belle dey run',  'pcm', 'c0000000-0000-4000-8000-000000000007','APPROVED', now()),
  ('chest pain',     'en',  'c0000000-0000-4000-8000-000000000008','APPROVED', now()),
  ('blood in stool', 'en',  'c0000000-0000-4000-8000-000000000009','APPROVED', now()),
  ('convulsion',     'en',  'c0000000-0000-4000-8000-00000000000a','APPROVED', now())
ON CONFLICT DO NOTHING;

-- therapeutic classes
INSERT INTO public.therapeutic_classes (id, code, name, usage_note, status, approved_at) VALUES
  ('d0000000-0000-4000-8000-000000000001','analgesic_antipyretic','Pain & fever relief (Paracetamol-based)',
     'Follow the pack label. Do not combine with other paracetamol products.','APPROVED', now()),
  ('d0000000-0000-4000-8000-000000000002','nsaid','Pain & inflammation relief (Ibuprofen-based)',
     'Not on an empty stomach.','APPROVED', now()),
  ('d0000000-0000-4000-8000-000000000003','antihistamine_decongestant','Cold & allergy relief (antihistamines / decongestants)',
     'May cause drowsiness.','APPROVED', now()),
  ('d0000000-0000-4000-8000-000000000004','cough_expectorant','Cough relief (syrups / expectorants)',
     'Follow the pack label.','APPROVED', now()),
  ('d0000000-0000-4000-8000-000000000005','ors_zinc','Rehydration (ORS + zinc)',
     'Prepare with clean water exactly per sachet instructions.','APPROVED', now())
ON CONFLICT (code) DO NOTHING;

-- clusters (base tiers)
INSERT INTO public.symptom_clusters (id, code, name, triage_tier, status, approved_at) VALUES
  ('e0000000-0000-4000-8000-000000000001','headache_body_pain', 'Headache & body pain',            'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000002','common_cold_cough',  'Common cold, catarrh & cough',    'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000003','fever_uncomplicated','Fever (uncomplicated, short)',    'T2','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000004','diarrhea_acute',     'Acute diarrhoea',                 'T2','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000005','chest_pain_redflag', 'Chest pain (red flag)',           'T4','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000006','gi_bleed_redflag',   'Blood in stool (red flag)',       'T4','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000007','convulsion_redflag', 'Convulsion (red flag)',           'T4','APPROVED', now())
ON CONFLICT (code) DO NOTHING;

-- cluster membership
INSERT INTO public.symptom_cluster_concepts (cluster_id, concept_id) VALUES
  ('e0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000002'), -- headache
  ('e0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-000000000006'), -- body_pain
  ('e0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000003'), -- cough
  ('e0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000004'), -- catarrh
  ('e0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000005'), -- sore_throat
  ('e0000000-0000-4000-8000-000000000003','c0000000-0000-4000-8000-000000000001'), -- fever
  ('e0000000-0000-4000-8000-000000000004','c0000000-0000-4000-8000-000000000007'), -- diarrhea
  ('e0000000-0000-4000-8000-000000000005','c0000000-0000-4000-8000-000000000008'), -- chest_pain
  ('e0000000-0000-4000-8000-000000000006','c0000000-0000-4000-8000-000000000009'), -- blood_in_stool
  ('e0000000-0000-4000-8000-000000000007','c0000000-0000-4000-8000-00000000000a')  -- convulsion
ON CONFLICT DO NOTHING;

-- cluster → class maps (T1/T2 clusters only — red-flag clusters map to NOTHING)
INSERT INTO public.symptom_cluster_class_map (cluster_id, class_id, rank) VALUES
  ('e0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000001',1), -- headache → paracetamol
  ('e0000000-0000-4000-8000-000000000001','d0000000-0000-4000-8000-000000000002',2), -- headache → nsaid
  ('e0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000003',1), -- cold → antihistamine
  ('e0000000-0000-4000-8000-000000000002','d0000000-0000-4000-8000-000000000004',2), -- cold → cough syrup
  ('e0000000-0000-4000-8000-000000000003','d0000000-0000-4000-8000-000000000001',1), -- fever → paracetamol
  ('e0000000-0000-4000-8000-000000000004','d0000000-0000-4000-8000-000000000005',1)  -- diarrhoea → ORS+zinc
ON CONFLICT DO NOTHING;

-- cluster rules (see grammar in header)
INSERT INTO public.symptom_cluster_rules
  (cluster_id, expression, priority, effect, escalate_to_tier, suppress_class_id, reason, status, approved_at)
VALUES
  -- fever: >3 days ⇒ consult; under-6 child ⇒ consult; pregnant/BF ⇒ pharmacist gate
  ('e0000000-0000-4000-8000-000000000003','duration_days > 3',                 10,'ESCALATE','T3',NULL,
     'fever for more than 3 days','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000003','who:CHILD_UNDER_6',                 20,'ESCALATE','T3',NULL,
     'fever in a child under 6','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000003','who:PREGNANT_OR_BF',                30,'REQUIRE_CONFIRMATION',NULL,NULL,
     'fever while pregnant or breastfeeding','APPROVED', now()),
  -- headache/body pain: prolonged ⇒ consult; NSAIDs suppressed in pregnancy
  ('e0000000-0000-4000-8000-000000000001','concept:headache AND duration_days > 3',10,'ESCALATE','T3',NULL,
     'headache for more than 3 days','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000001','who:PREGNANT_OR_BF',                40,'SUPPRESS_CLASS',NULL,
     'd0000000-0000-4000-8000-000000000002',
     'NSAIDs suppressed in pregnancy/breastfeeding','APPROVED', now()),
  -- diarrhoea: blood ⇒ emergency; under-6 child ⇒ consult; prolonged ⇒ consult
  ('e0000000-0000-4000-8000-000000000004','concept:blood_in_stool',             5,'ESCALATE','T4',NULL,
     'blood in stool with diarrhoea','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000004','who:CHILD_UNDER_6',                 20,'ESCALATE','T3',NULL,
     'diarrhoea in a child under 6','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000004','duration_days > 3',                 30,'ESCALATE','T3',NULL,
     'diarrhoea for more than 3 days','APPROVED', now()),
  -- cold/cough: fever alongside cough ⇒ pharmacist gate
  ('e0000000-0000-4000-8000-000000000002','concept:cough AND concept:fever',   10,'REQUIRE_CONFIRMATION',NULL,NULL,
     'cough with fever','APPROVED', now())
ON CONFLICT DO NOTHING;

-- disclaimer v1 (active)
INSERT INTO public.symptom_disclaimer_versions (version, body, active) VALUES
  (1, 'These are options for your symptoms, not a diagnosis or treatment for your condition. A licensed pharmacist reviews orders where required. If symptoms persist or worsen, please see a doctor.', true)
ON CONFLICT (version) DO NOTHING;

COMMIT;
