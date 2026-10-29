-- ── Film Academy: practical assessment workflow ─────────────────────────────
-- Additive-only. The practical was previously administered outside the app and
-- recorded by an administrator as a hold. This migration gives it a first-class,
-- auditable record without changing any existing table's meaning:
--
--   1. film_practical_assessments — one assessment per topic: brief, rubric,
--      pass mark, attempt limit and activation state. Inactive rows are drafts
--      and never gate a learner.
--   2. film_practical_submissions — a learner's draft, submitted work and the
--      immutable rubric snapshot the reviewer grades. Evidence is a written
--      submission and/or an https media URL; no file bytes are stored here, so
--      no storage-bucket policy is implied.
--   3. Hold provenance — source/source_ref let the workflow open and clear its
--      own PRACTICAL_PENDING / PRACTICAL_FAILED holds without touching manual
--      holds. Existing rows default to 'manual'.
--
-- Mastery is still written only by the existing server paths: a passing quiz
-- caps at PASSED while an automatic practical hold is open, and grading a pass
-- clears that hold. Nothing in this file approves content, awards mastery or
-- issues a credential.

-- ─── 1. Assessment definition ───────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.film_practical_assessments (
    id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    topic_id                text NOT NULL UNIQUE
                            REFERENCES public.film_topics(topic_id) ON DELETE CASCADE,
    title                   text NOT NULL,
    brief_markdown          text NOT NULL DEFAULT '',
    submission_instructions text NOT NULL DEFAULT '',
    -- Array of { id, label, description, maxPoints }. Validated by the service;
    -- the SQL check only guarantees it is an array so a bad write fails loudly.
    rubric                  jsonb NOT NULL DEFAULT '[]'::jsonb
                            CHECK (jsonb_typeof(rubric) = 'array'),
    pass_percent            integer NOT NULL DEFAULT 85
                            CHECK (pass_percent >= 85 AND pass_percent <= 100),
    max_attempts            integer NOT NULL DEFAULT 3
                            CHECK (max_attempts >= 1 AND max_attempts <= 10),
    active                  boolean NOT NULL DEFAULT false,
    created_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    updated_by              uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at              timestamptz NOT NULL DEFAULT now(),
    updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS film_practical_assessments_active_idx
    ON public.film_practical_assessments (active, topic_id);

COMMENT ON TABLE public.film_practical_assessments IS
    'One practical per topic. active=false is a draft that cannot receive submissions and does not gate mastery.';

-- ─── 2. Learner submissions ─────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.film_practical_submissions (
    id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assessment_id    uuid NOT NULL
                     REFERENCES public.film_practical_assessments(id) ON DELETE RESTRICT,
    enrollment_id    uuid NOT NULL
                     REFERENCES public.academy_enrollments(id) ON DELETE CASCADE,
    user_id          uuid NOT NULL,
    topic_id         text NOT NULL
                     REFERENCES public.film_topics(topic_id) ON DELETE CASCADE,
    attempt_number   integer NOT NULL DEFAULT 1,
    status           text NOT NULL DEFAULT 'draft'
                     CHECK (status IN ('draft','submitted','graded')),
    submission_text  text NOT NULL DEFAULT '',
    media_url        text NOT NULL DEFAULT '',
    media_note       text NOT NULL DEFAULT '',
    -- Captured from the assessment when the learner submits, so a later rubric
    -- edit cannot retroactively change what a reviewer grades.
    rubric_snapshot  jsonb NOT NULL DEFAULT '[]'::jsonb
                     CHECK (jsonb_typeof(rubric_snapshot) = 'array'),
    pass_threshold   integer NOT NULL DEFAULT 85
                     CHECK (pass_threshold >= 85 AND pass_threshold <= 100),
    submitted_at     timestamptz,
    graded_by        uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    graded_at        timestamptz,
    earned_points    integer,
    possible_points  integer,
    percentage       numeric(6,2),
    passed           boolean,
    -- Array of { criterionId, points, comment }. Kept beside the snapshot so a
    -- historical grade stays readable even if the rubric is later revised.
    rubric_scores    jsonb NOT NULL DEFAULT '[]'::jsonb
                     CHECK (jsonb_typeof(rubric_scores) = 'array'),
    feedback         text NOT NULL DEFAULT '',
    created_at       timestamptz NOT NULL DEFAULT now(),
    updated_at       timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT film_practical_submissions_points_check CHECK (
        (earned_points IS NULL AND possible_points IS NULL) OR
        (earned_points >= 0 AND possible_points > 0 AND earned_points <= possible_points)
    ),
    CONSTRAINT film_practical_submissions_grade_state_check CHECK (
        (status = 'graded' AND graded_at IS NOT NULL AND passed IS NOT NULL
         AND earned_points IS NOT NULL AND possible_points IS NOT NULL)
        OR (status <> 'graded')
    )
);

-- One editable draft per learner per topic; a retake creates a new attempt row.
CREATE UNIQUE INDEX IF NOT EXISTS film_practical_submissions_one_draft
    ON public.film_practical_submissions (enrollment_id, topic_id)
    WHERE status = 'draft';
CREATE UNIQUE INDEX IF NOT EXISTS film_practical_submissions_attempt_uniq
    ON public.film_practical_submissions (enrollment_id, topic_id, attempt_number);
CREATE INDEX IF NOT EXISTS film_practical_submissions_review_idx
    ON public.film_practical_submissions (status, submitted_at);
CREATE INDEX IF NOT EXISTS film_practical_submissions_enrollment_idx
    ON public.film_practical_submissions (enrollment_id, topic_id, created_at DESC);

COMMENT ON TABLE public.film_practical_submissions IS
    'Learner practical work. The rubric snapshot and pass threshold are frozen at submit; grading is the only writer of points and outcome.';

-- ─── 3. Hold provenance for the automatic practical gate ────────────────────
-- Existing manual holds keep the defaults; no row is rewritten.
ALTER TABLE public.film_mastery_holds
    ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual',
    ADD COLUMN IF NOT EXISTS source_ref text NOT NULL DEFAULT '';

CREATE INDEX IF NOT EXISTS film_mastery_holds_source_idx
    ON public.film_mastery_holds (source, source_ref, status);

-- At most one open hold per learner/topic may be owned by the practical
-- workflow. The service updates it between PENDING and FAILED rather than
-- stacking holds, so clearing it restores mastery exactly once.
CREATE UNIQUE INDEX IF NOT EXISTS film_mastery_holds_auto_practical_uniq
    ON public.film_mastery_holds (enrollment_id, topic_id)
    WHERE status = 'open' AND source = 'practical_assessment';

COMMENT ON COLUMN public.film_mastery_holds.source IS
    'manual (administrator-created) or practical_assessment (opened/cleared by the practical workflow).';

-- ─── 4. RLS: private rows are service-role only ─────────────────────────────
ALTER TABLE public.film_practical_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.film_practical_submissions ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.film_practical_assessments FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE public.film_practical_submissions FROM PUBLIC, anon, authenticated;

GRANT ALL ON TABLE public.film_practical_assessments TO service_role;
GRANT ALL ON TABLE public.film_practical_submissions TO service_role;
