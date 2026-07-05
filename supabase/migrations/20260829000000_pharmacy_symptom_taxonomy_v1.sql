-- Migration: pharmacy_symptom_taxonomy_v1
-- Module: Pharmacy symptom-based medication search — Phase-1 taxonomy expansion
--         toward PRD §10 scale (~150 concepts / ~600 terms end-state; this pack
--         takes the seed from 10→60 concepts, 22→~320 terms, 7→25 clusters,
--         5→14 classes).
-- Ref: supabase/migrations/20260827000000_pharmacy_symptom_search.sql (schema +
--      cluster_rule DSL grammar), 20260828000000_pharmacy_symptom_order_link.sql,
--      docs/adr/ADR-016-pharmacy-symptom-search.md.
-- Gated by FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED (default off).
--
-- ADDITIVE ONLY. Seed-data only — no DDL. All INSERTs are idempotent
-- (ON CONFLICT DO NOTHING on natural keys: concept/class/cluster code, term
-- (lower(term), language), composite PKs, fixed rule ids).
--
-- ── APPROVED vs AI_SUGGESTED split (suggest-approve discipline) ───────────────
--   * status = 'APPROVED'      — CORE pack: English + Nigerian Pidgin terms,
--     concepts, clusters, cluster rules, therapeutic classes and cluster→class
--     maps for common OTC-relevant presentations. Safe/unambiguous content only:
--     NO antibiotics, NO codeine-containing classes; ACTs stay POM — the
--     malaria-suspect cluster is T3 (consult) and maps to NO product class.
--   * status = 'AI_SUGGESTED'  — Hausa / Yoruba / Igbo language packs (and the
--     cerumenolytic ear-drops class). Best-effort drafts that are NOT
--     user-visible until a licensed pharmacist approves each row in the
--     mapping workbench (approved-only read path enforced in 20260827 schema:
--     partial index + status filter; fail-closed).
--   * The T2 "pregnancy dyspepsia" surface is realised as a REQUIRE_CONFIRMATION
--     rule on the T1 heartburn cluster (REQUIRE_CONFIRMATION *is* the T2
--     pharmacist gate per the 20260827 design). "Infant fever 6–12 months"
--     cannot be expressed in the DSL cohort set (years-based); it is subsumed
--     by the existing stricter rule who:CHILD_UNDER_6 → T3.
--
--   ⚠ Superintendent-pharmacist sign-off is REQUIRED on the APPROVED core pack
--   before FEATURE_PHARMACY_SYMPTOM_SEARCH_ENABLED is turned on in production;
--   approved_by is NULL for system seeds and must be back-filled at sign-off.
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) CONCEPTS — +50 (c…000b → c…003c), all core/APPROVED. Total 60.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.symptom_concepts (id, code, name, status, approved_at) VALUES
  -- respiratory
  ('c0000000-0000-4000-8000-00000000000b','dry_cough',          'Dry cough',                                'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000000c','productive_cough',   'Productive / chesty cough',                'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000000d','sneezing',           'Sneezing',                                 'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000038','runny_nose',         'Runny nose',                               'APPROVED', now()),
  -- pain
  ('c0000000-0000-4000-8000-00000000000e','migraine_like',      'Migraine-like headache (severe, one-sided)','APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000000f','back_pain',          'Back pain / waist pain',                   'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000010','toothache',          'Toothache',                                'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000011','menstrual_pain',     'Menstrual pain / period cramps',           'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000012','joint_pain',         'Joint pain',                               'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000039','muscle_sprain',      'Muscle sprain / strain',                   'APPROVED', now()),
  -- GI
  ('c0000000-0000-4000-8000-000000000013','heartburn',          'Heartburn / acid reflux',                  'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000014','indigestion',        'Indigestion',                              'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000015','nausea',             'Nausea',                                   'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000016','vomiting',           'Vomiting',                                 'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000017','constipation',       'Constipation',                             'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000018','stomach_cramp',      'Stomach cramp',                            'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000019','bloating',           'Bloating / gas',                           'APPROVED', now()),
  -- skin
  ('c0000000-0000-4000-8000-00000000001a','skin_rash',          'Skin rash',                                'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000001b','itching',            'Itching',                                  'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000001c','minor_burn',         'Minor burn / scald',                       'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000001d','insect_bite',        'Insect bite / sting',                      'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000001e','ringworm_like',      'Ringworm-like skin patch',                 'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000001f','boil',               'Boil',                                     'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000020','dandruff',           'Dandruff',                                 'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000021','athletes_foot',      'Athlete''s foot',                          'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000036','heat_rash',          'Heat rash / prickly heat',                 'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000037','eczema_like',        'Dry itchy skin (eczema-like)',             'APPROVED', now()),
  -- eyes / ears
  ('c0000000-0000-4000-8000-000000000022','itchy_eyes',         'Itchy eyes',                               'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000023','red_eye',            'Red eye',                                  'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000024','eye_discharge',      'Eye discharge (Apollo-like)',              'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000025','earwax_discomfort',  'Earwax discomfort / blocked ear',          'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000026','ear_pain',           'Ear pain',                                 'APPROVED', now()),
  -- general
  ('c0000000-0000-4000-8000-000000000027','chills',             'Chills / shivering',                       'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000028','fatigue',            'Fatigue / weakness',                       'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000029','dizziness',          'Dizziness',                                'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000002a','loss_of_appetite',   'Loss of appetite',                         'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000002b','sleep_difficulty',   'Sleep difficulty',                         'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000002c','motion_sickness',    'Motion sickness',                          'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000002d','hangover',           'Hangover',                                 'APPROVED', now()),
  -- allergy / wounds / mouth
  ('c0000000-0000-4000-8000-00000000002e','allergy',            'Allergic reaction (mild)',                 'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000002f','minor_cut',          'Minor cut / wound',                        'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000030','mouth_ulcer',        'Mouth ulcer',                              'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000031','cold_sore',          'Cold sore',                                'APPROVED', now()),
  -- worms / malaria-suspect / urinary
  ('c0000000-0000-4000-8000-000000000032','worm_infestation',   'Worm infestation',                         'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000033','malaria_suspect',    'Malaria-suspect symptoms',                 'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000034','painful_urination',  'Painful / burning urination',              'APPROVED', now()),
  ('c0000000-0000-4000-8000-000000000035','frequent_urination', 'Frequent urination',                       'APPROVED', now()),
  -- red-flag adjacent
  ('c0000000-0000-4000-8000-00000000003a','stiff_neck',         'Stiff neck',                               'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000003b','difficulty_breathing','Difficulty breathing',                    'APPROVED', now()),
  ('c0000000-0000-4000-8000-00000000003c','yellow_eyes',        'Yellow eyes / jaundice',                   'APPROVED', now())
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) THERAPEUTIC CLASSES — +9 (d…0006 → d…000e). Total 14.
--    No antibiotics. No codeine-containing classes. cerumenolytic_eardrops is
--    AI_SUGGESTED (not in the pharmacist-approved core list) — the ear cluster
--    surfaces nothing until it is approved (fail-closed).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.therapeutic_classes (id, code, name, usage_note, status, approved_at) VALUES
  ('d0000000-0000-4000-8000-000000000006','antacid_alginate','Heartburn & indigestion relief (antacids / alginates)',
     'Follow the pack label. Take after meals and at bedtime as directed.','APPROVED', now()),
  ('d0000000-0000-4000-8000-000000000007','laxative_osmotic','Constipation relief (glycerin / lactulose)',
     'Follow the pack label. Drink plenty of water.','APPROVED', now()),
  ('d0000000-0000-4000-8000-000000000008','dewormer_otc','Dewormers (albendazole-class, OTC)',
     'Follow the pack label for age-appropriate dosing.','APPROVED', now()),
  ('d0000000-0000-4000-8000-000000000009','topical_antifungal','Antifungal creams & powders (topical)',
     'Apply to clean, dry skin as directed on the pack.','APPROVED', now()),
  ('d0000000-0000-4000-8000-00000000000a','calamine_antipruritic','Anti-itch & soothing lotions (calamine-based)',
     'For external use only.','APPROVED', now()),
  ('d0000000-0000-4000-8000-00000000000b','artificial_tears','Lubricant eye drops (artificial tears)',
     'Do not use while wearing contact lenses unless the pack allows it.','APPROVED', now()),
  ('d0000000-0000-4000-8000-00000000000c','chlorhexidine_antiseptic','Antiseptics (chlorhexidine-based)',
     'For external / rinse use only. Do not swallow.','APPROVED', now()),
  ('d0000000-0000-4000-8000-00000000000d','motion_sickness_antihistamine','Motion sickness & sleep-support relief (sedating antihistamines)',
     'Causes drowsiness. Do not drive. Not with alcohol.','APPROVED', now()),
  ('d0000000-0000-4000-8000-00000000000e','cerumenolytic_eardrops','Earwax-softening drops (cerumenolytics)',
     'Do not use with a perforated eardrum.','AI_SUGGESTED', NULL)
