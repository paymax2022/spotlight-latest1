-- ── Film Academy: question bank, review, and server-scored exams ─────────────
-- Brownfield, additive-only. Nothing here drops, renames or narrows an existing
-- column, and every new column is nullable with a safe default, so the K-12
-- Spotlight Academy engine (academy_question_items / academy_attempts) and every
-- existing Film Academy reader keep working untouched.
--
-- WHAT THIS UNLOCKS (PRD slice BK-06/07 + BK-10):
--   1. A REVIEW QUEUE. The supplied 256 MCQs are DRAFT — SME review. They land in
--      the SHARED academy_question_items bank tagged for the film academy, but
--      status stays 'draft' so importing NEVER makes a question exam-eligible.
--      academy_question_reviews records who reviewed what and why (reviewer
--      separation + the audit ledger §7.3).
--   2. SERVER-AUTHORITATIVE ATTEMPTS. academy_exam_attempts already existed but was
--      thin (no timer, no idempotency, no immutable draw). We add a server
--      deadline, an immutable item snapshot, an attempt lifecycle and an idempotency
--      key — the §7.5 attempt contract. academy_exam_attempt_responses is the
--      per-item autosave store, one current answer per presented item.
--   3. EXAM DRAWS FROM THE APPROVED BANK. academy_exams gains a kind + what to draw
--      (stage / modules). Questions are only ever drawn at the same status the
--      reviewer approved.
--
-- The answer key (academy_question_items.answer jsonb) NEVER leaves the bank table.
-- Learner DTOs are built in the service layer from the snapshot + options only;
-- this migration adds no view that exposes answer to anon/authenticated.

-- ─── 1. Tag the shared question bank for the film academy ────────────────────
ALTER TABLE academy_question_items
    ADD COLUMN IF NOT EXISTS external_code       text,
    ADD COLUMN IF NOT EXISTS academy_scope       text,
    ADD COLUMN IF NOT EXISTS film_stage          text,
    ADD COLUMN IF NOT EXISTS film_module_code    text,
    ADD COLUMN IF NOT EXISTS film_department     text,
    ADD COLUMN IF NOT EXISTS film_learning_outcome text,
    ADD COLUMN IF NOT EXISTS film_cognitive      text,
    ADD COLUMN IF NOT EXISTS film_difficulty     text,
    ADD COLUMN IF NOT EXISTS film_keywords       text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS film_points         numeric NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS source_version      text,
    ADD COLUMN IF NOT EXISTS film_source_hash    text,
    ADD COLUMN IF NOT EXISTS import_batch_id     uuid;

COMMENT ON COLUMN academy_question_items.film_source_hash IS
    'Content fingerprint of the imported row; a repeat import whose hash is unchanged is a no-op, and an approved item is never mutated in place.';

COMMENT ON COLUMN academy_question_items.external_code IS
    'Stable importer key (e.g. TMFA-L1-01-01). Idempotent-import anchor; unique within the film academy.';
