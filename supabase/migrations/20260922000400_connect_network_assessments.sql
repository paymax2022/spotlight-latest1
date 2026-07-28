-- Paymax Connect — Phase 6F Skill Assessments (SA-01…04, ADM-SA-01).
-- Ref: docs/connect/PAYMAX-CONNECT-PHASE6-PROFESSIONAL-NETWORK.md §3/§4/§6.7,
--      invariants PN-5 (badge only after a passed, timestamped attempt tied to a
--      specific schema version) and PN-12 (a badge PERMANENTLY records which
--      question-bank version was passed; new question versions never retro-change it).
--
-- REUSE, DON'T FORK: a SkillAssessment is a thin wrapper over the Naija Driver
-- quiz engine (backend/internal/arena/quiz + 20260921000000_arena_quiz_bank.sql).
-- Each assessment maps (domain,title,pass_threshold) → a quiz bank identified by
-- (bank_key, rubric_version). Questions + attempts live in the EXISTING
-- arena_quiz_question / arena_quiz_attempt tables (append-only, idempotent). This
-- migration only adds the Connect-side catalogue + the append-only badge ledger,
-- and seeds two example template banks + assessments into the reused quiz tables.
--
-- ADDITIVE-ONLY: CREATE ... IF NOT EXISTS, idempotent seeds (ON CONFLICT DO
-- NOTHING). NO DROP TABLE/COLUMN/TYPE, NO RENAME, NO type narrowing. `DROP POLICY
-- IF EXISTS` is used only to (re)create RLS policies idempotently. Safe to re-run.
-- Reuses helpers from prior migrations: public.is_admin().

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ════════════════════════════════════════════════════════════════════════════
-- (a) connect_skill_assessments — the Connect catalogue. A row maps a skill
--     (domain,title,pass_threshold) onto a reused quiz bank (bank_key,
--     rubric_version). rubric_version IS the versioned question bank: a NEW
--     version is a NEW row (new rubric_version), never an edit of an old one, so
--     previously issued badges keep their original meaning (PN-12).
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_skill_assessments (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain         text NOT NULL,                 -- e.g. 'golang', 'javascript'
  title          text NOT NULL,
  bank_key       text NOT NULL,                 -- arena_quiz_question.bank_key
  rubric_version text NOT NULL,                 -- arena_quiz_question.rubric_version (the version)
  pass_threshold int  NOT NULL DEFAULT 70 CHECK (pass_threshold BETWEEN 1 AND 100),
  active         boolean NOT NULL DEFAULT true,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (domain, rubric_version)               -- admin upsert conflict target (versioned CRUD)
);
CREATE INDEX IF NOT EXISTS idx_connect_skill_assessments_active
  ON public.connect_skill_assessments (active, domain);

-- ════════════════════════════════════════════════════════════════════════════
-- (b) connect_skill_badges — APPEND-ONLY skill credential ledger. A badge is
--     issued ONLY after a passed, timestamped attempt (PN-5), and PERMANENTLY
--     records the exact assessment_version it was earned against (PN-12). The
--     composite UNIQUE makes the badge idempotent + once-per-version: the loyalty
--     skill_verified event is emitted only on the row's first insert (per
--     assessment, not per attempt). Immutable via connect_block_mutation trigger.
-- ════════════════════════════════════════════════════════════════════════════
CREATE TABLE IF NOT EXISTS public.connect_skill_badges (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL,
  assessment_id      uuid NOT NULL REFERENCES public.connect_skill_assessments(id) ON DELETE CASCADE,
  assessment_version text NOT NULL,             -- frozen at issue-time (PN-12)
  score              int  NOT NULL,
  passed_at          timestamptz NOT NULL DEFAULT now(),
  idempotency_key    text NOT NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, assessment_id, assessment_version)   -- append-only, once per version
);
CREATE INDEX IF NOT EXISTS idx_connect_skill_badges_user
  ON public.connect_skill_badges (user_id);
CREATE INDEX IF NOT EXISTS idx_connect_skill_badges_assessment
  ON public.connect_skill_badges (assessment_id);

