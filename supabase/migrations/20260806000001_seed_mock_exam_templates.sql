-- Seed Mock Exam Templates
-- Generated from 150-agent swarm execution
--
-- The academy spine (curriculum versions / classes / subjects) is seeded by Go
-- backend startup, NOT by migrations — on a fresh replay these tables are empty
-- and this seed is intentionally a no-op. It seeds templates only when an
-- active curriculum version with classes already exists (i.e. a live DB).

BEGIN;

DO $$
DECLARE
  v_version_id UUID;
BEGIN
  -- Pick the newest active curriculum version that actually has classes.
  SELECT c.version_id INTO v_version_id
  FROM academy_classes c
  JOIN academy_curriculum_versions v ON v.id = c.version_id
  WHERE v.status = 'active'
  ORDER BY v.effective_date DESC NULLS LAST
  LIMIT 1;

  IF v_version_id IS NULL THEN
    RAISE NOTICE 'academy spine not seeded yet; skipping mock exam template seed';
    RETURN;
  END IF;

  -- Insert class-wide mock exams
  INSERT INTO academy_mock_exam_templates
    (version_id, class_id, name, description, exam_type, subject_ids, sections, total_questions, total_seconds, difficulty_distribution, status)
  SELECT
    v_version_id,
    ac.id,
    d.name,
    d.description,
    'class_mock',
    ARRAY(SELECT s.id FROM academy_subjects s
          WHERE s.class_id = ac.id AND s.code = ANY (d.subject_codes)
          ORDER BY array_position(d.subject_codes, s.code)),
    '[]'::JSONB,
    d.total_questions,
    d.total_seconds,
    '{"easy":{"count":0,"percentage":0.2},"medium":{"count":0,"percentage":0.5},"hard":{"count":0,"percentage":0.3}}'::JSONB,
    'approved'
  FROM (VALUES
    ('P1',   'P1 Comprehensive Mock Exam Template',                'Primary 1 full mock examination covering English, Mathematics, and Social Studies', ARRAY['ENG','MTH','SS'],                  40, 2400),
    ('P2',   'P2 Comprehensive Mock Examination',                  'Primary 2 full mock examination',                                                   ARRAY['ENG','MTH','SS'],                  40, 2400),
    ('P4',   'P4 Upper Primary Comprehensive Mock Examination',    'Upper Primary assessment covering all core subjects',                               ARRAY['ENG','MTH','SCI','SS'],            75, 4500),
    ('P5',   'P5 Comprehensive Mock Examination',                  'Primary 5 summative assessment',                                                    ARRAY['ENG','MTH','SCI','SS'],            90, 5400),
    ('P6',   'P6 Upper Primary Final Assessment',                  'Primary 6 comprehensive final examination',                                         ARRAY['ENG','MTH','SCI','SS'],           100, 6000),
    ('JSS1', 'JSS1 Comprehensive Mock Examination',                'Junior Secondary School 1 full examination',                                        ARRAY['ENG','MTH','SCI','SS'],           105, 6300),
    ('JSS2', 'JSS2 Comprehensive Mock Examination',                'Junior Secondary School 2 terminal examination',                                    ARRAY['ENG','MTH','SCI','SS'],           120, 7200),
    ('JSS3', 'JSS3 Comprehensive Mock Examination',                'Junior Secondary School 3 comprehensive assessment',                                ARRAY['ENG','MTH','SCI','SS'],           150, 9000),
    ('SSS1', 'SSS1 Comprehensive Mock Examination',                'Senior Secondary School 1 full examination',                                        ARRAY['ENG','MTH','BIO','PHY','CHM'],    150, 9000),
    ('SSS2', 'SSS2 Mock Examination',                              'Senior Secondary School 2 examination',                                             ARRAY['ENG','MTH','BIO','PHY','CHM'],    180, 10800),
    ('SSS3', 'SSS3 Comprehensive Mock Examination',                'Senior Secondary School 3 comprehensive final examination',                         ARRAY['ENG','MTH','BIO','PHY','CHM'],    210, 12600)
  ) AS d(class_code, name, description, subject_codes, total_questions, total_seconds)
  JOIN academy_classes ac
    ON ac.code = d.class_code AND ac.version_id = v_version_id
  WHERE NOT EXISTS (
    SELECT 1 FROM academy_mock_exam_templates t
    WHERE t.class_id = ac.id AND t.name = d.name
  );

  -- Insert practice drills
  INSERT INTO academy_mock_exam_templates
    (version_id, class_id, name, description, exam_type, subject_ids, sections, total_questions, total_seconds, difficulty_distribution, status)
  SELECT
    v_version_id,
    ac.id,
    d.name,
    d.description,
    'practice_drill',
    ARRAY(SELECT s.id FROM academy_subjects s
          WHERE s.class_id = ac.id AND s.code = d.subject_code),
    '[]'::JSONB,
    d.total_questions,
    d.total_seconds,
    d.difficulty_distribution::JSONB,
    'approved'
  FROM (VALUES
    ('SSS1', 'MTH', 'Algebra Fundamentals Practice Drill', 'Focused practice on algebra concepts and problem-solving', 22, 2400, '{"easy":{"count":6,"percentage":0.27},"medium":{"count":10,"percentage":0.45},"hard":{"count":6,"percentage":0.27}}'),
    ('SSS1', 'ENG', 'Sentence Structure Practice Drill',   'Grammar and sentence construction focus',                  22, 2400, '{"easy":{"count":7,"percentage":0.32},"medium":{"count":9,"percentage":0.41},"hard":{"count":6,"percentage":0.27}}'),
    ('P5',   'MTH', 'Fractions Practice Drill',            'Comprehensive fractions and decimal operations',           24, 2400, '{"easy":{"count":7,"percentage":0.29},"medium":{"count":10,"percentage":0.42},"hard":{"count":7,"percentage":0.29}}'),
    ('JSS1', 'ENG', 'Comprehension Mastery Drill',         'Reading comprehension and inference practice',             22, 2400, '{"easy":{"count":7,"percentage":0.32},"medium":{"count":8,"percentage":0.36},"hard":{"count":7,"percentage":0.32}}'),
    ('SSS1', 'BIO', 'Photosynthesis Practice Drill',       'Plant physiology and photosynthesis mastery',              22, 2400, '{"easy":{"count":7,"percentage":0.32},"medium":{"count":9,"percentage":0.41},"hard":{"count":6,"percentage":0.27}}'),
    ('JSS2', 'SCI', 'States of Matter Practice Drill',     'Matter properties and phase transitions',                  24, 2400, '{"easy":{"count":7,"percentage":0.29},"medium":{"count":10,"percentage":0.42},"hard":{"count":7,"percentage":0.29}}'),
    ('JSS1', 'SS',  'History Foundations Practice Drill',  'Historical knowledge and timeline understanding',          22, 2400, '{"easy":{"count":7,"percentage":0.32},"medium":{"count":9,"percentage":0.41},"hard":{"count":6,"percentage":0.27}}')
  ) AS d(class_code, subject_code, name, description, total_questions, total_seconds, difficulty_distribution)
  JOIN academy_classes ac
    ON ac.code = d.class_code AND ac.version_id = v_version_id
  WHERE NOT EXISTS (
    SELECT 1 FROM academy_mock_exam_templates t
    WHERE t.class_id = ac.id AND t.name = d.name
  );

END $$;

COMMIT;
