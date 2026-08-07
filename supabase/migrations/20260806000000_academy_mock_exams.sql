-- Academy Mock Exam Papers — Phase 2 (exam variant templates + instances)
-- Additive-only. Supports class-wide exams, subject-focused practices, and topic drills.
BEGIN;

-- ───────────────────────── Mock Exam Templates ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_mock_exam_templates (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id                  uuid NOT NULL REFERENCES public.academy_curriculum_versions(id),
  class_id                    uuid NOT NULL REFERENCES public.academy_classes(id),
  name                        text NOT NULL,
  description                 text,
  exam_type                   text NOT NULL DEFAULT 'class_mock'
                                CHECK (exam_type IN ('class_mock','subject_mock','practice_drill')),
  subject_ids                 uuid[] NOT NULL DEFAULT '{}',
  sections                    jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_questions             int NOT NULL DEFAULT 0,
  total_seconds               int NOT NULL DEFAULT 0,
  difficulty_distribution     jsonb NOT NULL DEFAULT '{"easy":0.2,"medium":0.5,"hard":0.3}'::jsonb,
  recommended_audience        text[] DEFAULT '{}',
  created_by                  uuid,
  created_at                  timestamptz NOT NULL DEFAULT now(),
  status                      text NOT NULL DEFAULT 'draft'
                                CHECK (status IN ('draft','approved','archived')),
  tags                        text[] NOT NULL DEFAULT '{mock-exam}'
);
CREATE INDEX IF NOT EXISTS idx_academy_mock_templates_class ON public.academy_mock_exam_templates(class_id, status);
CREATE INDEX IF NOT EXISTS idx_academy_mock_templates_version ON public.academy_mock_exam_templates(version_id);

-- ───────────────────────── Mock Exam Instances ─────────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_mock_exam_instances (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id         uuid NOT NULL REFERENCES public.academy_mock_exam_templates(id),
  exam_code           text NOT NULL UNIQUE,  -- e.g., "SSS3-FULL-2025-01-MOD"
  variant             int NOT NULL DEFAULT 1,
  seed                int NOT NULL,          -- for reproducible shuffling
  marking_scheme      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_mock_instances_template ON public.academy_mock_exam_instances(template_id);

-- ───────────────────────── Mock Question Mappings ──────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_mock_question_mappings (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_id         uuid NOT NULL REFERENCES public.academy_mock_exam_instances(id) ON DELETE CASCADE,
  question_item_id    uuid NOT NULL REFERENCES public.academy_question_items(id),
  display_order       int NOT NULL,
  section             text NOT NULL DEFAULT 'A',  -- Section grouping (A, B, C, etc.)
  time_allocated_sec  int NOT NULL DEFAULT 180,   -- per question
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (instance_id, question_item_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_mock_qmaps_instance ON public.academy_mock_question_mappings(instance_id);
CREATE INDEX IF NOT EXISTS idx_academy_mock_qmaps_question ON public.academy_mock_question_mappings(question_item_id);

-- ───────────────────────── Mock Exam Attempts (extends academy_attempts) ────
-- Linking bridge: academy_attempts.blueprint_id can point to a mock-derived blueprint
-- OR we track mock-specific metadata here
CREATE TABLE IF NOT EXISTS public.academy_mock_attempt_metadata (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id      uuid NOT NULL UNIQUE REFERENCES public.academy_attempts(id) ON DELETE CASCADE,
  instance_id     uuid NOT NULL REFERENCES public.academy_mock_exam_instances(id),
  template_id     uuid NOT NULL REFERENCES public.academy_mock_exam_templates(id),
  performance     jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {score_raw, score_pct, grade, by_section: []}
  flagged_questions uuid[] DEFAULT '{}',
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_mock_metadata_attempt ON public.academy_mock_attempt_metadata(attempt_id);
CREATE INDEX IF NOT EXISTS idx_academy_mock_metadata_instance ON public.academy_mock_attempt_metadata(instance_id);

-- ───────────────────────── Mock Exam Statistics ──────────────────────────────
CREATE TABLE IF NOT EXISTS public.academy_mock_statistics (
  id                          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id                 uuid NOT NULL UNIQUE REFERENCES public.academy_mock_exam_templates(id),
  total_attempts              int NOT NULL DEFAULT 0,
  avg_score_pct               numeric,
  pass_rate_pct               numeric,
  median_time_sec             int,
  common_misconceptions       jsonb NOT NULL DEFAULT '[]'::jsonb,
  difficulty_calibration      jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {question_id: discrimination_idx}
  by_section                  jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {section: {avg_score, accuracy}}
  updated_at                  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_mock_stats_template ON public.academy_mock_statistics(template_id);

-- ───────────────────────── Learner Recommendations ──────────────────────────
-- Track which mocks are recommended for whom (by mastery, level, topic)
CREATE TABLE IF NOT EXISTS public.academy_mock_recommendations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  template_id     uuid NOT NULL REFERENCES public.academy_mock_exam_templates(id),
  reason          text NOT NULL DEFAULT 'topic_review',  -- topic_review|skill_building|readiness_check
  priority        int NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, template_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_mock_recs_user ON public.academy_mock_recommendations(user_id);

COMMIT;
