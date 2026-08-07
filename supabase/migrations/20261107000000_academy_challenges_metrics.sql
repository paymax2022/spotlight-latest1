-- Add metric + window to the seeded challenges so per-user progress can be
-- computed (GET /gamification/challenges). The challenge engine counts the
-- learner's matching activity in the window and compares to criteria.target:
--   metric 'practice' → any practice submission (academy_progress_events)
--   metric 'mastered' → objective-mastered events
--   metric 'exam'     → scored exam attempts (academy_attempts)
--   window 'day'|'week'
--
-- Data-only enrichment via jsonb concat (adds keys, drops nothing) — idempotent,
-- additive.
UPDATE public.academy_challenges
   SET criteria = criteria || '{"metric":"practice","window":"day"}'::jsonb
 WHERE code IN ('DAILY-PRACTICE-3', 'DAILY-STREAK');

UPDATE public.academy_challenges
   SET criteria = criteria || '{"metric":"mastered","window":"week"}'::jsonb
 WHERE code = 'WEEKLY-MASTER-1';

UPDATE public.academy_challenges
   SET criteria = criteria || '{"metric":"exam","window":"week"}'::jsonb
 WHERE code = 'WEEKLY-EXAM-1';
