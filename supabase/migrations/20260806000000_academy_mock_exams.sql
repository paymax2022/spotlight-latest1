-- Academy Mock Exam Papers — Phase 2 (exam variant templates + instances)
-- Additive-only. Supports class-wide exams, subject-focused practices, and topic drills.
BEGIN;

-- ───────────────────────── Prerequisite spine (fresh-replay fix) ─────────────
-- This file carries an EARLIER timestamp than 20260815000800_academy_core.sql,
-- which defines the academy spine tables the FKs below reference. On a fresh
-- database replay (CI `supabase start`, local `db reset`) this file therefore
-- failed with `relation "public.academy_curriculum_versions" does not exist`,
-- aborting the whole migration chain.
--
-- Fix: duplicate the EXACT dependency-closure definitions from academy_core
-- here, all CREATE TABLE IF NOT EXISTS. Fresh replays create them now and
-- academy_core no-ops later; databases that already ran academy_core no-op
-- here. Shipped migrations are immutable in this repo, so the two copies
-- cannot drift. Keep byte-identical to 20260815000800 — do not edit either
-- copy independently.

CREATE TABLE IF NOT EXISTS public.academy_curriculum_versions (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code           text NOT NULL UNIQUE,           -- NERDC-2025 | LEGACY
  name           text NOT NULL,
  effective_date date,
  status         text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','retired'))
);

CREATE TABLE IF NOT EXISTS public.academy_classes (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id uuid NOT NULL REFERENCES public.academy_curriculum_versions(id),
  phase      text NOT NULL CHECK (phase IN ('ECCE','LowerPrimary','UpperPrimary','JSS','SSS')),
  code       text NOT NULL,    -- P1..P6,JSS1..JSS3,SSS1..SSS3
  name       text NOT NULL,
  ordinal    int NOT NULL DEFAULT 0,
  UNIQUE (version_id, code)
);

CREATE TABLE IF NOT EXISTS public.academy_subjects (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  version_id     uuid NOT NULL REFERENCES public.academy_curriculum_versions(id),
  class_id       uuid NOT NULL REFERENCES public.academy_classes(id),
  code           text NOT NULL,
  name           text NOT NULL,
  kind           text NOT NULL DEFAULT 'core' CHECK (kind IN ('core','elective','optional')),
  stream         text,         -- nullable; SSS electives by stream
  exam_relevance text[] NOT NULL DEFAULT '{}', -- arena codes
  UNIQUE (class_id, code)
);

CREATE TABLE IF NOT EXISTS public.academy_topics (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject_id uuid NOT NULL REFERENCES public.academy_subjects(id),
  code       text NOT NULL,
  title      text NOT NULL,
  ordinal    int NOT NULL DEFAULT 0,
  UNIQUE (subject_id, code)
);

CREATE TABLE IF NOT EXISTS public.academy_learning_objectives (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  topic_id  uuid NOT NULL REFERENCES public.academy_topics(id),
  code      text NOT NULL,
  title     text NOT NULL,
  exam_tags text[] NOT NULL DEFAULT '{}',
  ordinal   int NOT NULL DEFAULT 0,
  UNIQUE (topic_id, code)
);

CREATE TABLE IF NOT EXISTS public.academy_question_items (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  type           text NOT NULL DEFAULT 'mcq',
  stem           text NOT NULL,
  options        jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer         jsonb NOT NULL DEFAULT '{}'::jsonb,
  difficulty     numeric NOT NULL DEFAULT 0.5,
  discrimination numeric NOT NULL DEFAULT 0,
  objective_id   uuid REFERENCES public.academy_learning_objectives(id),
  subject_id     uuid REFERENCES public.academy_subjects(id),
  tags           text[] NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','retired')),
  created_by     uuid,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_qitems_subject ON public.academy_question_items(subject_id);
CREATE INDEX IF NOT EXISTS idx_academy_qitems_objective ON public.academy_question_items(objective_id);

CREATE TABLE IF NOT EXISTS public.academy_exam_arenas (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code          text NOT NULL UNIQUE CHECK (code IN ('CCE','BECE','WASSCE','NECO','UTME','NABTEB')),
  name          text NOT NULL,
  subject_set   text[] NOT NULL DEFAULT '{}',
  scoring_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  calendar      jsonb NOT NULL DEFAULT '{}'::jsonb,
  countdown_at  timestamptz,
  status        text NOT NULL DEFAULT 'active' CHECK (status IN ('draft','active','archived'))
);

CREATE TABLE IF NOT EXISTS public.academy_cbt_blueprints (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id     uuid NOT NULL REFERENCES public.academy_exam_arenas(id),
  name         text NOT NULL,
  variant      text NOT NULL DEFAULT 'full' CHECK (variant IN ('full','single','drill')),
  sections     jsonb NOT NULL DEFAULT '[]'::jsonb,
  total_items  int NOT NULL DEFAULT 0,
  total_seconds int NOT NULL DEFAULT 0,
  navigation   jsonb NOT NULL DEFAULT '{}'::jsonb,
  tools        jsonb NOT NULL DEFAULT '{}'::jsonb,
  shuffle      boolean NOT NULL DEFAULT true,
  pause_policy text NOT NULL DEFAULT 'none' CHECK (pause_policy IN ('none','allowed')),
  status       text NOT NULL DEFAULT 'active'
);

CREATE TABLE IF NOT EXISTS public.academy_attempts (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  blueprint_id    uuid NOT NULL REFERENCES public.academy_cbt_blueprints(id),
  arena_id        uuid REFERENCES public.academy_exam_arenas(id),
  state           text NOT NULL DEFAULT 'created'
                    CHECK (state IN ('created','started','paused','submitted','scored','reviewed')),
  started_at      timestamptz,
  server_deadline timestamptz,           -- server-authoritative timer
  paused_at       timestamptz,
  submitted_at    timestamptz,
  score           jsonb NOT NULL DEFAULT '{}'::jsonb,
  readiness       numeric,
  predicted       jsonb NOT NULL DEFAULT '{}'::jsonb,
  integrity       jsonb NOT NULL DEFAULT '{}'::jsonb,
  offline_origin  boolean NOT NULL DEFAULT false,
  idempotency_key text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_attempts_user ON public.academy_attempts(user_id, created_at);
CREATE UNIQUE INDEX IF NOT EXISTS uq_academy_attempts_idem ON public.academy_attempts(idempotency_key) WHERE idempotency_key IS NOT NULL;

-- ─────────────────────── End prerequisite spine (fresh-replay fix) ───────────

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