ON CONFLICT (code) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) CLUSTERS — +18 (e…0008 → e…0019). Total 25.
--    T1 self-care · T2 pharmacist-guided · T3 consult · T4 emergency.
--    T3/T4 clusters intentionally map to NO product class.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.symptom_clusters (id, code, name, triage_tier, status, approved_at) VALUES
  ('e0000000-0000-4000-8000-000000000008','pain_musculoskeletal','Back, joint & muscle pain',        'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000009','menstrual_pain',      'Menstrual pain',                   'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-00000000000a','mouth_dental',        'Toothache & mouth sores',          'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-00000000000b','heartburn_indigestion','Heartburn, indigestion & bloating','T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-00000000000c','nausea_motion',       'Nausea, motion sickness & hangover','T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-00000000000d','constipation',        'Constipation',                     'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-00000000000e','skin_irritation',     'Itching, rash & insect bites',     'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-00000000000f','fungal_skin',         'Fungal skin & scalp complaints',   'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000010','minor_wounds',        'Minor cuts, burns & boils',        'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000011','allergy_mild',        'Mild allergy',                     'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000012','eye_irritation',      'Itchy / red eye',                  'T2','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000013','ear_discomfort',      'Earwax / blocked ear',             'T2','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000014','sleep_difficulty',    'Sleep difficulty',                 'T2','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000015','worm_infestation',    'Worm infestation (deworming)',     'T1','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000016','malaria_suspect',     'Suspected malaria',                'T3','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000017','uti_like',            'UTI-like symptoms',                'T3','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000018','general_unwell',      'Fatigue, dizziness & poor appetite','T3','APPROVED', now()),
  ('e0000000-0000-4000-8000-000000000019','breathing_neuro_redflag','Breathing difficulty / stiff neck (red flag)','T4','APPROVED', now())
ON CONFLICT (code) DO NOTHING;

-- cluster membership (incl. additions to the 20260827 clusters e…0001/e…0002)
INSERT INTO public.symptom_cluster_concepts (cluster_id, concept_id) VALUES
  -- existing: headache & body pain ← migraine_like
  ('e0000000-0000-4000-8000-000000000001','c0000000-0000-4000-8000-00000000000e'),
  -- existing: common cold ← dry_cough, productive_cough, sneezing, runny_nose
  ('e0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000b'),
  ('e0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000c'),
  ('e0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-00000000000d'),
  ('e0000000-0000-4000-8000-000000000002','c0000000-0000-4000-8000-000000000038'),
  -- pain_musculoskeletal: back_pain, joint_pain, muscle_sprain
  ('e0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-00000000000f'),
  ('e0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-000000000012'),
  ('e0000000-0000-4000-8000-000000000008','c0000000-0000-4000-8000-000000000039'),
  -- menstrual_pain
  ('e0000000-0000-4000-8000-000000000009','c0000000-0000-4000-8000-000000000011'),
  -- mouth_dental: toothache, mouth_ulcer, cold_sore
  ('e0000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-000000000010'),
  ('e0000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-000000000030'),
  ('e0000000-0000-4000-8000-00000000000a','c0000000-0000-4000-8000-000000000031'),
  -- heartburn_indigestion: heartburn, indigestion, stomach_cramp, bloating
  ('e0000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-000000000013'),
  ('e0000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-000000000014'),
  ('e0000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-000000000018'),
  ('e0000000-0000-4000-8000-00000000000b','c0000000-0000-4000-8000-000000000019'),
  -- nausea_motion: nausea, vomiting, motion_sickness, hangover
  ('e0000000-0000-4000-8000-00000000000c','c0000000-0000-4000-8000-000000000015'),
  ('e0000000-0000-4000-8000-00000000000c','c0000000-0000-4000-8000-000000000016'),
  ('e0000000-0000-4000-8000-00000000000c','c0000000-0000-4000-8000-00000000002c'),
  ('e0000000-0000-4000-8000-00000000000c','c0000000-0000-4000-8000-00000000002d'),
  -- constipation
  ('e0000000-0000-4000-8000-00000000000d','c0000000-0000-4000-8000-000000000017'),
  -- skin_irritation: skin_rash, itching, insect_bite, heat_rash, eczema_like
  ('e0000000-0000-4000-8000-00000000000e','c0000000-0000-4000-8000-00000000001a'),
  ('e0000000-0000-4000-8000-00000000000e','c0000000-0000-4000-8000-00000000001b'),
  ('e0000000-0000-4000-8000-00000000000e','c0000000-0000-4000-8000-00000000001d'),
  ('e0000000-0000-4000-8000-00000000000e','c0000000-0000-4000-8000-000000000036'),
  ('e0000000-0000-4000-8000-00000000000e','c0000000-0000-4000-8000-000000000037'),
  -- fungal_skin: ringworm_like, dandruff, athletes_foot
  ('e0000000-0000-4000-8000-00000000000f','c0000000-0000-4000-8000-00000000001e'),
  ('e0000000-0000-4000-8000-00000000000f','c0000000-0000-4000-8000-000000000020'),
  ('e0000000-0000-4000-8000-00000000000f','c0000000-0000-4000-8000-000000000021'),
  -- minor_wounds: minor_cut, minor_burn, boil
  ('e0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-00000000002f'),
  ('e0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-00000000001c'),
  ('e0000000-0000-4000-8000-000000000010','c0000000-0000-4000-8000-00000000001f'),
  -- allergy_mild
  ('e0000000-0000-4000-8000-000000000011','c0000000-0000-4000-8000-00000000002e'),
  -- eye_irritation: itchy_eyes, red_eye, eye_discharge
  ('e0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000022'),
  ('e0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000023'),
  ('e0000000-0000-4000-8000-000000000012','c0000000-0000-4000-8000-000000000024'),
  -- ear_discomfort: earwax_discomfort, ear_pain
  ('e0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000025'),
  ('e0000000-0000-4000-8000-000000000013','c0000000-0000-4000-8000-000000000026'),
  -- sleep_difficulty
  ('e0000000-0000-4000-8000-000000000014','c0000000-0000-4000-8000-00000000002b'),
  -- worm_infestation
  ('e0000000-0000-4000-8000-000000000015','c0000000-0000-4000-8000-000000000032'),
  -- malaria_suspect: malaria_suspect, chills
  ('e0000000-0000-4000-8000-000000000016','c0000000-0000-4000-8000-000000000033'),
  ('e0000000-0000-4000-8000-000000000016','c0000000-0000-4000-8000-000000000027'),
  -- uti_like: painful_urination, frequent_urination
  ('e0000000-0000-4000-8000-000000000017','c0000000-0000-4000-8000-000000000034'),
  ('e0000000-0000-4000-8000-000000000017','c0000000-0000-4000-8000-000000000035'),
  -- general_unwell: fatigue, dizziness, loss_of_appetite, yellow_eyes
  ('e0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-000000000028'),
  ('e0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-000000000029'),
  ('e0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-00000000002a'),
  ('e0000000-0000-4000-8000-000000000018','c0000000-0000-4000-8000-00000000003c'),
  -- breathing_neuro_redflag: difficulty_breathing, stiff_neck
  ('e0000000-0000-4000-8000-000000000019','c0000000-0000-4000-8000-00000000003b'),
  ('e0000000-0000-4000-8000-000000000019','c0000000-0000-4000-8000-00000000003a')
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) CLUSTER → CLASS MAPS — every T1/T2 cluster gets 1–3 classes.
--    T3 (malaria_suspect, uti_like, general_unwell) and T4 map to NOTHING.
--    ear_discomfort maps only to the AI_SUGGESTED cerumenolytic class ⇒ shows
--    zero products until a pharmacist approves that class (fail-closed).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.symptom_cluster_class_map (cluster_id, class_id, rank) VALUES
  ('e0000000-0000-4000-8000-000000000008','d0000000-0000-4000-8000-000000000001',1), -- msk pain → paracetamol
  ('e0000000-0000-4000-8000-000000000008','d0000000-0000-4000-8000-000000000002',2), -- msk pain → nsaid
  ('e0000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000002',1), -- menstrual → nsaid
  ('e0000000-0000-4000-8000-000000000009','d0000000-0000-4000-8000-000000000001',2), -- menstrual → paracetamol
  ('e0000000-0000-4000-8000-00000000000a','d0000000-0000-4000-8000-000000000001',1), -- mouth/dental → paracetamol
  ('e0000000-0000-4000-8000-00000000000a','d0000000-0000-4000-8000-00000000000c',2), -- mouth/dental → chlorhexidine
  ('e0000000-0000-4000-8000-00000000000b','d0000000-0000-4000-8000-000000000006',1), -- heartburn → antacid/alginate
  ('e0000000-0000-4000-8000-00000000000c','d0000000-0000-4000-8000-00000000000d',1), -- nausea/motion → antihistamine
  ('e0000000-0000-4000-8000-00000000000c','d0000000-0000-4000-8000-000000000005',2), -- nausea/motion → ORS+zinc
  ('e0000000-0000-4000-8000-00000000000d','d0000000-0000-4000-8000-000000000007',1), -- constipation → laxative
  ('e0000000-0000-4000-8000-00000000000e','d0000000-0000-4000-8000-00000000000a',1), -- skin irritation → calamine
  ('e0000000-0000-4000-8000-00000000000e','d0000000-0000-4000-8000-000000000003',2), -- skin irritation → antihistamine
  ('e0000000-0000-4000-8000-00000000000f','d0000000-0000-4000-8000-000000000009',1), -- fungal skin → topical antifungal
  ('e0000000-0000-4000-8000-000000000010','d0000000-0000-4000-8000-00000000000c',1), -- wounds → chlorhexidine
  ('e0000000-0000-4000-8000-000000000010','d0000000-0000-4000-8000-000000000001',2), -- wounds → paracetamol
  ('e0000000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-000000000003',1), -- allergy → antihistamine
  ('e0000000-0000-4000-8000-000000000011','d0000000-0000-4000-8000-00000000000a',2), -- allergy → calamine
  ('e0000000-0000-4000-8000-000000000012','d0000000-0000-4000-8000-00000000000b',1), -- eye irritation → artificial tears
  ('e0000000-0000-4000-8000-000000000013','d0000000-0000-4000-8000-00000000000e',1), -- ear → cerumenolytic (AI_SUGGESTED, gated)
  ('e0000000-0000-4000-8000-000000000014','d0000000-0000-4000-8000-00000000000d',1), -- sleep → sedating antihistamine
  ('e0000000-0000-4000-8000-000000000015','d0000000-0000-4000-8000-000000000008',1)  -- worms → dewormer
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) CLUSTER RULES — fixed ids (f…0001 → f…0019) so re-runs are idempotent via
--    the PK. Every expression parses under the 20260827 DSL grammar
--    (concept:/who:/duration_days/term_count; NOT > AND > OR; uppercase).
--    Pregnancy exclusions use SUPPRESS_CLASS; REQUIRE_CONFIRMATION = T2 gate.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.symptom_cluster_rules
  (id, cluster_id, expression, priority, effect, escalate_to_tier, suppress_class_id, reason, status, approved_at)
