-- ── Film Academy: topic curriculum, 85% mastery gates and media production ───
-- Brownfield, additive-only. Extends the existing film-academy assessment plane
-- (academy_question_items / academy_exam_attempts) rather than replacing it.
--
-- WHAT THIS ADDS
--   1. A versioned course → topic hierarchy that can hold the TMFA curriculum
--      import (13 courses / 72 stable topic IDs), separate from the pre-existing
--      academy_modules → academy_lessons pathway.
--   2. Topic-level attempts with an immutable draw snapshot, a server deadline
--      and scoped idempotency. The answer key still lives only in
--      academy_question_items.answer.
--   3. A mastery ledger. Only the server writes it, and only after the exact
--      integer rule earned_points * 100 >= possible_points * 85 passes.
--   4. Holds (practical / safety / review) that block progression independently
--      of the quiz score.
--   5. The 864 planned media records with production, rights and accessibility
--      state, so a topic cannot publish on an unreviewed/absent teaching asset
--      unless an explicit accessible text equivalent is signed off.
--   6. An append-only learner event stream for near-real-time grade delivery and
--      multi-device reconciliation, plus an academic audit ledger.
--
-- Existing readers (frontend-web assessment slice, K-12 Go engine) are untouched:
-- every new column is nullable or defaulted, and film topic quizzes are a separate
-- table pair from academy_exam_attempts.

