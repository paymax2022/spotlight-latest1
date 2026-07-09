-- Spotlight Academy (K-12 EdTech) — Phase 0 + Phase 1 core schema.
-- Additive-only. Curriculum/exam/rewards config are VERSIONED DATA, never code.
-- Reuses Paymax rails: auth.users (identity), wallet ledger (rewards credit),
-- points, kyc/tiers, audit_logs, scheduler. No parallel auth/ledger here.
BEGIN;

-- ───────────────────────── Identity-bridge (single identity, additive roles) ──
CREATE TABLE IF NOT EXISTS public.academy_roles (
  user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role       text NOT NULL CHECK (role IN ('learner','parent','tutor','staff')),
  granted_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, role)
);

CREATE TABLE IF NOT EXISTS public.academy_consent_records (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  minor_user_id    uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  guardian_user_id uuid NOT NULL REFERENCES auth.users(id),
  scope            jsonb NOT NULL DEFAULT '{}'::jsonb, -- purchases|community|data_sharing
  actor_user_id    uuid,
  granted_at       timestamptz NOT NULL DEFAULT now()  -- immutable
);
CREATE INDEX IF NOT EXISTS idx_academy_consent_minor ON public.academy_consent_records(minor_user_id);

CREATE TABLE IF NOT EXISTS public.academy_guardian_links (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guardian_user_id  uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  minor_user_id     uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  consent_record_id uuid REFERENCES public.academy_consent_records(id),
  status            text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (guardian_user_id, minor_user_id)
);
CREATE INDEX IF NOT EXISTS idx_academy_guardian_minor ON public.academy_guardian_links(minor_user_id);

CREATE TABLE IF NOT EXISTS public.academy_profiles (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role         text NOT NULL CHECK (role IN ('learner','parent','tutor')),
  class_id     uuid,           -- academy_classes (learner)
  stream       text,           -- Science|Humanities|Commercial (SSS)
  trade_track  text,           -- trade code (JSS+)
  school       text,
  display_name text,
  avatar_url   text,
  entry_year   int,            -- for curriculum-version binding
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, role)
);

-- ───────────────────────── Curriculum (versioned data) ───────────────────────
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

CREATE TABLE IF NOT EXISTS public.academy_streams (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,   -- Science|Humanities|Commercial
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.academy_trade_tracks (
  id   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,   -- solar_pv|fashion_garment|...
  name text NOT NULL,
  status text NOT NULL DEFAULT 'active'
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

-- ───────────────────────── Content (lite for Phase 1) ────────────────────────
-- NOTE: named academy_edu_lessons (not academy_lessons) to avoid colliding with the
-- pre-existing film/vocational academy_lessons table (20260408110000) which has a
-- different schema (module_id, no objective_id). Additive, no rename of legacy table.
CREATE TABLE IF NOT EXISTS public.academy_edu_lessons (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  objective_id uuid REFERENCES public.academy_learning_objectives(id),
  title        text NOT NULL,
  type         text NOT NULL DEFAULT 'video' CHECK (type IN ('video','interactive','reading')),
  version_id   uuid REFERENCES public.academy_curriculum_versions(id),
  media_ref    text,
  transcript   text,
  duration_s   int NOT NULL DEFAULT 0,
  status       text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','live','archived')),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_lessons_objective ON public.academy_edu_lessons(objective_id);

CREATE TABLE IF NOT EXISTS public.academy_content_bundles (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name                text NOT NULL,
  version_id          uuid REFERENCES public.academy_curriculum_versions(id),
  arena_code          text,
  size_budget_bytes   bigint NOT NULL DEFAULT 0,
  lesson_ids          uuid[] NOT NULL DEFAULT '{}',
  access_card_mapping  text,
  status              text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','review','approved','live','archived')),
  manifest            jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now()
);

-- ───────────────────────── Assessment & exam ─────────────────────────────────
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

CREATE TABLE IF NOT EXISTS public.academy_past_questions (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  question_item_id uuid NOT NULL REFERENCES public.academy_question_items(id),
  exam_code        text NOT NULL,
  year             int NOT NULL
);

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

CREATE TABLE IF NOT EXISTS public.academy_subject_combination_rules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  arena_id          uuid NOT NULL REFERENCES public.academy_exam_arenas(id),
  course            text NOT NULL,
  required_subjects text[] NOT NULL DEFAULT '{}',
  guidance          text
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

CREATE TABLE IF NOT EXISTS public.academy_responses (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attempt_id       uuid NOT NULL REFERENCES public.academy_attempts(id) ON DELETE CASCADE,
  question_item_id uuid NOT NULL REFERENCES public.academy_question_items(id),
  selected         jsonb NOT NULL DEFAULT '{}'::jsonb,
  correct          boolean,
  time_ms          int NOT NULL DEFAULT 0,
  flagged          boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()  -- immutable once attempt submitted
);
CREATE INDEX IF NOT EXISTS idx_academy_responses_attempt ON public.academy_responses(attempt_id);

CREATE TABLE IF NOT EXISTS public.academy_mastery_records (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  objective_id uuid NOT NULL REFERENCES public.academy_learning_objectives(id),
  state        text NOT NULL DEFAULT 'not_started'
                 CHECK (state IN ('not_started','in_progress','practiced','mastered','exam_ready')),
  score        numeric NOT NULL DEFAULT 0,
  history      jsonb NOT NULL DEFAULT '[]'::jsonb,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, objective_id)
);

CREATE TABLE IF NOT EXISTS public.academy_progress_events (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  type         text NOT NULL,
  objective_id uuid,
  payload      jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_progress_user ON public.academy_progress_events(user_id, created_at);

COMMIT;