-- ── Immutability: badges are append-only (corrections = new rows, never UPDATE) ──
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'connect_block_mutation') THEN
    CREATE OR REPLACE FUNCTION public.connect_block_mutation() RETURNS trigger AS $fn$
    BEGIN
      RAISE EXCEPTION 'append-only table %: UPDATE/DELETE forbidden', TG_TABLE_NAME;
    END;
    $fn$ LANGUAGE plpgsql;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'connect_skill_badges_immutable') THEN
    CREATE TRIGGER connect_skill_badges_immutable
      BEFORE UPDATE OR DELETE ON public.connect_skill_badges
      FOR EACH ROW EXECUTE FUNCTION public.connect_block_mutation();
  END IF;
END $$;

-- ════════════════════════════════════════════════════════════════════════════
-- Row Level Security — deny-by-default; service_role bypass on every table.
-- The scoring/badge path writes via the service-role backend (pgxpool).
-- ════════════════════════════════════════════════════════════════════════════
ALTER TABLE public.connect_skill_assessments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.connect_skill_badges      ENABLE ROW LEVEL SECURITY;

-- assessments: any authenticated member reads ACTIVE rows; admins read all;
-- writes are service-only (admin catalogue mgmt goes through the service role).
DROP POLICY IF EXISTS connect_assessments_read ON public.connect_skill_assessments;
CREATE POLICY connect_assessments_read ON public.connect_skill_assessments
  FOR SELECT TO authenticated
  USING (active OR public.is_admin());
DROP POLICY IF EXISTS connect_assessments_service ON public.connect_skill_assessments;
CREATE POLICY connect_assessments_service ON public.connect_skill_assessments
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- badges: owner reads own; admin reads all; writes service-only (append-only).
DROP POLICY IF EXISTS connect_badges_own ON public.connect_skill_badges;
CREATE POLICY connect_badges_own ON public.connect_skill_badges
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR public.is_admin());
DROP POLICY IF EXISTS connect_badges_service ON public.connect_skill_badges;
CREATE POLICY connect_badges_service ON public.connect_skill_badges
  TO service_role USING (TRUE) WITH CHECK (TRUE);

-- ════════════════════════════════════════════════════════════════════════════
-- (c) RBAC — ADM-SA-01 question-bank / catalogue management is AssessmentReviewer
--     only. Mirrors the connect_rbac / arena_quiz_bank seed shape.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.permissions (name, slug, module, resource, action, description, is_system_permission)
VALUES
  ('Review Skill Assessments', 'connect.assessment.review', 'connect', 'assessment', 'review',
   'Manage the Connect skill-assessment catalogue + question banks (ADM-SA-01)', true)
ON CONFLICT (slug) DO NOTHING;

-- Grant to platform admin roles (whichever exist).
WITH role_row AS (SELECT id FROM public.roles WHERE slug IN ('super-admin','super_admin','system-admin','system_admin')),
     perms AS (SELECT id FROM public.permissions WHERE slug = 'connect.assessment.review')
INSERT INTO public.role_permissions (role_id, permission_id)
SELECT role_row.id, perms.id FROM role_row, perms
ON CONFLICT (role_id, permission_id) DO NOTHING;

-- ════════════════════════════════════════════════════════════════════════════
-- (d) SEED — two example TEMPLATE quiz banks (competition_id NULL) into the reused
--     arena_quiz_question table, plus their Connect assessment rows. Single-stage
--     (stage 1) skill quizzes. pass_mark_percent mirrors the assessment threshold
--     for consistency (the badge decision uses connect_skill_assessments.pass_threshold).
--     Idempotent: ON CONFLICT (bank_key, rubric_version, external_id) [template] DO NOTHING.
-- ════════════════════════════════════════════════════════════════════════════
INSERT INTO public.arena_quiz_question
  (competition_id, bank_key, rubric_version, external_id, stage, category, prompt, options, correct_index, correct_answer, explanation, time_limit_seconds, pass_mark_percent)
