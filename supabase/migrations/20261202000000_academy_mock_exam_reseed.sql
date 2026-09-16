-- Academy mock-exam content re-seed (templates + instances + question mappings).
--
-- Why: the original seeds (20260806000001/20260806000002) silently no-op'd on
-- every real database. They carried an earlier timestamp than the spine content
-- they keyed on (academy_classes is populated by the Go startup seeder and the
-- 20261103000001 quiz seed, both later), and they referenced subject codes the
-- live spine never had (SS, SCI, CHM — the real codes are SOS, BSC/BST, CHE).
-- Result: academy_mock_exam_templates/instances were empty on cloud even after
-- a full 402-version sync, so /api/finance/academy/mock-exams/templates
-- returned an empty list.
--
-- Pattern: self-contained spine prelude mirroring 20261103000001 — ensure the
-- NERDC-2025 version, classes, and the subjects this seed references exist, so
-- a fresh `supabase db reset` replay and an already-seeded cloud both converge
-- on the same content. ADDITIVE ONLY. Idempotent:
--   templates  → guarded by tags @> '{mock-exam-seed-v2}' (no natural unique key)
--   instances  → ON CONFLICT (exam_code) DO NOTHING
--   mappings   → ON CONFLICT (instance_id, question_item_id) DO NOTHING
--   answer keys→ only filled where marking_scheme.answer_keys is empty
--
-- Question content comes from the approved NERDC bank (academy_question_items,
-- ~50 approved MCQs per class/subject seeded by 20261103000001 and expansions).
-- Answer keys are computed per-database from the mapped questions' answer JSON,
-- because question ids are generated UUIDs and differ between environments.
BEGIN;

-- ── 0. Spine prelude: curriculum version + classes (natural-keyed, no-op when present)
INSERT INTO public.academy_curriculum_versions (code, name, effective_date, status)
SELECT 'NERDC-2025', 'NERDC National Curriculum 2025', DATE '2025-09-01', 'active'
WHERE NOT EXISTS (SELECT 1 FROM public.academy_curriculum_versions WHERE code='NERDC-2025');

INSERT INTO public.academy_classes (version_id, phase, code, name, ordinal)
SELECT ver.id, v.phase, v.code, v.name, v.ordinal
FROM (VALUES
  ('LowerPrimary','P1','Primary 1',1),
  ('LowerPrimary','P2','Primary 2',2),
  ('LowerPrimary','P3','Primary 3',3),
  ('UpperPrimary','P4','Primary 4',4),
  ('UpperPrimary','P5','Primary 5',5),
  ('UpperPrimary','P6','Primary 6',6),
  ('JSS','JSS1','Junior Secondary 1',7),
  ('JSS','JSS2','Junior Secondary 2',8),
  ('JSS','JSS3','Junior Secondary 3',9),
  ('SSS','SSS1','Senior Secondary 1',10),
  ('SSS','SSS2','Senior Secondary 2',11),
  ('SSS','SSS3','Senior Secondary 3',12)
) AS v(phase, code, name, ordinal)
JOIN public.academy_curriculum_versions ver ON ver.code='NERDC-2025'
ON CONFLICT (version_id, code) DO NOTHING;

-- ── 1. Subjects referenced by the templates below (existing rows keep their names)
INSERT INTO public.academy_subjects (version_id, class_id, code, name, kind)
SELECT c.version_id, c.id, v.subj_code, v.subj_name, 'core'
FROM (VALUES
  ('P1','ENG','English Studies'), ('P1','MTH','Mathematics'), ('P1','BSC','Basic Science and Technology'), ('P1','SOS','Social Studies'),
  ('P2','ENG','English Studies'), ('P2','MTH','Mathematics'), ('P2','BSC','Basic Science and Technology'), ('P2','SOS','Social Studies'),
  ('P3','ENG','English Studies'), ('P3','MTH','Mathematics'), ('P3','BSC','Basic Science and Technology'), ('P3','SOS','Social Studies'),
  ('P4','ENG','English Studies'), ('P4','MTH','Mathematics'), ('P4','BST','Basic Science and Technology'), ('P4','SOS','Social Studies'),
  ('P5','ENG','English Studies'), ('P5','MTH','Mathematics'), ('P5','BST','Basic Science and Technology'), ('P5','SOS','Social Studies'),
  ('P6','ENG','English Studies'), ('P6','MTH','Mathematics'), ('P6','BST','Basic Science and Technology'), ('P6','SOS','Social Studies'),
  ('JSS1','ENG','English Language'), ('JSS1','MTH','Mathematics'), ('JSS1','BSC','Intermediate Science'), ('JSS1','BST','Business Studies'), ('JSS1','SOS','Social Studies'),
  ('JSS2','ENG','English Language'), ('JSS2','MTH','Mathematics'), ('JSS2','BSC','Intermediate Science'), ('JSS2','BST','Business Studies'), ('JSS2','SOS','Social Studies'),
  ('JSS3','ENG','English Language'), ('JSS3','MTH','Mathematics'), ('JSS3','BSC','Intermediate Science'), ('JSS3','BST','Business Studies'), ('JSS3','SOS','Social Studies'),
  ('SSS1','ENG','English Language'), ('SSS1','MTH','Mathematics'), ('SSS1','BIO','Biology'), ('SSS1','CHE','Chemistry'), ('SSS1','PHY','Physics'),
  ('SSS2','ENG','English Language'), ('SSS2','MTH','Mathematics'), ('SSS2','BIO','Biology'), ('SSS2','CHE','Chemistry'), ('SSS2','PHY','Physics'),
  ('SSS3','ENG','English Language'), ('SSS3','MTH','Mathematics'), ('SSS3','BIO','Biology'), ('SSS3','CHE','Chemistry'), ('SSS3','PHY','Physics')
) AS v(class_code, subj_code, subj_name)
JOIN public.academy_curriculum_versions ver ON ver.code='NERDC-2025'
JOIN public.academy_classes c ON c.version_id=ver.id AND c.code=v.class_code
ON CONFLICT (class_id, code) DO NOTHING;