VALUES
  -- headache & body pain (existing e…0001): migraine-like ⇒ pharmacist gate
  ('f0000000-0000-4000-8000-000000000001','e0000000-0000-4000-8000-000000000001',
   'concept:migraine_like',20,'REQUIRE_CONFIRMATION',NULL,NULL,
   'migraine-like headache — pharmacist check before self-care','APPROVED', now()),
  -- common cold (existing e…0002): chesty cough >3 days ⇒ consult
  ('f0000000-0000-4000-8000-000000000002','e0000000-0000-4000-8000-000000000002',
   'concept:productive_cough AND duration_days > 3',15,'ESCALATE','T3',NULL,
   'chesty cough for more than 3 days','APPROVED', now()),
  -- fever (existing e…0003): fever with chills ⇒ suspected malaria ⇒ consult
  ('f0000000-0000-4000-8000-000000000003','e0000000-0000-4000-8000-000000000003',
   'concept:fever AND concept:chills',15,'ESCALATE','T3',NULL,
   'fever with chills — suspected malaria, needs consult/test','APPROVED', now()),
  -- musculoskeletal pain: NSAIDs out in pregnancy; persistent pain ⇒ T2 gate
  ('f0000000-0000-4000-8000-000000000004','e0000000-0000-4000-8000-000000000008',
   'who:PREGNANT_OR_BF',40,'SUPPRESS_CLASS',NULL,'d0000000-0000-4000-8000-000000000002',
   'NSAIDs suppressed in pregnancy/breastfeeding','APPROVED', now()),
  ('f0000000-0000-4000-8000-000000000005','e0000000-0000-4000-8000-000000000008',
   'duration_days > 3',30,'REQUIRE_CONFIRMATION',NULL,NULL,
   'pain for more than 3 days — pharmacist check','APPROVED', now()),
  -- menstrual pain: pregnant + period-type pain ⇒ doctor
  ('f0000000-0000-4000-8000-000000000006','e0000000-0000-4000-8000-000000000009',
   'who:PREGNANT_OR_BF',10,'ESCALATE','T3',NULL,
   'period-type pain while pregnant needs a doctor','APPROVED', now()),
  -- mouth/dental: persistent toothache ⇒ dental review
  ('f0000000-0000-4000-8000-000000000007','e0000000-0000-4000-8000-00000000000a',
   'concept:toothache AND duration_days > 3',10,'ESCALATE','T3',NULL,
   'persistent toothache needs dental review','APPROVED', now()),
  -- heartburn: PREGNANCY DYSPEPSIA (the PRD T2 surface) + persistence gate
  ('f0000000-0000-4000-8000-000000000008','e0000000-0000-4000-8000-00000000000b',
   'who:PREGNANT_OR_BF',10,'REQUIRE_CONFIRMATION',NULL,NULL,
   'heartburn/indigestion in pregnancy — pharmacist-guided (T2)','APPROVED', now()),
  ('f0000000-0000-4000-8000-000000000009','e0000000-0000-4000-8000-00000000000b',
   'duration_days > 3',30,'REQUIRE_CONFIRMATION',NULL,NULL,
   'persistent heartburn — pharmacist check','APPROVED', now()),
  -- nausea/motion: pregnancy gate + antihistamine suppression; vomiting flags
  ('f0000000-0000-4000-8000-00000000000a','e0000000-0000-4000-8000-00000000000c',
   'who:PREGNANT_OR_BF',10,'REQUIRE_CONFIRMATION',NULL,NULL,
   'nausea in pregnancy — pharmacist-guided','APPROVED', now()),
  ('f0000000-0000-4000-8000-00000000000b','e0000000-0000-4000-8000-00000000000c',
   'who:PREGNANT_OR_BF',11,'SUPPRESS_CLASS',NULL,'d0000000-0000-4000-8000-00000000000d',
   'sedating antihistamines suppressed in pregnancy/breastfeeding','APPROVED', now()),
  ('f0000000-0000-4000-8000-00000000000c','e0000000-0000-4000-8000-00000000000c',
   'concept:vomiting AND who:CHILD_UNDER_6',5,'ESCALATE','T3',NULL,
   'vomiting in a child under 6','APPROVED', now()),
  ('f0000000-0000-4000-8000-00000000000d','e0000000-0000-4000-8000-00000000000c',
   'concept:vomiting AND duration_days > 1',6,'ESCALATE','T3',NULL,
   'vomiting for more than a day','APPROVED', now()),
  -- constipation: pregnancy ⇒ pharmacist gate
  ('f0000000-0000-4000-8000-00000000000e','e0000000-0000-4000-8000-00000000000d',
   'who:PREGNANT_OR_BF',10,'REQUIRE_CONFIRMATION',NULL,NULL,
   'constipation in pregnancy — pharmacist-guided','APPROVED', now()),
  -- skin: rash + fever ⇒ consult; persistent rash in young child ⇒ gate
  ('f0000000-0000-4000-8000-00000000000f','e0000000-0000-4000-8000-00000000000e',
   'concept:skin_rash AND concept:fever',5,'ESCALATE','T3',NULL,
   'rash with fever','APPROVED', now()),
  ('f0000000-0000-4000-8000-000000000010','e0000000-0000-4000-8000-00000000000e',
   'who:CHILD_UNDER_6 AND duration_days > 3',20,'REQUIRE_CONFIRMATION',NULL,NULL,
   'persistent rash in a young child','APPROVED', now()),
  -- wounds: burn in a young child ⇒ pharmacist gate
  ('f0000000-0000-4000-8000-000000000011','e0000000-0000-4000-8000-000000000010',
   'concept:minor_burn AND who:CHILD_UNDER_6',10,'REQUIRE_CONFIRMATION',NULL,NULL,
   'burn in a young child — pharmacist check','APPROVED', now()),
  -- allergy: persistent ⇒ pharmacist gate
  ('f0000000-0000-4000-8000-000000000012','e0000000-0000-4000-8000-000000000011',
   'duration_days > 3',30,'REQUIRE_CONFIRMATION',NULL,NULL,
   'allergy symptoms for more than 3 days','APPROVED', now()),
  -- eye: discharge ⇒ EYE INFECTION-LIKE (PRD T3); young child ⇒ consult
  ('f0000000-0000-4000-8000-000000000013','e0000000-0000-4000-8000-000000000012',
   'concept:eye_discharge',5,'ESCALATE','T3',NULL,
   'discharge suggests eye infection — consult','APPROVED', now()),
  ('f0000000-0000-4000-8000-000000000014','e0000000-0000-4000-8000-000000000012',
   'who:CHILD_UNDER_6',10,'ESCALATE','T3',NULL,
   'eye complaint in a child under 6','APPROVED', now()),
  -- ear: pain (vs wax discomfort) ⇒ consult
  ('f0000000-0000-4000-8000-000000000015','e0000000-0000-4000-8000-000000000013',
   'concept:ear_pain',5,'ESCALATE','T3',NULL,
   'ear pain needs consult','APPROVED', now()),
  -- sleep: pregnancy suppression; ongoing insomnia ⇒ consult
  ('f0000000-0000-4000-8000-000000000016','e0000000-0000-4000-8000-000000000014',
   'who:PREGNANT_OR_BF',10,'SUPPRESS_CLASS',NULL,'d0000000-0000-4000-8000-00000000000d',
   'sedating antihistamines suppressed in pregnancy/breastfeeding','APPROVED', now()),
  ('f0000000-0000-4000-8000-000000000017','e0000000-0000-4000-8000-000000000014',
   'duration_days > 3',30,'ESCALATE','T3',NULL,
   'ongoing sleep difficulty — consult','APPROVED', now()),
  -- worms: pregnancy ⇒ doctor; young child ⇒ pharmacist age/dose check
  ('f0000000-0000-4000-8000-000000000018','e0000000-0000-4000-8000-000000000015',
   'who:PREGNANT_OR_BF',10,'ESCALATE','T3',NULL,
   'deworming in pregnancy needs a doctor','APPROVED', now()),
  ('f0000000-0000-4000-8000-000000000019','e0000000-0000-4000-8000-000000000015',
   'who:CHILD_UNDER_6',20,'REQUIRE_CONFIRMATION',NULL,NULL,
   'deworming a child under 6 — pharmacist age/dose check','APPROVED', now())
