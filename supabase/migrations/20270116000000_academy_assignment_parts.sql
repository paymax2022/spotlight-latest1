-- ── Film Academy: multi-part assignments on a weekly timeline ────────────────
-- Additive-only. Adds two things the assignments flow could not express:
--
--   1. A TIMELINE. An assignment had a single due_date and nothing that said
--      which week of the programme it belonged to, so neither the learner's
--      screen nor the console could group work by week.
--   2. SUBMISSION IN PARTS. academy_assignment_submissions is UNIQUE on
--      (assignment_id, enrollment_id) — exactly one row per learner per
--      assignment — so a brief delivered over four weeks had to arrive as a
--      single upload at the end, and a learner who sent week 1 then sent week 2
--      OVERWROTE their own week 1.
--
-- The design: an assignment MAY be split into parts, each part scheduled in a
-- week and submitted separately. Assignments with NO parts keep behaving exactly
-- as before (one whole-assignment submission), so nothing existing changes —
-- the 26 assignments already in the table stay valid and untouched.
--
-- Grading stays per-part; the assignment-level score in
-- academy_assignment_submissions remains the single-submission path. A part's
-- max_score is optional: when null the part is pass/fail progress only, which is
-- the common case for a weekly checkpoint.

-- ─── 1. Which week an assignment sits in ────────────────────────────────────
-- Nullable: existing assignments have no week and are simply "unscheduled",
-- which is what they are today. Not defaulted to 1, because claiming 26 existing
-- rows belong to week 1 would be inventing a timeline nobody set.
ALTER TABLE academy_assignments
    ADD COLUMN IF NOT EXISTS week_number integer;

ALTER TABLE academy_assignments
    DROP CONSTRAINT IF EXISTS academy_assignments_week_number_check;
ALTER TABLE academy_assignments
    ADD CONSTRAINT academy_assignments_week_number_check
    CHECK (week_number IS NULL OR week_number >= 1);

COMMENT ON COLUMN academy_assignments.week_number IS
    'Programme week this assignment belongs to (1-based). NULL = unscheduled. When the assignment has parts, each part carries its own week and this is the week the brief opens.';

-- ─── 2. The parts of an assignment (the weekly timeline) ────────────────────
CREATE TABLE IF NOT EXISTS academy_assignment_parts (
    id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id uuid NOT NULL REFERENCES academy_assignments(id) ON DELETE CASCADE,
    -- Ordering within the assignment. Part 1, 2, 3, 4…
    part_number   integer NOT NULL CHECK (part_number >= 1),
    -- The programme week this part is due in — "week 1-4" in the brief.
    week_number   integer NOT NULL CHECK (week_number >= 1),
    title         text NOT NULL,
    description   text NOT NULL DEFAULT '',
    due_date      timestamptz,
    -- NULL = this part is progress only, not separately scored. A weekly
    -- checkpoint usually is.
    max_score     integer CHECK (max_score IS NULL OR max_score > 0),
    -- An optional part still shows on the timeline but never blocks completion.
    is_required   boolean NOT NULL DEFAULT true,
    created_at    timestamptz NOT NULL DEFAULT now(),
    updated_at    timestamptz NOT NULL DEFAULT now()
);

-- Two parts cannot share a slot in the same assignment, or the learner's
-- timeline would have an ambiguous order.
CREATE UNIQUE INDEX IF NOT EXISTS academy_assignment_parts_number_uniq
    ON academy_assignment_parts (assignment_id, part_number);

CREATE INDEX IF NOT EXISTS academy_assignment_parts_assignment_idx
    ON academy_assignment_parts (assignment_id, week_number, part_number);

COMMENT ON TABLE academy_assignment_parts IS
    'Optional breakdown of an assignment into separately-submitted parts, each scheduled in a programme week. An assignment with no parts is submitted whole, as before.';

-- ─── 3. One submission per learner per part ─────────────────────────────────
-- Mirrors academy_assignment_submissions column-for-column so the grading code
-- and the console read the same shape for both paths.
CREATE TABLE IF NOT EXISTS academy_assignment_part_submissions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    part_id         uuid NOT NULL REFERENCES academy_assignment_parts(id) ON DELETE CASCADE,
    enrollment_id   uuid NOT NULL REFERENCES academy_enrollments(id) ON DELETE CASCADE,
    submission_link text,
    submission_text text,
    submitted_at    timestamptz NOT NULL DEFAULT now(),
    score           numeric(6,2),
    grade           text,
    feedback        text,
    reviewed_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    reviewed_at     timestamptz,
    status          text NOT NULL DEFAULT 'submitted'
);

-- The re-submission contract: one row per learner per part, upserted. Without
-- this a resubmission would append a second row and the grade would become
-- ambiguous — which is the bug the assignment-level table already avoids with
-- the same constraint.
CREATE UNIQUE INDEX IF NOT EXISTS academy_assignment_part_submissions_uniq
    ON academy_assignment_part_submissions (part_id, enrollment_id);

CREATE INDEX IF NOT EXISTS academy_assignment_part_submissions_enrollment_idx
    ON academy_assignment_part_submissions (enrollment_id);

COMMENT ON TABLE academy_assignment_part_submissions IS
    'A learner''s submission for one part of a multi-part assignment. Unique on (part_id, enrollment_id) so a resubmission replaces rather than duplicates.';

-- ─── 4. RLS, matching the tables these hang off ─────────────────────────────
-- academy_assignments and academy_assignment_submissions are admin-managed with
-- is_admin() policies; the learner paths go through the service-role client in
-- the Next.js routes, which bypasses RLS and does its own enrolment scoping
-- (resolveLearner). Enabling RLS with an admin policy keeps a direct anon/auth
-- client from reading another learner's work.
ALTER TABLE academy_assignment_parts ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_assignment_part_submissions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS admin_manage_academy_assignment_parts ON academy_assignment_parts;
CREATE POLICY admin_manage_academy_assignment_parts
    ON academy_assignment_parts
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

DROP POLICY IF EXISTS admin_manage_academy_part_submissions ON academy_assignment_part_submissions;
CREATE POLICY admin_manage_academy_part_submissions
    ON academy_assignment_part_submissions
    TO authenticated
    USING (is_admin())
    WITH CHECK (is_admin());

-- A learner may read their OWN part submissions through a normal client.
DROP POLICY IF EXISTS learner_reads_own_part_submissions ON academy_assignment_part_submissions;
CREATE POLICY learner_reads_own_part_submissions
    ON academy_assignment_part_submissions
    FOR SELECT
    TO authenticated
    USING (
        enrollment_id IN (
            SELECT e.id FROM academy_enrollments e
            JOIN academy_applications a ON a.id = e.application_id
            WHERE a.user_id = auth.uid()
        )
    );

-- Parts themselves are not secret: they are the brief. Any authenticated user
-- enrolled anywhere may read them; the routes still scope by curriculum.
DROP POLICY IF EXISTS authenticated_reads_assignment_parts ON academy_assignment_parts;
CREATE POLICY authenticated_reads_assignment_parts
    ON academy_assignment_parts
    FOR SELECT
    TO authenticated
    USING (true);