-- ─── 1. Curriculum version + courses + topics ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.film_curriculum_versions (
    id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    version      text NOT NULL UNIQUE,
    status       text NOT NULL DEFAULT 'draft'
                 CHECK (status IN ('draft','review','approved','retired')),
    source_hash  text,
    course_count integer NOT NULL DEFAULT 0,
    topic_count  integer NOT NULL DEFAULT 0,
    approved_by  uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    approved_at  timestamptz,
    created_by   uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.film_courses (
    course_id      text PRIMARY KEY,
    title          text NOT NULL,
    kind           text NOT NULL DEFAULT 'craft'
                   CHECK (kind IN ('acting','craft')),
    stage_label    text NOT NULL DEFAULT '',
    stage_default  text,
    summary        text NOT NULL DEFAULT '',
    order_index    integer NOT NULL DEFAULT 0,
    status         text NOT NULL DEFAULT 'draft'
                   CHECK (status IN ('draft','review','approved','retired')),
    version_id     uuid REFERENCES public.film_curriculum_versions(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now(),
    updated_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.film_courses IS
    'TMFA stable course IDs (ACT, C01..C12). Distinct from academy_programs/academy_modules, which remain the legacy pathway.';

CREATE TABLE IF NOT EXISTS public.film_topics (
    topic_id        text PRIMARY KEY,
    course_id       text NOT NULL REFERENCES public.film_courses(course_id) ON DELETE RESTRICT,
    stage           text NOT NULL DEFAULT 'L1'
                    CHECK (stage IN ('L0','L1','L2','L3','L4','L5')),
    stage_label     text NOT NULL DEFAULT '',
    title           text NOT NULL,
    lesson_markdown text NOT NULL DEFAULT '',
    content_status  text NOT NULL DEFAULT 'draft'
                    CHECK (content_status IN ('draft','review','approved','retired')),
    quiz_minimum_percent integer NOT NULL DEFAULT 85
                    CHECK (quiz_minimum_percent >= 85 AND quiz_minimum_percent <= 100),
    quiz_draw_count integer NOT NULL DEFAULT 10
                    CHECK (quiz_draw_count >= 1 AND quiz_draw_count <= 50),
    quiz_time_limit_minutes integer NOT NULL DEFAULT 20
                    CHECK (quiz_time_limit_minutes >= 1 AND quiz_time_limit_minutes <= 180),
    media_status    text NOT NULL DEFAULT '',
    learning_outcomes jsonb NOT NULL DEFAULT '[]'::jsonb,
    required_media  text[] NOT NULL DEFAULT '{}',
    prerequisites   text[] NOT NULL DEFAULT '{}',
    order_index     integer NOT NULL DEFAULT 0,
    published       boolean NOT NULL DEFAULT false,
    published_at    timestamptz,
    published_by    uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    -- When true, a reviewed article is accepted as the accessible equivalent of
    -- the not-yet-produced mandatory video/audio assets. Requires a written
    -- rationale in accessible_equivalent_note, recorded by the approver.
    accessible_equivalent_approved boolean NOT NULL DEFAULT false,
    accessible_equivalent_note     text NOT NULL DEFAULT '',
    source_hash     text,
    version_id      uuid REFERENCES public.film_curriculum_versions(id) ON DELETE SET NULL,
    created_at      timestamptz NOT NULL DEFAULT now(),
    updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_topics_course_order_idx
    ON public.film_topics (course_id, order_index);
CREATE INDEX IF NOT EXISTS film_topics_published_idx
    ON public.film_topics (published, stage);

COMMENT ON COLUMN public.film_topics.prerequisites IS
    'Stable topic IDs that must be MASTERED before this topic becomes AVAILABLE. Imported as the previous topic in the same course unless an approved curriculum says otherwise.';
COMMENT ON COLUMN public.film_topics.published IS
    'Publication is a server-evaluated gate: approved article, >=20 approved quiz items, cleared holds and either published mandatory media or a signed accessible text equivalent.';

-- ─── 2. Media production queue (864 planned assets) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.film_topic_media (
    asset_id       text PRIMARY KEY,
    topic_id       text NOT NULL REFERENCES public.film_topics(topic_id) ON DELETE CASCADE,
    course_id      text NOT NULL DEFAULT '',
    media_type     text NOT NULL,
    required       boolean NOT NULL DEFAULT true,
    language       text NOT NULL DEFAULT 'en-NG',
    status         text NOT NULL DEFAULT 'PLANNED',
    rights_status  text NOT NULL DEFAULT 'NOT_REVIEWED',
    accessibility_status text NOT NULL DEFAULT 'NOT_REVIEWED',
    production_state text NOT NULL DEFAULT 'PLANNED'
                   CHECK (production_state IN (
                     'PLANNED','SCRIPTED','CAPTURED','EDITED',
                     'ACCESSIBILITY_REVIEW','RIGHTS_REVIEW','ACADEMIC_APPROVED','PUBLISHED'
                   )),
    instructions   text NOT NULL DEFAULT '',
    owner          text NOT NULL DEFAULT '',
    source_version text NOT NULL DEFAULT '1.0',
    -- The produced file. A PLANNED/SCRIPTED record is not evidence a file
    -- exists; publication additionally requires this to be set for AV/image
    -- assets. Kept out of the manifest import because the manifest has no URLs.
    media_url      text NOT NULL DEFAULT '',
    thumbnail_url  text NOT NULL DEFAULT '',
    captions_url   text NOT NULL DEFAULT '',
    transcript     text NOT NULL DEFAULT '',
    alt_text       text NOT NULL DEFAULT '',
    expires_at     timestamptz,
    replacement_asset_id text,
    updated_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_topic_media_topic_idx
    ON public.film_topic_media (topic_id, required, media_type);
CREATE INDEX IF NOT EXISTS film_topic_media_state_idx
    ON public.film_topic_media (production_state, rights_status, accessibility_status);

COMMENT ON TABLE public.film_topic_media IS
    'Planned/commissioned teaching assets. A record existing is NOT evidence the media exists; production_state is the authoritative production truth.';

-- ─── 3. Topic quiz attempts (server-authoritative, at-most-once scoring) ─────
CREATE TABLE IF NOT EXISTS public.film_topic_attempts (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id   uuid NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL,
    topic_id        text NOT NULL REFERENCES public.film_topics(topic_id) ON DELETE RESTRICT,
    attempt_number  integer NOT NULL DEFAULT 1,
    attempt_state   text NOT NULL DEFAULT 'in_progress'
                    CHECK (attempt_state IN ('in_progress','scored','voided')),
    pass_threshold  integer NOT NULL DEFAULT 85
                    CHECK (pass_threshold >= 85 AND pass_threshold <= 100),
    item_snapshot   jsonb NOT NULL DEFAULT '[]'::jsonb,
    started_at      timestamptz NOT NULL DEFAULT now(),
    server_deadline timestamptz NOT NULL,
    submitted_at    timestamptz,
    earned_points   integer,
    max_points      integer,
    percentage      numeric(6,2),
    passed          boolean,
    -- Per-objective totals written at finalization, so remediation can point at
    -- the outcome the learner missed without re-reading answer keys later.
    objective_breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
    idempotency_key text NOT NULL,
    created_at      timestamptz NOT NULL DEFAULT now()
);

-- Scoped, not global: the key is learner-supplied, so global uniqueness would let
-- one learner's retry read another learner's attempt (same rule as ADR-061).
CREATE UNIQUE INDEX IF NOT EXISTS film_topic_attempts_idem_uniq
    ON public.film_topic_attempts (enrollment_id, topic_id, idempotency_key);
CREATE INDEX IF NOT EXISTS film_topic_attempts_enrollment_idx
    ON public.film_topic_attempts (enrollment_id, topic_id, attempt_state);

CREATE TABLE IF NOT EXISTS public.film_topic_attempt_responses (
    id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id         uuid NOT NULL REFERENCES public.film_topic_attempts(id) ON DELETE CASCADE,
    question_item_id   uuid NOT NULL REFERENCES public.academy_question_items(id) ON DELETE CASCADE,
    selected_option_id text,
    save_revision      integer NOT NULL DEFAULT 1,
    saved_at           timestamptz NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, question_item_id)
);

CREATE INDEX IF NOT EXISTS film_topic_attempt_responses_attempt_idx
    ON public.film_topic_attempt_responses (attempt_id);

-- ─── 4. Mastery ledger + independent holds ──────────────────────────────────
CREATE TABLE IF NOT EXISTS public.film_topic_mastery (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id   uuid NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
    user_id         uuid NOT NULL,
    topic_id        text NOT NULL REFERENCES public.film_topics(topic_id) ON DELETE CASCADE,
    state           text NOT NULL DEFAULT 'AVAILABLE'
                    CHECK (state IN (
                      'LOCKED','AVAILABLE','IN_PROGRESS','REMEDIATION_REQUIRED',
                      'PASSED','MASTERED','UNDER_REVIEW'
                    )),
    best_score      numeric(6,2),
    best_attempt_id uuid REFERENCES public.film_topic_attempts(id) ON DELETE SET NULL,
    -- The last attempt folded into this ledger row. Makes score reconciliation
    -- idempotent when a submit is retried after the network dropped.
    last_attempt_id uuid REFERENCES public.film_topic_attempts(id) ON DELETE SET NULL,
    attempts_count  integer NOT NULL DEFAULT 0,
    passed_at       timestamptz,
    mastered_at     timestamptz,
    last_attempt_at timestamptz,
    updated_at      timestamptz NOT NULL DEFAULT now(),
    UNIQUE (enrollment_id, topic_id)
);

CREATE INDEX IF NOT EXISTS film_topic_mastery_enrollment_idx
    ON public.film_topic_mastery (enrollment_id, state);

COMMENT ON TABLE public.film_topic_mastery IS
    'Server-only progression ledger. PASSED means the 85% quiz gate is met; MASTERED additionally requires no open practical/safety/review hold. Only the quiz finalizer and authorised hold actions write here.';

CREATE TABLE IF NOT EXISTS public.film_mastery_holds (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    enrollment_id  uuid NOT NULL REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
    topic_id       text NOT NULL REFERENCES public.film_topics(topic_id) ON DELETE CASCADE,
    hold_type      text NOT NULL
                   CHECK (hold_type IN (
                     'PRACTICAL_FAILED','PRACTICAL_PENDING','SAFETY','ATTENDANCE',
                     'CONTENT_INCOMPLETE','INSTRUCTOR_REVIEW','ADMIN_REVIEW'
                   )),
    reason         text NOT NULL,
    status         text NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open','cleared')),
    created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    cleared_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    cleared_at     timestamptz,
    clearance_note text NOT NULL DEFAULT '',
    created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_mastery_holds_open_idx
    ON public.film_mastery_holds (enrollment_id, topic_id, status);

-- ─── 5. Learner event stream + academic audit ───────────────────────────────
CREATE TABLE IF NOT EXISTS public.film_mastery_events (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    user_id       uuid NOT NULL,
    enrollment_id uuid REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
    topic_id      text,
    event_type    text NOT NULL,
    payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
    -- Optional caller-supplied idempotency token (e.g. event:attemptId). A
    -- replayed submit cannot append the same progression event twice.
    dedupe_key    text UNIQUE,
    created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_mastery_events_user_cursor_idx
    ON public.film_mastery_events (user_id, id);

COMMENT ON TABLE public.film_mastery_events IS
    'Append-only progression events. Clients poll by (user_id, id) cursor or reconnect after an SSE drop; the ledger remains the source of truth, never the event.';

CREATE TABLE IF NOT EXISTS public.film_academic_audit (
    id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    actor_id    uuid,
    actor_role  text NOT NULL DEFAULT '',
    action      text NOT NULL,
    target_type text NOT NULL,
    target_id   text NOT NULL DEFAULT '',
    before      jsonb NOT NULL DEFAULT '{}'::jsonb,
    after       jsonb NOT NULL DEFAULT '{}'::jsonb,
    reason      text NOT NULL DEFAULT '',
    request_id  text NOT NULL DEFAULT '',
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_academic_audit_target_idx
    ON public.film_academic_audit (target_type, target_id, created_at DESC);

-- ─── 6. Link the shared bank to stable topic/objective IDs ──────────────────
ALTER TABLE public.academy_question_items
    ADD COLUMN IF NOT EXISTS film_topic_id     text,
    ADD COLUMN IF NOT EXISTS film_objective_id text,
    ADD COLUMN IF NOT EXISTS film_review_notes text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS academy_qitems_film_topic_idx
    ON public.academy_question_items (academy_scope, film_topic_id, status)
    WHERE academy_scope = 'film';

COMMENT ON COLUMN public.academy_question_items.film_topic_id IS
    'Stable TMFA topic ID (A01..A24, C01T1..). Topic quizzes draw only APPROVED items for one topic ID.';

-- ─── 7. RLS: private rows are service-role only ─────────────────────────────
-- Every learner and admin read goes through a Next.js route that scopes by the
-- authenticated user/enrolment in code. Direct PostgREST access is denied so a
-- crafted query cannot read another learner's attempt, mastery or the answer key.
ALTER TABLE public.film_curriculum_versions      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_courses                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_topics                   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_topic_media              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_topic_attempts           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_topic_attempt_responses  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_topic_mastery            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_mastery_holds            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_mastery_events           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_academic_audit           ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.film_curriculum_versions     FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_courses                 FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_topics                  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_topic_media             FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_topic_attempts          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_topic_attempt_responses FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_topic_mastery           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_mastery_holds           FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_mastery_events          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_academic_audit          FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.film_curriculum_versions     TO service_role;
GRANT ALL ON TABLE public.film_courses                 TO service_role;
GRANT ALL ON TABLE public.film_topics                  TO service_role;
GRANT ALL ON TABLE public.film_topic_media             TO service_role;
GRANT ALL ON TABLE public.film_topic_attempts          TO service_role;
GRANT ALL ON TABLE public.film_topic_attempt_responses TO service_role;
GRANT ALL ON TABLE public.film_topic_mastery           TO service_role;
GRANT ALL ON TABLE public.film_mastery_holds           TO service_role;
GRANT ALL ON TABLE public.film_mastery_events          TO service_role;
GRANT ALL ON TABLE public.film_academic_audit          TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.film_mastery_events_id_seq TO service_role;
GRANT USAGE, SELECT ON SEQUENCE public.film_academic_audit_id_seq TO service_role;
