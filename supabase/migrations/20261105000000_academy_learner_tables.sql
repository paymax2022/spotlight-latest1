-- Learner personal-data tables for the /learner backend (bookmarks + notes).
--
-- The mobile learner surface (GET/POST/DELETE /learner/bookmarks, /learner/notes)
-- had no backend, so bookmarks/notes lived only in device memory and were lost on
-- reload. These additive tables give them server persistence keyed to the Paymax
-- user. Search and daily-goal are computed from existing tables (curriculum,
-- progress_events, gamification) and need no storage.
--
-- Additive-only: CREATE ... IF NOT EXISTS, no drops/renames/narrowing.

CREATE TABLE IF NOT EXISTS public.academy_learner_bookmarks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  kind         text NOT NULL DEFAULT 'lesson' CHECK (kind IN ('lesson','topic','past_question')),
  title        text NOT NULL,
  subject_name text NOT NULL DEFAULT '',
  href         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  -- Dedupe by canonical href per user (mirrors the mobile upsertBookmark), so
  -- re-bookmarking the same lesson is idempotent.
  UNIQUE (user_id, href)
);

CREATE TABLE IF NOT EXISTS public.academy_learner_notes (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL,
  lesson_id    text NOT NULL,
  lesson_title text NOT NULL DEFAULT '',
  subject_name text NOT NULL DEFAULT '',
  body         text NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_academy_learner_bookmarks_user
  ON public.academy_learner_bookmarks (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_academy_learner_notes_user
  ON public.academy_learner_notes (user_id, created_at DESC);