-- ── 2. Templates: 12 class-wide mocks + 7 practice drills (19 total)
-- Per-class question totals divide evenly across the subject list so the
-- mapping step can draw total_questions/nsubjects per subject (bank ~50/subject).
INSERT INTO public.academy_mock_exam_templates
  (version_id, class_id, name, description, exam_type, subject_ids, sections,
   total_questions, total_seconds, difficulty_distribution, status, tags)
SELECT
  c.version_id, c.id,
  c.name || ' Comprehensive Mock Examination',
  c.name || ' full mock examination covering ' || array_to_string(v.subj_codes, ', '),
  'class_mock',
  (SELECT array_agg(s.id ORDER BY s.code) FROM public.academy_subjects s
    WHERE s.class_id=c.id AND s.code = ANY (v.subj_codes)),
  '[]'::jsonb,
  v.total_q, v.total_sec,
  '{"easy":{"percentage":0.2},"medium":{"percentage":0.5},"hard":{"percentage":0.3}}'::jsonb,
  'approved',
  ARRAY['mock-exam','mock-exam-seed-v2']
FROM (VALUES
  ('P1',   ARRAY['ENG','MTH','BSC','SOS'],  40, 2400),
  ('P2',   ARRAY['ENG','MTH','BSC','SOS'],  40, 2400),
  ('P3',   ARRAY['ENG','MTH','BSC','SOS'],  40, 2400),
  ('P4',   ARRAY['ENG','MTH','BST','SOS'],  60, 3600),
  ('P5',   ARRAY['ENG','MTH','BST','SOS'],  60, 3600),
  ('P6',   ARRAY['ENG','MTH','BST','SOS'],  60, 3600),
  ('JSS1', ARRAY['BSC','BST','ENG','MTH','SOS'],  75, 4500),
  ('JSS2', ARRAY['BSC','BST','ENG','MTH','SOS'],  75, 4500),
  ('JSS3', ARRAY['BSC','BST','ENG','MTH','SOS'],  75, 4500),
  ('SSS1', ARRAY['BIO','CHE','ENG','MTH','PHY'], 100, 6000),
  ('SSS2', ARRAY['BIO','CHE','ENG','MTH','PHY'], 100, 6000),
  ('SSS3', ARRAY['BIO','CHE','ENG','MTH','PHY'], 100, 6000)
) AS v(class_code, subj_codes, total_q, total_sec)
JOIN public.academy_curriculum_versions ver ON ver.code='NERDC-2025'
JOIN public.academy_classes c ON c.version_id=ver.id AND c.code=v.class_code
WHERE NOT EXISTS (SELECT 1 FROM public.academy_mock_exam_templates
                  WHERE tags @> ARRAY['mock-exam-seed-v2'] AND exam_type='class_mock');

INSERT INTO public.academy_mock_exam_templates
  (version_id, class_id, name, description, exam_type, subject_ids, sections,
   total_questions, total_seconds, difficulty_distribution, status, tags)
SELECT
  c.version_id, c.id, v.drill_name, v.drill_desc, 'practice_drill',
  (SELECT array_agg(s.id) FROM public.academy_subjects s
    WHERE s.class_id=c.id AND s.code=v.subj_code),
  '[]'::jsonb,
  20, 1800,
  '{"easy":{"percentage":0.3},"medium":{"percentage":0.4},"hard":{"percentage":0.3}}'::jsonb,
  'approved',
  ARRAY['mock-exam','mock-exam-seed-v2']
