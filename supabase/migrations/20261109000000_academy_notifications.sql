-- Learner notifications + program announcements backing the /notifications and
-- /announcements endpoints (previously 404 — no backend). Notifications are
-- generated on the earn-path (a row is written when a badge is granted);
-- announcements are admin/program broadcasts (seeded here). Additive-only.

CREATE TABLE IF NOT EXISTS public.academy_learner_notifications (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL,
  kind       text NOT NULL DEFAULT 'reward',
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  href       text,
  read       boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_academy_learner_notifications_user
  ON public.academy_learner_notifications (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.academy_announcements (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title      text NOT NULL,
  body       text NOT NULL DEFAULT '',
  kind       text NOT NULL DEFAULT 'program' CHECK (kind IN ('program','sponsor')),
  sponsor    text,
  pinned     boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Seed a couple of program announcements (idempotent on title).
INSERT INTO public.academy_announcements (title, body, kind, pinned)
SELECT x.title, x.body, 'program', x.pinned
FROM (VALUES
  ('Welcome to Spotlight Academy', 'Practise, take mock exams and climb your class leaderboard. Earn badges as you master each objective.', true),
  ('New CBT mock exams are live', 'Try the Numeracy & Grammar mock under Exams — timed, auto-graded, with your readiness score.', false)
) AS x(title, body, pinned)
WHERE NOT EXISTS (
  SELECT 1 FROM public.academy_announcements a WHERE a.title = x.title
);
