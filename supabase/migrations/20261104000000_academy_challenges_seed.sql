-- Seed a starter set of engagement challenges into public.academy_challenges.
--
-- GET /gamification/challenges (member) returns active challenges but the table
-- was empty, so the challenges surface was blank. These give the learner a few
-- real daily/weekly goals to see. criteria carries the display fields the mobile
-- reads (target, reward_points, description); per-user progress tracking is a
-- follow-up (the read reports progress 0 until then).
--
-- Idempotent (NOT EXISTS on code), additive-only. kind honours the CHECK
-- (daily|weekly|sponsor); status 'active' so ListChallenges serves them.
INSERT INTO public.academy_challenges (code, name, kind, criteria, status)
SELECT x.code, x.name, x.kind, x.criteria::jsonb, 'active'
FROM (VALUES
  ('DAILY-PRACTICE-3', 'Daily practice',   'daily',
   '{"target":3,"reward_points":50,"description":"Complete 3 practice sets today."}'),
  ('DAILY-STREAK',     'Keep your streak', 'daily',
   '{"target":1,"reward_points":20,"description":"Practise once today to extend your streak."}'),
  ('WEEKLY-MASTER-1',  'Master an objective', 'weekly',
   '{"target":1,"reward_points":150,"description":"Reach the mastered state on any objective this week."}'),
  ('WEEKLY-EXAM-1',    'Sit a mock exam',  'weekly',
   '{"target":1,"reward_points":200,"description":"Complete a full CBT mock exam this week."}')
) AS x(code, name, kind, criteria)
WHERE NOT EXISTS (
  SELECT 1 FROM public.academy_challenges c WHERE c.code = x.code
);
