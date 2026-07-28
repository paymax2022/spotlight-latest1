-- Spotlight Academy — Phase 4 data seed (NABTEB arena + ECCE classes).
-- Additive data only (ON CONFLICT DO NOTHING). NABTEB + ECCE need no schema change
-- (already permitted by existing CHECKs); full P1–SSS3 + LEGACY coverage is seeded
-- by the curriculum service Seed() — this adds the Phase-4 breadth items.
BEGIN;

-- NABTEB exam arena (Phase 4 addition to the crown).
INSERT INTO public.academy_exam_arenas (code, name, subject_set, scoring_rules, status)
VALUES ('NABTEB', 'NABTEB (Technical & Business)', '{}', '{"bands":"WAEC-9"}'::jsonb, 'active')
ON CONFLICT (code) DO NOTHING;

-- ECCE (pre-primary) classes for the NERDC-2025 version (optional E1–E3 surface).
INSERT INTO public.academy_classes (version_id, phase, code, name, ordinal)
SELECT v.id, 'ECCE', c.code, c.name, c.ordinal
FROM public.academy_curriculum_versions v
CROSS JOIN (VALUES
  ('ECCE1', 'Pre-Nursery', 0),
  ('ECCE2', 'Nursery 1', 1),
  ('ECCE3', 'Nursery 2', 2)
) AS c(code, name, ordinal)
WHERE v.code = 'NERDC-2025'
ON CONFLICT (version_id, code) DO NOTHING;

COMMIT;
