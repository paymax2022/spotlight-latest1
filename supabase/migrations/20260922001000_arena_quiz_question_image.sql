-- 20260922001000_arena_quiz_question_image.sql
-- Additive: give arena quiz questions an optional illustration image (e.g. a road
-- sign) shown alongside the prompt to aid understanding. Contestant-safe — the
-- image accompanies the QUESTION, not the answer, so it is included in the
-- answer-stripped QuestionView. No DROP / rename / type-narrow.
BEGIN;

ALTER TABLE public.arena_quiz_question
  ADD COLUMN IF NOT EXISTS image_url text;

COMMIT;
