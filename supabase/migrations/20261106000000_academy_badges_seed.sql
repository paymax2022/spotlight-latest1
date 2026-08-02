-- Seed the badge catalogue into public.academy_badges.
--
-- The gamification badge engine (EvaluateBadges + GrantBadge, wired into the
-- practice/exam earn-path) was live but the catalogue was empty, so no badge
-- could ever be earned and the achievements surface was blank. These definitions
-- award automatically on the earn-path via their criteria:
--   min_xp / min_level / min_streak  → matched against the gamification profile
--   counter{name,min}                → matched against the counters the earn-path
--                                       passes (practices_completed, exams_completed,
--                                       objectives_mastered — increments, so min:1
--                                       fires on the first).
-- description rides in criteria (surfaced by the member read).
--
-- Idempotent (NOT EXISTS on code), additive-only.
INSERT INTO public.academy_badges (code, name, criteria, icon)
SELECT x.code, x.name, x.criteria::jsonb, x.icon
FROM (VALUES
  ('FIRST-STEPS', 'Getting Started',
   '{"min_xp":1,"description":"Earn your first XP."}', 'sparkles'),
  ('RISING-STAR', 'Rising Star',
   '{"min_level":2,"description":"Reach level 2."}', 'star'),
  ('ON-A-ROLL', 'On a Roll',
   '{"min_streak":3,"description":"Keep a 3-day study streak."}', 'flame'),
  ('FIRST-PRACTICE', 'First Practice',
   '{"counter":{"name":"practices_completed","min":1},"description":"Complete your first practice set."}', 'pencil'),
  ('FIRST-MASTERY', 'First Mastery',
   '{"counter":{"name":"objectives_mastered","min":1},"description":"Master your first objective."}', 'trophy'),
  ('EXAM-DEBUT', 'Exam Debut',
   '{"counter":{"name":"exams_completed","min":1},"description":"Complete your first mock exam."}', 'graduation-cap')
) AS x(code, name, criteria, icon)
WHERE NOT EXISTS (
  SELECT 1 FROM public.academy_badges b WHERE b.code = x.code
);
