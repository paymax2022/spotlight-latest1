-- Seed one working CBT blueprint so the exam (Phase-1 "crown") attempt loop has
-- something to run. The exam engine (begin → serve questions → submit → server
-- grade → result) is built and grades against academy_question_items, but there
-- were 0 blueprints, so an attempt could never be started against a real spec.
--
-- Sections drive the served set: each {subject_id, count} selects `count` approved
-- items for that subject (exam.Service.AttemptQuestions). We reuse the practice
-- question bank (JSS1 Mathematics + P4 English) — enough live items to exercise a
-- full begin→submit→score run. total_items matches the section counts.
--
-- Idempotent: arena resolved by code (NABTEB), subject_ids resolved by natural key
-- within the active NERDC-2025 version; guarded by NOT EXISTS (arena_id, name) so
-- re-running inserts nothing. Additive-only. variant/pause_policy honour the CHECK
-- constraints (full|single|drill, none|allowed); status 'active' so GetBlueprint
-- serves it.
INSERT INTO public.academy_cbt_blueprints
  (arena_id, name, variant, sections, total_items, total_seconds, navigation, tools, shuffle, pause_policy, status)
SELECT
  a.id,
  'Numeracy & Grammar Mock (CBT)',
  'full',
  jsonb_build_array(
    jsonb_build_object('subject_id', mth.id, 'count', 4),
    jsonb_build_object('subject_id', eng.id, 'count', 3)
  ),
  7,
  1200,
  '{"allow_back": true}'::jsonb,
  '{"calculator": true}'::jsonb,
  false,
  'allowed',
  'active'
FROM public.academy_exam_arenas a
JOIN public.academy_curriculum_versions v ON v.code = 'NERDC-2025'
JOIN public.academy_classes c_mth  ON c_mth.version_id = v.id AND c_mth.code = 'JSS1'
JOIN public.academy_subjects mth   ON mth.class_id = c_mth.id AND mth.code = 'MTH'
JOIN public.academy_classes c_eng  ON c_eng.version_id = v.id AND c_eng.code = 'P4'
JOIN public.academy_subjects eng   ON eng.class_id = c_eng.id AND eng.code = 'ENG'
WHERE a.code = 'NABTEB'
  AND NOT EXISTS (
    SELECT 1 FROM public.academy_cbt_blueprints bp
    WHERE bp.arena_id = a.id AND bp.name = 'Numeracy & Grammar Mock (CBT)'
  );