ON CONFLICT (id) DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6) TERMS — CORE English + Nigerian Pidgin, APPROVED (incl. common
--    misspellings). Unique on (lower(term), language).
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.symptom_terms (term, language, concept_id, status, approved_at) VALUES
  -- extras for 20260827 concepts
  ('feaver',                 'en', 'c0000000-0000-4000-8000-000000000001','APPROVED', now()),
  ('high temperature',       'en', 'c0000000-0000-4000-8000-000000000001','APPROVED', now()),
  ('my head dey bang',       'pcm','c0000000-0000-4000-8000-000000000002','APPROVED', now()),
  ('i dey cough',            'pcm','c0000000-0000-4000-8000-000000000003','APPROVED', now()),
  ('cattarh',                'en', 'c0000000-0000-4000-8000-000000000004','APPROVED', now()),
  ('blocked nose',           'en', 'c0000000-0000-4000-8000-000000000004','APPROVED', now()),
  ('catarrh full my nose',   'pcm','c0000000-0000-4000-8000-000000000004','APPROVED', now()),
  ('throat pain',            'en', 'c0000000-0000-4000-8000-000000000005','APPROVED', now()),
  ('body ache',              'en', 'c0000000-0000-4000-8000-000000000006','APPROVED', now()),
  ('body dey pain me',       'pcm','c0000000-0000-4000-8000-000000000006','APPROVED', now()),
  ('diarrhoea',              'en', 'c0000000-0000-4000-8000-000000000007','APPROVED', now()),
  ('watery stool',           'en', 'c0000000-0000-4000-8000-000000000007','APPROVED', now()),
  ('shit water',             'pcm','c0000000-0000-4000-8000-000000000007','APPROVED', now()),
  -- respiratory
  ('dry cough',              'en', 'c0000000-0000-4000-8000-00000000000b','APPROVED', now()),
  ('cough wey no get catarrh','pcm','c0000000-0000-4000-8000-00000000000b','APPROVED', now()),
  ('chesty cough',           'en', 'c0000000-0000-4000-8000-00000000000c','APPROVED', now()),
  ('cough with phlegm',      'en', 'c0000000-0000-4000-8000-00000000000c','APPROVED', now()),
  ('cough dey bring catarrh','pcm','c0000000-0000-4000-8000-00000000000c','APPROVED', now()),
  ('sneezing',               'en', 'c0000000-0000-4000-8000-00000000000d','APPROVED', now()),
  ('i dey sneeze',           'pcm','c0000000-0000-4000-8000-00000000000d','APPROVED', now()),
  ('runny nose',             'en', 'c0000000-0000-4000-8000-000000000038','APPROVED', now()),
  ('my nose dey run',        'pcm','c0000000-0000-4000-8000-000000000038','APPROVED', now()),
  -- pain
  ('migraine',               'en', 'c0000000-0000-4000-8000-00000000000e','APPROVED', now()),
  ('one side headache',      'en', 'c0000000-0000-4000-8000-00000000000e','APPROVED', now()),
  ('serious headache wey dey blind me','pcm','c0000000-0000-4000-8000-00000000000e','APPROVED', now()),
  ('back pain',              'en', 'c0000000-0000-4000-8000-00000000000f','APPROVED', now()),
  ('waist pain',             'en', 'c0000000-0000-4000-8000-00000000000f','APPROVED', now()),
  ('my back dey pain me',    'pcm','c0000000-0000-4000-8000-00000000000f','APPROVED', now()),
  ('waist dey pain me',      'pcm','c0000000-0000-4000-8000-00000000000f','APPROVED', now()),
  ('toothache',              'en', 'c0000000-0000-4000-8000-000000000010','APPROVED', now()),
  ('tooth pain',             'en', 'c0000000-0000-4000-8000-000000000010','APPROVED', now()),
  ('my tooth dey pain me',   'pcm','c0000000-0000-4000-8000-000000000010','APPROVED', now()),
  ('menstrual pain',         'en', 'c0000000-0000-4000-8000-000000000011','APPROVED', now()),
  ('period pain',            'en', 'c0000000-0000-4000-8000-000000000011','APPROVED', now()),
  ('cramps',                 'en', 'c0000000-0000-4000-8000-000000000011','APPROVED', now()),
  ('belle dey pain me for period','pcm','c0000000-0000-4000-8000-000000000011','APPROVED', now()),
  ('joint pain',             'en', 'c0000000-0000-4000-8000-000000000012','APPROVED', now()),
  ('knee pain',              'en', 'c0000000-0000-4000-8000-000000000012','APPROVED', now()),
  ('my joint dey pain',      'pcm','c0000000-0000-4000-8000-000000000012','APPROVED', now()),
  ('sprain',                 'en', 'c0000000-0000-4000-8000-000000000039','APPROVED', now()),
  ('muscle pull',            'en', 'c0000000-0000-4000-8000-000000000039','APPROVED', now()),
  ('i sprain my leg',        'pcm','c0000000-0000-4000-8000-000000000039','APPROVED', now()),
  -- GI
  ('heartburn',              'en', 'c0000000-0000-4000-8000-000000000013','APPROVED', now()),
  ('acid reflux',            'en', 'c0000000-0000-4000-8000-000000000013','APPROVED', now()),
  ('chest dey burn me',      'pcm','c0000000-0000-4000-8000-000000000013','APPROVED', now()),
  ('indigestion',            'en', 'c0000000-0000-4000-8000-000000000014','APPROVED', now()),
  ('food no gree digest',    'pcm','c0000000-0000-4000-8000-000000000014','APPROVED', now()),
  ('nausea',                 'en', 'c0000000-0000-4000-8000-000000000015','APPROVED', now()),
  ('belle dey turn me',      'pcm','c0000000-0000-4000-8000-000000000015','APPROVED', now()),
  ('i wan vomit',            'pcm','c0000000-0000-4000-8000-000000000015','APPROVED', now()),
  ('vomiting',               'en', 'c0000000-0000-4000-8000-000000000016','APPROVED', now()),
  ('throwing up',            'en', 'c0000000-0000-4000-8000-000000000016','APPROVED', now()),
  ('i dey vomit',            'pcm','c0000000-0000-4000-8000-000000000016','APPROVED', now()),
  ('constipation',           'en', 'c0000000-0000-4000-8000-000000000017','APPROVED', now()),
  ('hard stool',             'en', 'c0000000-0000-4000-8000-000000000017','APPROVED', now()),
  ('i never shit for days',  'pcm','c0000000-0000-4000-8000-000000000017','APPROVED', now()),
  ('stomach cramp',          'en', 'c0000000-0000-4000-8000-000000000018','APPROVED', now()),
  ('stomach pain',           'en', 'c0000000-0000-4000-8000-000000000018','APPROVED', now()),
  ('belle dey twist me',     'pcm','c0000000-0000-4000-8000-000000000018','APPROVED', now()),
  ('bloating',               'en', 'c0000000-0000-4000-8000-000000000019','APPROVED', now()),
  ('gas',                    'en', 'c0000000-0000-4000-8000-000000000019','APPROVED', now()),
  ('belle dey swell',        'pcm','c0000000-0000-4000-8000-000000000019','APPROVED', now()),
  -- skin
  ('rash',                   'en', 'c0000000-0000-4000-8000-00000000001a','APPROVED', now()),
  ('skin rash',              'en', 'c0000000-0000-4000-8000-00000000001a','APPROVED', now()),
  ('rashes full my body',    'pcm','c0000000-0000-4000-8000-00000000001a','APPROVED', now()),
  ('itching',                'en', 'c0000000-0000-4000-8000-00000000001b','APPROVED', now()),
  ('body dey scratch me',    'pcm','c0000000-0000-4000-8000-00000000001b','APPROVED', now()),
  ('skin dey itch me',       'pcm','c0000000-0000-4000-8000-00000000001b','APPROVED', now()),
  ('minor burn',             'en', 'c0000000-0000-4000-8000-00000000001c','APPROVED', now()),
  ('burn',                   'en', 'c0000000-0000-4000-8000-00000000001c','APPROVED', now()),
  ('hot water burn me',      'pcm','c0000000-0000-4000-8000-00000000001c','APPROVED', now()),
  ('insect bite',            'en', 'c0000000-0000-4000-8000-00000000001d','APPROVED', now()),
  ('mosquito bite',          'en', 'c0000000-0000-4000-8000-00000000001d','APPROVED', now()),
  ('something bite me',      'pcm','c0000000-0000-4000-8000-00000000001d','APPROVED', now()),
  ('ringworm',               'en', 'c0000000-0000-4000-8000-00000000001e','APPROVED', now()),
  ('round patch for my skin','pcm','c0000000-0000-4000-8000-00000000001e','APPROVED', now()),
  ('boil',                   'en', 'c0000000-0000-4000-8000-00000000001f','APPROVED', now()),
  ('boil for my body',       'pcm','c0000000-0000-4000-8000-00000000001f','APPROVED', now()),
  ('dandruff',               'en', 'c0000000-0000-4000-8000-000000000020','APPROVED', now()),
  ('white white for my hair','pcm','c0000000-0000-4000-8000-000000000020','APPROVED', now()),
  ('athlete''s foot',        'en', 'c0000000-0000-4000-8000-000000000021','APPROVED', now()),
  ('athletes foot',          'en', 'c0000000-0000-4000-8000-000000000021','APPROVED', now()),
  ('my toe dey itch',        'pcm','c0000000-0000-4000-8000-000000000021','APPROVED', now()),
  ('heat rash',              'en', 'c0000000-0000-4000-8000-000000000036','APPROVED', now()),
  ('prickly heat',           'en', 'c0000000-0000-4000-8000-000000000036','APPROVED', now()),
  ('heat don scatter my body','pcm','c0000000-0000-4000-8000-000000000036','APPROVED', now()),
  ('eczema',                 'en', 'c0000000-0000-4000-8000-000000000037','APPROVED', now()),
  ('dry itchy skin',         'en', 'c0000000-0000-4000-8000-000000000037','APPROVED', now()),
  ('craw craw',              'pcm','c0000000-0000-4000-8000-000000000037','APPROVED', now()),
  -- eyes / ears
  ('itchy eyes',             'en', 'c0000000-0000-4000-8000-000000000022','APPROVED', now()),
  ('my eye dey scratch me',  'pcm','c0000000-0000-4000-8000-000000000022','APPROVED', now()),
  ('red eye',                'en', 'c0000000-0000-4000-8000-000000000023','APPROVED', now()),
  ('my eye red',             'pcm','c0000000-0000-4000-8000-000000000023','APPROVED', now()),
  ('eye discharge',          'en', 'c0000000-0000-4000-8000-000000000024','APPROVED', now()),
  ('apollo',                 'pcm','c0000000-0000-4000-8000-000000000024','APPROVED', now()),
  ('my eye dey bring dirty', 'pcm','c0000000-0000-4000-8000-000000000024','APPROVED', now()),
  ('earwax',                 'en', 'c0000000-0000-4000-8000-000000000025','APPROVED', now()),
  ('ear wax',                'en', 'c0000000-0000-4000-8000-000000000025','APPROVED', now()),
  ('my ear block',           'pcm','c0000000-0000-4000-8000-000000000025','APPROVED', now()),
  ('ear pain',               'en', 'c0000000-0000-4000-8000-000000000026','APPROVED', now()),
  ('my ear dey pain me',     'pcm','c0000000-0000-4000-8000-000000000026','APPROVED', now()),
  -- general
  ('chills',                 'en', 'c0000000-0000-4000-8000-000000000027','APPROVED', now()),
  ('shivering',              'en', 'c0000000-0000-4000-8000-000000000027','APPROVED', now()),
  ('cold dey catch me',      'pcm','c0000000-0000-4000-8000-000000000027','APPROVED', now()),
  ('fatigue',                'en', 'c0000000-0000-4000-8000-000000000028','APPROVED', now()),
  ('tiredness',              'en', 'c0000000-0000-4000-8000-000000000028','APPROVED', now()),
  ('body no get power',      'pcm','c0000000-0000-4000-8000-000000000028','APPROVED', now()),
  ('dizziness',              'en', 'c0000000-0000-4000-8000-000000000029','APPROVED', now()),
  ('dizzy',                  'en', 'c0000000-0000-4000-8000-000000000029','APPROVED', now()),
  ('my head dey turn',       'pcm','c0000000-0000-4000-8000-000000000029','APPROVED', now()),
  ('loss of appetite',       'en', 'c0000000-0000-4000-8000-00000000002a','APPROVED', now()),
  ('no appetite',            'en', 'c0000000-0000-4000-8000-00000000002a','APPROVED', now()),
  ('i no fit chop',          'pcm','c0000000-0000-4000-8000-00000000002a','APPROVED', now()),
  ('insomnia',               'en', 'c0000000-0000-4000-8000-00000000002b','APPROVED', now()),
  ('sleep problem',          'en', 'c0000000-0000-4000-8000-00000000002b','APPROVED', now()),
  ('i no fit sleep',         'pcm','c0000000-0000-4000-8000-00000000002b','APPROVED', now()),
  ('motion sickness',        'en', 'c0000000-0000-4000-8000-00000000002c','APPROVED', now()),
  ('car sickness',           'en', 'c0000000-0000-4000-8000-00000000002c','APPROVED', now()),
  ('moto dey make me vomit', 'pcm','c0000000-0000-4000-8000-00000000002c','APPROVED', now()),
  ('hangover',               'en', 'c0000000-0000-4000-8000-00000000002d','APPROVED', now()),
  ('i drink too much yesterday','pcm','c0000000-0000-4000-8000-00000000002d','APPROVED', now()),
  -- allergy / wounds / mouth
  ('allergy',                'en', 'c0000000-0000-4000-8000-00000000002e','APPROVED', now()),
  ('allergies',              'en', 'c0000000-0000-4000-8000-00000000002e','APPROVED', now()),
  ('allergic reaction',      'en', 'c0000000-0000-4000-8000-00000000002e','APPROVED', now()),
  ('cut',                    'en', 'c0000000-0000-4000-8000-00000000002f','APPROVED', now()),
  ('wound',                  'en', 'c0000000-0000-4000-8000-00000000002f','APPROVED', now()),
  ('blade cut me',           'pcm','c0000000-0000-4000-8000-00000000002f','APPROVED', now()),
  ('mouth ulcer',            'en', 'c0000000-0000-4000-8000-000000000030','APPROVED', now()),
  ('mouth sore',             'en', 'c0000000-0000-4000-8000-000000000030','APPROVED', now()),
  ('sore for my mouth',      'pcm','c0000000-0000-4000-8000-000000000030','APPROVED', now()),
  ('cold sore',              'en', 'c0000000-0000-4000-8000-000000000031','APPROVED', now()),
  ('fever blister',          'en', 'c0000000-0000-4000-8000-000000000031','APPROVED', now()),
  -- worms / malaria / urinary
  ('worm',                   'en', 'c0000000-0000-4000-8000-000000000032','APPROVED', now()),
  ('worms',                  'en', 'c0000000-0000-4000-8000-000000000032','APPROVED', now()),
  ('deworm',                 'en', 'c0000000-0000-4000-8000-000000000032','APPROVED', now()),
  ('worm dey worry me',      'pcm','c0000000-0000-4000-8000-000000000032','APPROVED', now()),
  ('malaria',                'en', 'c0000000-0000-4000-8000-000000000033','APPROVED', now()),
  ('maleria',                'en', 'c0000000-0000-4000-8000-000000000033','APPROVED', now()),
  ('i think say na malaria', 'pcm','c0000000-0000-4000-8000-000000000033','APPROVED', now()),
  ('painful urination',      'en', 'c0000000-0000-4000-8000-000000000034','APPROVED', now()),
  ('toilet infection',       'en', 'c0000000-0000-4000-8000-000000000034','APPROVED', now()),
  ('pee dey burn me',        'pcm','c0000000-0000-4000-8000-000000000034','APPROVED', now()),
  ('frequent urination',     'en', 'c0000000-0000-4000-8000-000000000035','APPROVED', now()),
  ('i dey piss every time',  'pcm','c0000000-0000-4000-8000-000000000035','APPROVED', now()),
  -- red-flag adjacent
  ('stiff neck',             'en', 'c0000000-0000-4000-8000-00000000003a','APPROVED', now()),
  ('my neck stiff',          'pcm','c0000000-0000-4000-8000-00000000003a','APPROVED', now()),
  ('difficulty breathing',   'en', 'c0000000-0000-4000-8000-00000000003b','APPROVED', now()),
  ('shortness of breath',    'en', 'c0000000-0000-4000-8000-00000000003b','APPROVED', now()),
  ('i no fit breathe well',  'pcm','c0000000-0000-4000-8000-00000000003b','APPROVED', now()),
  ('yellow eyes',            'en', 'c0000000-0000-4000-8000-00000000003c','APPROVED', now()),
  ('jaundice',               'en', 'c0000000-0000-4000-8000-00000000003c','APPROVED', now()),
  ('my eye don yellow',      'pcm','c0000000-0000-4000-8000-00000000003c','APPROVED', now())
