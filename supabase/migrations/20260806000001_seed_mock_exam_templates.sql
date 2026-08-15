-- Seed Mock Exam Templates
-- Generated from 150-agent swarm execution

BEGIN;

-- Helper function to get or create curriculum version
DO $$
DECLARE
  v_version_id UUID;
BEGIN
  -- Canonical academy_curriculum_versions schema (20260815000800 / the prelude
  -- in 20260806000000): columns (id, code, name, effective_date, status) with
  -- status IN ('draft','active','retired'). The original lookup used
  -- created_at/created_by and status='approved', which don't exist there and
  -- aborted every fresh replay.
  SELECT id INTO v_version_id FROM academy_curriculum_versions
  WHERE status='active' ORDER BY effective_date DESC NULLS LAST LIMIT 1;

  -- If none exists, create one
  IF v_version_id IS NULL THEN
    INSERT INTO academy_curriculum_versions (code, name, status)
    VALUES ('DEFAULT-2025-08', 'Default Curriculum 2025-08', 'active')
    ON CONFLICT (code) DO UPDATE SET status = 'active'
    RETURNING id INTO v_version_id;
  END IF;

  -- Seed data needs the class/subject spine (seeded by the Go backend at
  -- startup, not by migrations — see academy module convention). On a fresh
  -- database the spine is empty: skip quietly rather than violate NOT NULL
  -- class_id. Templates can be re-seeded once the spine exists.
  IF NOT EXISTS (SELECT 1 FROM academy_classes WHERE version_id = v_version_id) THEN
    RAISE NOTICE 'academy mock-exam template seed skipped — class spine not seeded yet';
    RETURN;
  END IF;

  -- Insert class-wide mock exams
  INSERT INTO academy_mock_exam_templates
    (version_id, class_id, name, description, exam_type, subject_ids, sections, total_questions, total_seconds, difficulty_distribution, status)
  SELECT
    v_version_id,
    ac.id,
    CASE ac.code
      WHEN 'P1' THEN 'P1 Comprehensive Mock Exam Template'
      WHEN 'P2' THEN 'P2 Comprehensive Mock Examination'
      WHEN 'P4' THEN 'P4 Upper Primary Comprehensive Mock Examination'
      WHEN 'P5' THEN 'P5 Comprehensive Mock Examination'
      WHEN 'P6' THEN 'P6 Upper Primary Final Assessment'
      WHEN 'JSS1' THEN 'JSS1 Comprehensive Mock Examination'
      WHEN 'JSS2' THEN 'JSS2 Comprehensive Mock Examination'
      WHEN 'JSS3' THEN 'JSS3 Comprehensive Mock Examination'
      WHEN 'SSS1' THEN 'SSS1 Comprehensive Mock Examination'
      WHEN 'SSS2' THEN 'SSS2 Mock Examination'
      WHEN 'SSS3' THEN 'SSS3 Comprehensive Mock Examination'
    END,
    CASE ac.code
      WHEN 'P1' THEN 'Primary 1 full mock examination covering English, Mathematics, and Social Studies'
      WHEN 'P2' THEN 'Primary 2 full mock examination'
      WHEN 'P4' THEN 'Upper Primary assessment covering all core subjects'
      WHEN 'P5' THEN 'Primary 5 summative assessment'
      WHEN 'P6' THEN 'Primary 6 comprehensive final examination'
      WHEN 'JSS1' THEN 'Junior Secondary School 1 full examination'
      WHEN 'JSS2' THEN 'Junior Secondary School 2 terminal examination'
      WHEN 'JSS3' THEN 'Junior Secondary School 3 comprehensive assessment'
      WHEN 'SSS1' THEN 'Senior Secondary School 1 full examination'
      WHEN 'SSS2' THEN 'Senior Secondary School 2 examination'
      WHEN 'SSS3' THEN 'Senior Secondary School 3 comprehensive final examination'
    END,
    'class_mock',
    CASE ac.code
      WHEN 'P1' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='SS')]
      WHEN 'P2' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='SS')]
      WHEN 'P4' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='SCI'), (SELECT id FROM academy_subjects WHERE code='SS')]
      WHEN 'P5' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='SCI'), (SELECT id FROM academy_subjects WHERE code='SS')]
      WHEN 'P6' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='SCI'), (SELECT id FROM academy_subjects WHERE code='SS')]
      WHEN 'JSS1' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='SCI'), (SELECT id FROM academy_subjects WHERE code='SS')]
      WHEN 'JSS2' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='SCI'), (SELECT id FROM academy_subjects WHERE code='SS')]
      WHEN 'JSS3' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='SCI'), (SELECT id FROM academy_subjects WHERE code='SS')]
      WHEN 'SSS1' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='BIO'), (SELECT id FROM academy_subjects WHERE code='PHY'), (SELECT id FROM academy_subjects WHERE code='CHM')]
      WHEN 'SSS2' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='BIO'), (SELECT id FROM academy_subjects WHERE code='PHY'), (SELECT id FROM academy_subjects WHERE code='CHM')]
      WHEN 'SSS3' THEN ARRAY[(SELECT id FROM academy_subjects WHERE code='ENG'), (SELECT id FROM academy_subjects WHERE code='MTH'), (SELECT id FROM academy_subjects WHERE code='BIO'), (SELECT id FROM academy_subjects WHERE code='PHY'), (SELECT id FROM academy_subjects WHERE code='CHM')]
    END::UUID[],
    '[]'::JSONB,
    CASE ac.code
      WHEN 'P1' THEN 40
      WHEN 'P2' THEN 40
      WHEN 'P4' THEN 75
      WHEN 'P5' THEN 90
      WHEN 'P6' THEN 100
      WHEN 'JSS1' THEN 105
      WHEN 'JSS2' THEN 120
      WHEN 'JSS3' THEN 150
      WHEN 'SSS1' THEN 150
      WHEN 'SSS2' THEN 180
      WHEN 'SSS3' THEN 210
    END,
    CASE ac.code
      WHEN 'P1' THEN 2400
      WHEN 'P2' THEN 2400
      WHEN 'P4' THEN 4500
      WHEN 'P5' THEN 5400
      WHEN 'P6' THEN 6000
      WHEN 'JSS1' THEN 6300
      WHEN 'JSS2' THEN 7200
      WHEN 'JSS3' THEN 9000
      WHEN 'SSS1' THEN 9000
      WHEN 'SSS2' THEN 10800
      WHEN 'SSS3' THEN 12600
    END,
    '{"easy":{"count":0,"percentage":0.2},"medium":{"count":0,"percentage":0.5},"hard":{"count":0,"percentage":0.3}}'::JSONB,
    'approved'
  FROM academy_classes ac
  WHERE ac.code IN ('P1','P2','P4','P5','P6','JSS1','JSS2','JSS3','SSS1','SSS2','SSS3')
    AND ac.version_id = v_version_id
  ON CONFLICT DO NOTHING;

  -- Insert practice drills. INSERT..SELECT joined to the class spine (scoped to
  -- v_version_id) instead of bare VALUES: rows whose class is missing drop out
  -- instead of violating NOT NULL class_id, and the subject lookup is scoped to
  -- the drill's own class so it can never return more than one row (subject
  -- codes repeat across classes — an unscoped scalar subquery would error).
  INSERT INTO academy_mock_exam_templates
    (version_id, class_id, name, description, exam_type, subject_ids, sections, total_questions, total_seconds, difficulty_distribution, status)
  SELECT
    v_version_id,
    c.id,
    d.name,
    d.description,
    'practice_drill',
    ARRAY[(SELECT s.id FROM academy_subjects s WHERE s.class_id = c.id AND s.code = d.subject_code LIMIT 1)],
    '[]'::JSONB,
    d.total_questions,
    d.total_seconds,
    d.dist::JSONB,
    'approved'
  FROM (VALUES
    ('SSS1', 'MTH', 'Algebra Fundamentals Practice Drill', 'Focused practice on algebra concepts and problem-solving', 22, 2400, '{"easy":{"count":6,"percentage":0.27},"medium":{"count":10,"percentage":0.45},"hard":{"count":6,"percentage":0.27}}'),
    ('SSS1', 'ENG', 'Sentence Structure Practice Drill', 'Grammar and sentence construction focus', 22, 2400, '{"easy":{"count":7,"percentage":0.32},"medium":{"count":9,"percentage":0.41},"hard":{"count":6,"percentage":0.27}}'),
    ('P5',   'MTH', 'Fractions Practice Drill', 'Comprehensive fractions and decimal operations', 24, 2400, '{"easy":{"count":7,"percentage":0.29},"medium":{"count":10,"percentage":0.42},"hard":{"count":7,"percentage":0.29}}'),
    ('JSS1', 'ENG', 'Comprehension Mastery Drill', 'Reading comprehension and inference practice', 22, 2400, '{"easy":{"count":7,"percentage":0.32},"medium":{"count":8,"percentage":0.36},"hard":{"count":7,"percentage":0.32}}'),
    ('SSS1', 'BIO', 'Photosynthesis Practice Drill', 'Plant physiology and photosynthesis mastery', 22, 2400, '{"easy":{"count":7,"percentage":0.32},"medium":{"count":9,"percentage":0.41},"hard":{"count":6,"percentage":0.27}}'),
    ('JSS2', 'SCI', 'States of Matter Practice Drill', 'Matter properties and phase transitions', 24, 2400, '{"easy":{"count":7,"percentage":0.29},"medium":{"count":10,"percentage":0.42},"hard":{"count":7,"percentage":0.29}}'),
    ('JSS1', 'SS',  'History Foundations Practice Drill', 'Historical knowledge and timeline understanding', 22, 2400, '{"easy":{"count":7,"percentage":0.32},"medium":{"count":9,"percentage":0.41},"hard":{"count":6,"percentage":0.27}}')
  ) AS d(class_code, subject_code, name, description, total_questions, total_seconds, dist)
  JOIN academy_classes c ON c.code = d.class_code AND c.version_id = v_version_id
  ON CONFLICT DO NOTHING;

END $$;

COMMIT;