VALUES
-- ── Bank: skill_golang / skill_golang_v1 ─────────────────────────────────────
(NULL, 'skill_golang', 'skill_golang_v1', 'GO-Q01', 1, 'concurrency', 'Which keyword starts a new goroutine?', '["thread", "async", "go", "spawn"]'::jsonb, 2, 'go', 'The go keyword launches a function call as a concurrently-executing goroutine.', 120, 70),
(NULL, 'skill_golang', 'skill_golang_v1', 'GO-Q02', 1, 'types', 'What is the zero value of a Go string?', '["nil", "\"\" (empty string)", "0", "undefined"]'::jsonb, 1, '"" (empty string)', 'Uninitialised strings are the empty string, not nil; strings are value types.', 120, 70),
(NULL, 'skill_golang', 'skill_golang_v1', 'GO-Q03', 1, 'errors', 'Idiomatic Go error handling returns:', '["exceptions via panic/recover", "an error as the last return value", "a global errno", "HTTP status codes"]'::jsonb, 1, 'an error as the last return value', 'Functions conventionally return an error as the final value, checked with if err != nil.', 120, 70),
(NULL, 'skill_golang', 'skill_golang_v1', 'GO-Q04', 1, 'concurrency', 'A channel receive on a closed channel returns:', '["a panic", "blocks forever", "the zero value with ok=false", "a runtime deadlock"]'::jsonb, 2, 'the zero value with ok=false', 'Receiving from a closed channel yields the element type''s zero value and ok=false.', 120, 70),
(NULL, 'skill_golang', 'skill_golang_v1', 'GO-Q05', 1, 'tooling', 'Which command formats Go source to the canonical style?', '["go lint", "go fmt", "go vet", "go tidy"]'::jsonb, 1, 'go fmt', 'gofmt (invoked via go fmt) rewrites source into the single canonical formatting.', 120, 70),
(NULL, 'skill_golang', 'skill_golang_v1', 'GO-Q06', 1, 'types', 'A nil slice appended to with append(s, x):', '["panics", "returns a new one-element slice", "is a compile error", "must be made with make() first"]'::jsonb, 1, 'returns a new one-element slice', 'append handles a nil slice as an empty slice, allocating a backing array as needed.', 120, 70),
-- ── Bank: skill_javascript / skill_javascript_v1 ─────────────────────────────
(NULL, 'skill_javascript', 'skill_javascript_v1', 'JS-Q01', 1, 'types', 'typeof null evaluates to:', '["\"null\"", "\"object\"", "\"undefined\"", "\"number\""]'::jsonb, 1, '"object"', 'A long-standing quirk: typeof null is "object" despite null being a primitive.', 120, 70),
(NULL, 'skill_javascript', 'skill_javascript_v1', 'JS-Q02', 1, 'scope', 'let and const are scoped to:', '["the nearest function", "the whole file", "the enclosing block", "global only"]'::jsonb, 2, 'the enclosing block', 'Unlike var (function-scoped), let/const are block-scoped and are not hoisted for use.', 120, 70),
(NULL, 'skill_javascript', 'skill_javascript_v1', 'JS-Q03', 1, 'equality', '0 == "" evaluates to:', '["true", "false", "throws", "NaN"]'::jsonb, 0, 'true', 'Loose == coerces both to 0, so the comparison is true; === would be false.', 120, 70),
(NULL, 'skill_javascript', 'skill_javascript_v1', 'JS-Q04', 1, 'async', 'An async function always returns:', '["the awaited value directly", "a Promise", "undefined", "a callback"]'::jsonb, 1, 'a Promise', 'async functions wrap their return value in a resolved Promise (or a rejected one on throw).', 120, 70),
(NULL, 'skill_javascript', 'skill_javascript_v1', 'JS-Q05', 1, 'arrays', 'Array.prototype.map returns:', '["the original array mutated", "a new array of the same length", "undefined", "the first matching element"]'::jsonb, 1, 'a new array of the same length', 'map is non-mutating: it produces a new array by applying the callback to each element.', 120, 70)
ON CONFLICT (bank_key, rubric_version, external_id) WHERE competition_id IS NULL DO NOTHING;

-- Connect catalogue rows pointing at the seeded banks.
INSERT INTO public.connect_skill_assessments (domain, title, bank_key, rubric_version, pass_threshold, active)
VALUES
  ('golang',     'Go (Golang) Fundamentals',      'skill_golang',     'skill_golang_v1',     70, true),
  ('javascript', 'JavaScript Fundamentals',       'skill_javascript', 'skill_javascript_v1', 70, true)
ON CONFLICT (domain, rubric_version) DO NOTHING;

COMMIT;