COMMENT ON COLUMN academy_question_items.academy_scope IS
    '''film'' for Film Academy items; NULL for the K-12 NERDC items this table already holds. Scoping so the two curricula never draw each other''s questions.';

-- external_code identifies the logical question; it must be unique where present.
CREATE UNIQUE INDEX IF NOT EXISTS academy_qitems_external_code_uniq
    ON academy_question_items (external_code)
    WHERE external_code IS NOT NULL;

-- Fast, correct draws: approved film items by stage (+ optional module).
CREATE INDEX IF NOT EXISTS academy_qitems_film_draw_idx
    ON academy_question_items (academy_scope, film_stage, status)
    WHERE academy_scope = 'film';

-- ─── 2. Import batches — idempotent, reconcilable, with row diagnostics ──────
CREATE TABLE IF NOT EXISTS academy_question_import_batches (
    id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    filename       text NOT NULL,
    source_sha256  text,
    total_rows     integer NOT NULL DEFAULT 0,
    accepted       integer NOT NULL DEFAULT 0,
    updated        integer NOT NULL DEFAULT 0,
    rejected       integer NOT NULL DEFAULT 0,
    warned         integer NOT NULL DEFAULT 0,
    -- Row-by-row {accepted:[], rejected:[{row,code,message}], warned:[]} diagnostics.
    report         jsonb NOT NULL DEFAULT '{}'::jsonb,
    committed      boolean NOT NULL DEFAULT false,
    created_by     uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    created_at     timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE academy_question_import_batches IS
    'One CSV import run. A repeated identical import is a no-op (external_code dedupe); a preview that is not committed stores nothing to the bank.';

-- Guarded so a re-apply is a no-op (ADD CONSTRAINT has no IF NOT EXISTS).
DO $$ BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'academy_qitems_import_batch_fk'
                   AND conrelid = 'public.academy_question_items'::regclass) THEN
        ALTER TABLE academy_question_items
            ADD CONSTRAINT academy_qitems_import_batch_fk
            FOREIGN KEY (import_batch_id) REFERENCES academy_question_import_batches(id) ON DELETE SET NULL;
    END IF;
END $$;

-- ─── 3. Question reviews — reviewer separation + immutable audit (§7.3) ──────
CREATE TABLE IF NOT EXISTS academy_question_reviews (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    question_item_id  uuid NOT NULL REFERENCES academy_question_items(id) ON DELETE CASCADE,
    reviewer_id       uuid REFERENCES auth.users(id) ON DELETE SET NULL,
    -- approve | reject | suspend | reactivate
    decision          text NOT NULL CHECK (decision IN ('approve','reject','suspend','reactivate')),
    note              text NOT NULL DEFAULT '',
    from_status       text,
    to_status         text,
    created_at        timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS academy_qreviews_item_idx
    ON academy_question_reviews (question_item_id, created_at DESC);

-- ─── 4. Exams draw from the approved bank; a kind distinguishes the assessment ─
ALTER TABLE academy_exams
    ADD COLUMN IF NOT EXISTS kind              text NOT NULL DEFAULT 'stage_exam'
        CHECK (kind IN ('practice','checkpoint','stage_exam')),
    ADD COLUMN IF NOT EXISTS draw_stage        text,
    ADD COLUMN IF NOT EXISTS draw_module_codes text[] NOT NULL DEFAULT '{}',
    ADD COLUMN IF NOT EXISTS draw_count        integer NOT NULL DEFAULT 10
        CHECK (draw_count > 0 AND draw_count <= 200);

COMMENT ON COLUMN academy_exams.draw_count IS
    'How many APPROVED bank items a started attempt draws. Publishing preflights that the pool covers this count.';

COMMENT ON COLUMN academy_exams.draw_stage IS
    'Film stage (L1..L5) whose APPROVED items this exam draws from. Set by the examiner; publishing preflights the pool.';
COMMENT ON COLUMN academy_exams.draw_module_codes IS
    'Optional module-code restriction (FM01..FM32). Empty = every module for the stage.';

-- ─── 5. Attempt lifecycle, server timer, immutable draw snapshot ─────────────
ALTER TABLE academy_exam_attempts
    -- 'graded' is the state of every legacy (pre-film) attempt and the default the
    -- legacy submit path relies on; it must be allowed or the ADD COLUMN aborts on
    -- any DB with existing attempts and every legacy submit fails the CHECK.
    ADD COLUMN IF NOT EXISTS attempt_state   text NOT NULL DEFAULT 'graded'
        CHECK (attempt_state IN ('graded','in_progress','submitted','scored','expired')),
    ADD COLUMN IF NOT EXISTS server_deadline timestamptz,
    ADD COLUMN IF NOT EXISTS item_snapshot   jsonb NOT NULL DEFAULT '[]',
    ADD COLUMN IF NOT EXISTS idempotency_key text;

COMMENT ON COLUMN academy_exam_attempts.attempt_state IS
    'Lifecycle for the new server-authoritative flow. The legacy status enum stays for backward compatibility; only graded rows carry a final score.';
COMMENT ON COLUMN academy_exam_attempts.item_snapshot IS
    'Immutable presentation snapshot: [{attemptQuestionId, questionItemId, stem, options:[{id,text}], points, order}]. Option order may be shuffled per attempt; the answer key is NEVER copied into it.';

-- Idempotency is meaningful only WITHIN one learner's start of one exam, and the
-- key is learner-supplied, so it MUST be scoped: a globally-unique key would let
-- learner B's resume lookup (keyed on a value B controls) collide with — and read
-- back — learner A's live attempt. Scoped uniqueness both closes that cross-tenant
-- leak and stops one learner's random key from shadowing another's start.
CREATE UNIQUE INDEX IF NOT EXISTS academy_exam_attempts_idem_uniq
    ON academy_exam_attempts (enrollment_id, exam_id, idempotency_key)
    WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS academy_exam_attempts_enrollment_idx
    ON academy_exam_attempts (enrollment_id, exam_id, attempt_state);

-- One current response per presented item within an attempt (§7.5).
CREATE TABLE IF NOT EXISTS academy_exam_attempt_responses (
    id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    attempt_id        uuid NOT NULL REFERENCES academy_exam_attempts(id) ON DELETE CASCADE,
    question_item_id  uuid NOT NULL REFERENCES academy_question_items(id) ON DELETE CASCADE,
    selected_option_id text,
    save_revision     integer NOT NULL DEFAULT 1,
    saved_at          timestamptz NOT NULL DEFAULT now(),
    UNIQUE (attempt_id, question_item_id)
);

CREATE INDEX IF NOT EXISTS academy_exam_attempt_responses_attempt_idx
    ON academy_exam_attempt_responses (attempt_id);

-- ─── 6. RLS — private rows are backend-only (service-role), never anon-readable ─
-- The learner routes read/write these with the service-role client and do their
-- own enrolment scoping (resolveLearner), so direct anon/auth access is denied and
-- a crafted PostgREST query cannot read another learner's attempt or the review
-- ledger. There are no admin policies either: admin reads go through the server.
ALTER TABLE academy_question_import_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_question_reviews         ENABLE ROW LEVEL SECURITY;
ALTER TABLE academy_exam_attempt_responses   ENABLE ROW LEVEL SECURITY;

-- ─── PostgREST lockdown (ADR-PR858 pattern) ──────────────────────────────────
-- Every reader and writer of these tables is server-side (the Next.js routes use
-- the service-role admin client; the Go backend uses the pool), so the PostgREST
-- roles get nothing:
--  * academy_question_items carries the answer key (`answer`). Its pre-existing
--    USING (true) read policy let anon read every key, including drafts.
--  * the three new tables are admin/server data. No is_admin() policies: is_admin()
--    reads user_profiles.role, which users can write themselves.
REVOKE ALL ON TABLE academy_question_items          FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE academy_question_import_batches FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE academy_question_reviews        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON TABLE academy_exam_attempt_responses  FROM PUBLIC, anon, authenticated;
GRANT  ALL ON TABLE academy_question_items          TO service_role;
GRANT  ALL ON TABLE academy_question_import_batches TO service_role;
GRANT  ALL ON TABLE academy_question_reviews        TO service_role;
GRANT  ALL ON TABLE academy_exam_attempt_responses  TO service_role;