FROM (VALUES
  ('SSS1','MTH','Algebra Fundamentals Practice Drill','Focused practice on algebra concepts and problem-solving'),
  ('SSS1','ENG','Sentence Structure Practice Drill','Grammar and sentence construction focus'),
  ('P5','MTH','Fractions Practice Drill','Comprehensive fractions and decimal operations'),
  ('JSS1','ENG','Comprehension Mastery Drill','Reading comprehension and inference practice'),
  ('SSS1','BIO','Photosynthesis Practice Drill','Plant physiology and photosynthesis mastery'),
  ('JSS2','BSC','States of Matter Practice Drill','Matter properties and phase transitions'),
  ('JSS1','SOS','History Foundations Practice Drill','Historical knowledge and timeline understanding')
) AS v(class_code, subj_code, drill_name, drill_desc)
JOIN public.academy_curriculum_versions ver ON ver.code='NERDC-2025'
JOIN public.academy_classes c ON c.version_id=ver.id AND c.code=v.class_code
WHERE NOT EXISTS (SELECT 1 FROM public.academy_mock_exam_templates
                  WHERE tags @> ARRAY['mock-exam-seed-v2'] AND exam_type='practice_drill');

-- ── 3. Instances: 3 variants per template, deterministic exam_code
-- class_mock → '<CLASS>-MOCK-V<n>'; practice_drill → '<CLASS>-<SUBJ>-DRILL-V<n>'
INSERT INTO public.academy_mock_exam_instances
  (template_id, exam_code, variant, seed, marking_scheme)
SELECT
  t.id,
  c.code || CASE WHEN t.exam_type='class_mock' THEN '-MOCK'
                 ELSE '-' || s.code || '-DRILL' END || '-V' || v.variant,
  v.variant,
  c.ordinal * 1000 + v.variant * 100 + COALESCE(length(s.code), 0),
  '{"total_marks":100,"pass_mark":50,"answer_keys":{}}'::jsonb
FROM public.academy_mock_exam_templates t
JOIN public.academy_classes c ON c.id = t.class_id
LEFT JOIN public.academy_subjects s
  ON t.exam_type='practice_drill' AND s.id = t.subject_ids[1]
CROSS JOIN (SELECT generate_series(1,3) AS variant) v
WHERE t.tags @> ARRAY['mock-exam-seed-v2']
ON CONFLICT (exam_code) DO NOTHING;

-- ── 4. Question mappings: per subject, draw total_questions/nsubjects approved
-- MCQs from the bank, ordered deterministically (stem, id); each variant starts
-- at a different offset and wraps modulo the bank size (some banks are 49).
WITH inst AS (
  SELECT i.id AS instance_id, i.variant, t.subject_ids,
         t.total_questions / cardinality(t.subject_ids) AS per_subj,
         GREATEST(t.total_seconds / t.total_questions, 1) AS sec_per_q
  FROM public.academy_mock_exam_instances i
  JOIN public.academy_mock_exam_templates t ON t.id = i.template_id
  WHERE t.tags @> ARRAY['mock-exam-seed-v2']
),
ranked AS (
  SELECT q.id AS qid, q.subject_id, s.code AS subj_code,
         row_number() OVER (PARTITION BY q.subject_id ORDER BY q.stem, q.id) - 1 AS rn,
         count(*)     OVER (PARTITION BY q.subject_id) AS bank
  FROM public.academy_question_items q
  JOIN public.academy_subjects s ON s.id = q.subject_id
  WHERE q.status='approved' AND q.type='mcq'
),
picks AS (
  SELECT i.instance_id, r.qid, r.subj_code, i.sec_per_q, gs.i AS pick_ord
  FROM inst i
  CROSS JOIN LATERAL unnest(i.subject_ids) AS subj(subject_id)
  CROSS JOIN LATERAL generate_series(0, i.per_subj - 1) AS gs(i)
  JOIN ranked r ON r.subject_id = subj.subject_id
              AND r.rn = ((i.variant - 1) * i.per_subj + gs.i) % r.bank
)
INSERT INTO public.academy_mock_question_mappings
  (instance_id, question_item_id, display_order, section, time_allocated_sec)
SELECT instance_id, qid,
       row_number() OVER (PARTITION BY instance_id ORDER BY subj_code, pick_ord),
       subj_code, sec_per_q
FROM picks
ON CONFLICT (instance_id, question_item_id) DO NOTHING;

-- ── 5. Answer keys: computed from the mapped questions' own answers
-- (question ids are per-database UUIDs, so keys cannot be hardcoded).
-- gradeExam compares answers[question_item_id] to answer_keys[question_item_id].
UPDATE public.academy_mock_exam_instances i
SET marking_scheme = jsonb_build_object(
      'total_marks', 100,
      'pass_mark', 50,
      'answer_keys', ak.keys)
FROM (
  SELECT m.instance_id,
         jsonb_object_agg(m.question_item_id::text, q.answer->'correct'->>0) AS keys
  FROM public.academy_mock_question_mappings m
  JOIN public.academy_question_items q ON q.id = m.question_item_id
  GROUP BY m.instance_id
) ak
WHERE ak.instance_id = i.id
  AND i.template_id IN (SELECT id FROM public.academy_mock_exam_templates
                        WHERE tags @> ARRAY['mock-exam-seed-v2'])
  AND COALESCE(i.marking_scheme->'answer_keys', '{}'::jsonb) = '{}'::jsonb;

COMMIT;