ON CONFLICT DO NOTHING;

-- ─────────────────────────────────────────────────────────────────────────────
-- 7) TERMS — Hausa (ha) / Yoruba (yo) / Igbo (ig) language packs.
--    ALL AI_SUGGESTED (approved_at NULL): best-effort drafts, invisible to
--    users until a pharmacist approves each row in the mapping workbench.
-- ─────────────────────────────────────────────────────────────────────────────
INSERT INTO public.symptom_terms (term, language, concept_id, status) VALUES
  -- 20260827 concepts missing local terms: cough, catarrh, sore_throat, body_pain, diarrhea
  ('tari',                      'ha','c0000000-0000-4000-8000-000000000003','AI_SUGGESTED'),
  ('ikọ́',                      'yo','c0000000-0000-4000-8000-000000000003','AI_SUGGESTED'),
  ('ụkwara',                    'ig','c0000000-0000-4000-8000-000000000003','AI_SUGGESTED'),
  ('mura',                      'ha','c0000000-0000-4000-8000-000000000004','AI_SUGGESTED'),
  ('imú dídí',                  'yo','c0000000-0000-4000-8000-000000000004','AI_SUGGESTED'),
  ('imi kpọchiri',              'ig','c0000000-0000-4000-8000-000000000004','AI_SUGGESTED'),
  ('ciwon makogwaro',           'ha','c0000000-0000-4000-8000-000000000005','AI_SUGGESTED'),
  ('ọ̀fun dídùn',               'yo','c0000000-0000-4000-8000-000000000005','AI_SUGGESTED'),
  ('akpịrị mgbu',               'ig','c0000000-0000-4000-8000-000000000005','AI_SUGGESTED'),
  ('ciwon jiki',                'ha','c0000000-0000-4000-8000-000000000006','AI_SUGGESTED'),
  ('ara ríro',                  'yo','c0000000-0000-4000-8000-000000000006','AI_SUGGESTED'),
  ('ahụ mgbu',                  'ig','c0000000-0000-4000-8000-000000000006','AI_SUGGESTED'),
  ('zawo',                      'ha','c0000000-0000-4000-8000-000000000007','AI_SUGGESTED'),
  ('ìgbẹ́ gbuuru',              'yo','c0000000-0000-4000-8000-000000000007','AI_SUGGESTED'),
  ('afọ ọsịsa',                 'ig','c0000000-0000-4000-8000-000000000007','AI_SUGGESTED'),
  -- respiratory
  ('tari busasshe',             'ha','c0000000-0000-4000-8000-00000000000b','AI_SUGGESTED'),
  ('ikọ gbígbẹ',                'yo','c0000000-0000-4000-8000-00000000000b','AI_SUGGESTED'),
  ('ụkwara kpọrọ nkụ',          'ig','c0000000-0000-4000-8000-00000000000b','AI_SUGGESTED'),
  ('tari mai majina',           'ha','c0000000-0000-4000-8000-00000000000c','AI_SUGGESTED'),
  ('ikọ olómi',                 'yo','c0000000-0000-4000-8000-00000000000c','AI_SUGGESTED'),
  ('ụkwara mmiri',              'ig','c0000000-0000-4000-8000-00000000000c','AI_SUGGESTED'),
  ('atishawa',                  'ha','c0000000-0000-4000-8000-00000000000d','AI_SUGGESTED'),
  ('sín-ún',                    'yo','c0000000-0000-4000-8000-00000000000d','AI_SUGGESTED'),
  ('uzere',                     'ig','c0000000-0000-4000-8000-00000000000d','AI_SUGGESTED'),
  ('majina',                    'ha','c0000000-0000-4000-8000-000000000038','AI_SUGGESTED'),
  ('imú ń sàn',                 'yo','c0000000-0000-4000-8000-000000000038','AI_SUGGESTED'),
  ('imi mmiri',                 'ig','c0000000-0000-4000-8000-000000000038','AI_SUGGESTED'),
  -- pain
  ('ciwon kai mai tsanani',     'ha','c0000000-0000-4000-8000-00000000000e','AI_SUGGESTED'),
  ('orí fífọ́ líle',            'yo','c0000000-0000-4000-8000-00000000000e','AI_SUGGESTED'),
  ('isi ọwụwa siri ike',        'ig','c0000000-0000-4000-8000-00000000000e','AI_SUGGESTED'),
  ('ciwon baya',                'ha','c0000000-0000-4000-8000-00000000000f','AI_SUGGESTED'),
  ('irora ẹ̀yìn',               'yo','c0000000-0000-4000-8000-00000000000f','AI_SUGGESTED'),
  ('azụ mgbu',                  'ig','c0000000-0000-4000-8000-00000000000f','AI_SUGGESTED'),
  ('ciwon hakori',              'ha','c0000000-0000-4000-8000-000000000010','AI_SUGGESTED'),
  ('eyín dídùn',                'yo','c0000000-0000-4000-8000-000000000010','AI_SUGGESTED'),
  ('eze mgbu',                  'ig','c0000000-0000-4000-8000-000000000010','AI_SUGGESTED'),
  ('ciwon al''ada',             'ha','c0000000-0000-4000-8000-000000000011','AI_SUGGESTED'),
  ('inú rírun nǹkan oṣù',       'yo','c0000000-0000-4000-8000-000000000011','AI_SUGGESTED'),
  ('mgbu nsọ',                  'ig','c0000000-0000-4000-8000-000000000011','AI_SUGGESTED'),
  ('ciwon gabobi',              'ha','c0000000-0000-4000-8000-000000000012','AI_SUGGESTED'),
  ('irora oríkèé',              'yo','c0000000-0000-4000-8000-000000000012','AI_SUGGESTED'),
  ('nkwonkwo mgbu',             'ig','c0000000-0000-4000-8000-000000000012','AI_SUGGESTED'),
  ('murdewa',                   'ha','c0000000-0000-4000-8000-000000000039','AI_SUGGESTED'),
  ('iṣan fífà',                 'yo','c0000000-0000-4000-8000-000000000039','AI_SUGGESTED'),
  ('akwara mgbakasị',           'ig','c0000000-0000-4000-8000-000000000039','AI_SUGGESTED'),
  -- GI
  ('kwannafi',                  'ha','c0000000-0000-4000-8000-000000000013','AI_SUGGESTED'),
  ('àyà gbígbóná',              'yo','c0000000-0000-4000-8000-000000000013','AI_SUGGESTED'),
  ('obi ọkụ',                   'ig','c0000000-0000-4000-8000-000000000013','AI_SUGGESTED'),
  ('rashin narkewar abinci',    'ha','c0000000-0000-4000-8000-000000000014','AI_SUGGESTED'),
  ('oúnjẹ àìdà',                'yo','c0000000-0000-4000-8000-000000000014','AI_SUGGESTED'),
  ('mgbaze nri adịghị',         'ig','c0000000-0000-4000-8000-000000000014','AI_SUGGESTED'),
  ('tashin zuciya',             'ha','c0000000-0000-4000-8000-000000000015','AI_SUGGESTED'),
  ('inú ríru',                  'yo','c0000000-0000-4000-8000-000000000015','AI_SUGGESTED'),
  ('obi mgbagha',               'ig','c0000000-0000-4000-8000-000000000015','AI_SUGGESTED'),
  ('amai',                      'ha','c0000000-0000-4000-8000-000000000016','AI_SUGGESTED'),
  ('èébì',                      'yo','c0000000-0000-4000-8000-000000000016','AI_SUGGESTED'),
  ('ịgbọ agbọ',                 'ig','c0000000-0000-4000-8000-000000000016','AI_SUGGESTED'),
  ('wahalar bayan gida',        'ha','c0000000-0000-4000-8000-000000000017','AI_SUGGESTED'),
  ('inú dídí',                  'yo','c0000000-0000-4000-8000-000000000017','AI_SUGGESTED'),
  ('afọ mgbochi',               'ig','c0000000-0000-4000-8000-000000000017','AI_SUGGESTED'),
  ('ciwon ciki',                'ha','c0000000-0000-4000-8000-000000000018','AI_SUGGESTED'),
  ('inú rírun',                 'yo','c0000000-0000-4000-8000-000000000018','AI_SUGGESTED'),
  ('afọ mgbu',                  'ig','c0000000-0000-4000-8000-000000000018','AI_SUGGESTED'),
  ('kumburin ciki',             'ha','c0000000-0000-4000-8000-000000000019','AI_SUGGESTED'),
  ('inú wíwú',                  'yo','c0000000-0000-4000-8000-000000000019','AI_SUGGESTED'),
  ('afọ otuto',                 'ig','c0000000-0000-4000-8000-000000000019','AI_SUGGESTED'),
  -- skin
  ('kurji',                     'ha','c0000000-0000-4000-8000-00000000001a','AI_SUGGESTED'),
  ('èélá',                      'yo','c0000000-0000-4000-8000-00000000001a','AI_SUGGESTED'),
  ('ntụpọ ahụ',                 'ig','c0000000-0000-4000-8000-00000000001a','AI_SUGGESTED'),
  ('kaikayi',                   'ha','c0000000-0000-4000-8000-00000000001b','AI_SUGGESTED'),
  ('ara yíyún',                 'yo','c0000000-0000-4000-8000-00000000001b','AI_SUGGESTED'),
  ('ọkọ ahụ',                   'ig','c0000000-0000-4000-8000-00000000001b','AI_SUGGESTED'),
  ('kunar wuta',                'ha','c0000000-0000-4000-8000-00000000001c','AI_SUGGESTED'),
  ('ìjóná kékeré',              'yo','c0000000-0000-4000-8000-00000000001c','AI_SUGGESTED'),
  ('ọkụ gbara m',               'ig','c0000000-0000-4000-8000-00000000001c','AI_SUGGESTED'),
  ('cizon kwari',               'ha','c0000000-0000-4000-8000-00000000001d','AI_SUGGESTED'),
  ('jíjẹ kòkòrò',               'yo','c0000000-0000-4000-8000-00000000001d','AI_SUGGESTED'),
  ('ahụhụ tara m',              'ig','c0000000-0000-4000-8000-00000000001d','AI_SUGGESTED'),
  ('kazuwa',                    'ha','c0000000-0000-4000-8000-00000000001e','AI_SUGGESTED'),
  ('lápálápá',                  'yo','c0000000-0000-4000-8000-00000000001e','AI_SUGGESTED'),
  ('ọcha ọcha na ahụ',          'ig','c0000000-0000-4000-8000-00000000001e','AI_SUGGESTED'),
  ('maruru',                    'ha','c0000000-0000-4000-8000-00000000001f','AI_SUGGESTED'),
  ('oówo',                      'yo','c0000000-0000-4000-8000-00000000001f','AI_SUGGESTED'),
  ('etuto',                     'ig','c0000000-0000-4000-8000-00000000001f','AI_SUGGESTED'),
  ('dandurufi',                 'ha','c0000000-0000-4000-8000-000000000020','AI_SUGGESTED'),
  ('orí gbígbẹ',                'yo','c0000000-0000-4000-8000-000000000020','AI_SUGGESTED'),
  ('unyi isi',                  'ig','c0000000-0000-4000-8000-000000000020','AI_SUGGESTED'),
  ('kaikayin tsakanin yatsu',   'ha','c0000000-0000-4000-8000-000000000021','AI_SUGGESTED'),
  ('ẹsẹ̀ yíyún',                'yo','c0000000-0000-4000-8000-000000000021','AI_SUGGESTED'),
  ('ụkwụ ọkọ',                  'ig','c0000000-0000-4000-8000-000000000021','AI_SUGGESTED'),
  ('kurjin zafi',               'ha','c0000000-0000-4000-8000-000000000036','AI_SUGGESTED'),
  ('èélá ooru',                 'yo','c0000000-0000-4000-8000-000000000036','AI_SUGGESTED'),
  ('ntụpọ okpomọkụ',            'ig','c0000000-0000-4000-8000-000000000036','AI_SUGGESTED'),
  -- eyes / ears
  ('kaikayin ido',              'ha','c0000000-0000-4000-8000-000000000022','AI_SUGGESTED'),
  ('ojú yíyún',                 'yo','c0000000-0000-4000-8000-000000000022','AI_SUGGESTED'),
  ('anya ọkọ',                  'ig','c0000000-0000-4000-8000-000000000022','AI_SUGGESTED'),
  ('jan ido',                   'ha','c0000000-0000-4000-8000-000000000023','AI_SUGGESTED'),
  ('ojú pupa',                  'yo','c0000000-0000-4000-8000-000000000023','AI_SUGGESTED'),
  ('anya ọbara ọbara',          'ig','c0000000-0000-4000-8000-000000000023','AI_SUGGESTED'),
  ('majinar ido',               'ha','c0000000-0000-4000-8000-000000000024','AI_SUGGESTED'),
  ('àpólò',                     'yo','c0000000-0000-4000-8000-000000000024','AI_SUGGESTED'),
  ('anya na-agba mmiri',        'ig','c0000000-0000-4000-8000-000000000024','AI_SUGGESTED'),
  ('dattin kunne',              'ha','c0000000-0000-4000-8000-000000000025','AI_SUGGESTED'),
  ('idọti etí',                 'yo','c0000000-0000-4000-8000-000000000025','AI_SUGGESTED'),
  ('unyi ntị',                  'ig','c0000000-0000-4000-8000-000000000025','AI_SUGGESTED'),
  ('ciwon kunne',               'ha','c0000000-0000-4000-8000-000000000026','AI_SUGGESTED'),
  ('etí dídùn',                 'yo','c0000000-0000-4000-8000-000000000026','AI_SUGGESTED'),
  ('ntị mgbu',                  'ig','c0000000-0000-4000-8000-000000000026','AI_SUGGESTED'),
  -- general
  ('sanyin jiki',               'ha','c0000000-0000-4000-8000-000000000027','AI_SUGGESTED'),
  ('òtútù gbígbọ̀n',            'yo','c0000000-0000-4000-8000-000000000027','AI_SUGGESTED'),
  ('ahụ oyi',                   'ig','c0000000-0000-4000-8000-000000000027','AI_SUGGESTED'),
  ('gajiya',                    'ha','c0000000-0000-4000-8000-000000000028','AI_SUGGESTED'),
  ('àárẹ̀',                     'yo','c0000000-0000-4000-8000-000000000028','AI_SUGGESTED'),
  ('ike ọgwụgwụ',               'ig','c0000000-0000-4000-8000-000000000028','AI_SUGGESTED'),
  ('jiri',                      'ha','c0000000-0000-4000-8000-000000000029','AI_SUGGESTED'),
  ('òyì orí',                   'yo','c0000000-0000-4000-8000-000000000029','AI_SUGGESTED'),
  ('isi ịgba gharịgharị',       'ig','c0000000-0000-4000-8000-000000000029','AI_SUGGESTED'),
  ('rashin cin abinci',         'ha','c0000000-0000-4000-8000-00000000002a','AI_SUGGESTED'),
  ('àìjẹun',                    'yo','c0000000-0000-4000-8000-00000000002a','AI_SUGGESTED'),
  ('enweghị agụụ',              'ig','c0000000-0000-4000-8000-00000000002a','AI_SUGGESTED'),
  ('rashin barci',              'ha','c0000000-0000-4000-8000-00000000002b','AI_SUGGESTED'),
  ('àìlèsùn',                   'yo','c0000000-0000-4000-8000-00000000002b','AI_SUGGESTED'),
  ('ụra adịghị',                'ig','c0000000-0000-4000-8000-00000000002b','AI_SUGGESTED'),
  ('jirin mota',                'ha','c0000000-0000-4000-8000-00000000002c','AI_SUGGESTED'),
  ('èébì ọkọ̀',                 'yo','c0000000-0000-4000-8000-00000000002c','AI_SUGGESTED'),
  ('ọgbụgbọ ụgbọ',              'ig','c0000000-0000-4000-8000-00000000002c','AI_SUGGESTED'),
  -- wounds / mouth
  ('yanka',                     'ha','c0000000-0000-4000-8000-00000000002f','AI_SUGGESTED'),
  ('ọgbẹ́',                     'yo','c0000000-0000-4000-8000-00000000002f','AI_SUGGESTED'),
  ('ọnya',                      'ig','c0000000-0000-4000-8000-00000000002f','AI_SUGGESTED'),
  ('gyambon baki',              'ha','c0000000-0000-4000-8000-000000000030','AI_SUGGESTED'),
  ('egbò ẹnu',                  'yo','c0000000-0000-4000-8000-000000000030','AI_SUGGESTED'),
  ('ọnya ọnụ',                  'ig','c0000000-0000-4000-8000-000000000030','AI_SUGGESTED'),
  -- worms / malaria / urinary
  ('tsutsotsi',                 'ha','c0000000-0000-4000-8000-000000000032','AI_SUGGESTED'),
  ('aràn inú',                  'yo','c0000000-0000-4000-8000-000000000032','AI_SUGGESTED'),
  ('idide afọ',                 'ig','c0000000-0000-4000-8000-000000000032','AI_SUGGESTED'),
  ('zazzabin cizon sauro',      'ha','c0000000-0000-4000-8000-000000000033','AI_SUGGESTED'),
  ('àrùn ibà',                  'yo','c0000000-0000-4000-8000-000000000033','AI_SUGGESTED'),
  ('ịba',                       'ig','c0000000-0000-4000-8000-000000000033','AI_SUGGESTED'),
  ('zafin fitsari',             'ha','c0000000-0000-4000-8000-000000000034','AI_SUGGESTED'),
  ('ìtọ̀ gbígbóná',             'yo','c0000000-0000-4000-8000-000000000034','AI_SUGGESTED'),
  ('mmamịrị ọkụ',               'ig','c0000000-0000-4000-8000-000000000034','AI_SUGGESTED'),
  ('fitsari akai-akai',         'ha','c0000000-0000-4000-8000-000000000035','AI_SUGGESTED'),
  ('ìtọ̀ lọ́pọ̀ ìgbà',          'yo','c0000000-0000-4000-8000-000000000035','AI_SUGGESTED'),
  ('mmamịrị ugboro ugboro',     'ig','c0000000-0000-4000-8000-000000000035','AI_SUGGESTED'),
  -- red-flag adjacent
  ('taurin wuya',               'ha','c0000000-0000-4000-8000-00000000003a','AI_SUGGESTED'),
  ('ọrùn líle',                 'yo','c0000000-0000-4000-8000-00000000003a','AI_SUGGESTED'),
  ('olu siri ike',              'ig','c0000000-0000-4000-8000-00000000003a','AI_SUGGESTED'),
  ('wahalar numfashi',          'ha','c0000000-0000-4000-8000-00000000003b','AI_SUGGESTED'),
  ('ìmí líle',                  'yo','c0000000-0000-4000-8000-00000000003b','AI_SUGGESTED'),
  ('iku ume siri ike',          'ig','c0000000-0000-4000-8000-00000000003b','AI_SUGGESTED'),
  ('rawayar ido',               'ha','c0000000-0000-4000-8000-00000000003c','AI_SUGGESTED'),
  ('ojú ofeefee',               'yo','c0000000-0000-4000-8000-00000000003c','AI_SUGGESTED'),
  ('anya odo odo',              'ig','c0000000-0000-4000-8000-00000000003c','AI_SUGGESTED')
ON CONFLICT DO NOTHING;

COMMIT;
