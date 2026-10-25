-- Film Academy: exam start/end windows, and curriculum for programmes that have none.
--
--
-- 1. academy_exams.opens_at / closes_at. An exam is only reachable while it is
--    published AND now() is inside [opens_at, closes_at). Both columns are
--    nullable (NULL = no bound on that side) so existing rows keep working; the
--    application requires both before it will publish an exam.
--
-- 2. A learner enrolled in a published programme that has no modules sees "No
--    lessons have been published yet" (staging data: "Screen Acting Foundations",
--    "Weekend Film Production Lab", "Accelerated Content Creator Bootcamp" are
--    published but empty). Each such programme gets its own copy of the default
--    Foundation curriculum — modules, lessons and the module checkpoint quizzes —
--    published. Copies use deterministic ids (md5 of programme + source id) so
--    the statement is idempotent and enrolments/progress keep pointing at the
--    programme they already have. A programme that already has modules is left
--    exactly as authored.
--
-- 3. Published exams that predate the window get one (now .. now + 1 year) so no
--    live exam is silently open-ended. Admins edit it per exam.
--
-- Additive only: no DROP, no rename, no type change.

ALTER TABLE public.academy_exams
  ADD COLUMN IF NOT EXISTS opens_at  timestamptz,
  ADD COLUMN IF NOT EXISTS closes_at timestamptz;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.academy_exams'::regclass AND conname = 'academy_exams_window_order'
  ) THEN
    ALTER TABLE public.academy_exams
      ADD CONSTRAINT academy_exams_window_order
      CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at);
  END IF;
END $$;

-- Modules: only for published, non-default programmes that have none yet.
INSERT INTO public.academy_modules (id, program_id, title, description, order_index, is_published)
SELECT md5(p.id::text || ':' || m.id::text)::uuid, p.id, m.title, m.description, m.order_index, true
FROM public.academy_programs p
JOIN public.academy_modules m
  ON m.program_id = (SELECT d.id FROM public.academy_programs d WHERE d.is_default LIMIT 1)
WHERE p.is_published
  AND NOT p.is_default
  AND NOT EXISTS (SELECT 1 FROM public.academy_modules x WHERE x.program_id = p.id
                  AND x.id <> md5(p.id::text || ':' || m.id::text)::uuid)
ON CONFLICT (id) DO NOTHING;

-- Lessons: for every module copied above (found by its deterministic id).
INSERT INTO public.academy_lessons (
  id, module_id, title, description, content_markdown, video_url, resource_url,
  resource_label, order_index, estimated_minutes, is_required, is_published
)
SELECT md5(cm.program_id::text || ':' || l.id::text)::uuid, cm.id, l.title, l.description,
       l.content_markdown, l.video_url, l.resource_url, l.resource_label,
       l.order_index, l.estimated_minutes, l.is_required, true
FROM public.academy_modules cm
JOIN public.academy_modules src ON src.program_id = (SELECT d.id FROM public.academy_programs d WHERE d.is_default LIMIT 1)
JOIN public.academy_lessons l ON l.module_id = src.id
WHERE cm.id = md5(cm.program_id::text || ':' || src.id::text)::uuid
ON CONFLICT (id) DO NOTHING;

-- Module checkpoint quizzes: same question draw, bound to the copied module.
INSERT INTO public.academy_exams (
  id, program_id, module_id, title, description, kind, pass_mark, time_limit_minutes,
  max_attempts, is_published, draw_stage, draw_module_codes, draw_count
)
SELECT md5('exam:' || cm.program_id::text || ':' || e.id::text)::uuid, cm.program_id, cm.id,
       e.title, e.description, e.kind, e.pass_mark, e.time_limit_minutes,
       e.max_attempts, true, e.draw_stage, e.draw_module_codes, e.draw_count
FROM public.academy_modules cm
JOIN public.academy_modules src ON src.program_id = (SELECT d.id FROM public.academy_programs d WHERE d.is_default LIMIT 1)
JOIN public.academy_exams e ON e.module_id = src.id
WHERE cm.id = md5(cm.program_id::text || ':' || src.id::text)::uuid
ON CONFLICT (id) DO NOTHING;

-- Windows for every published exam that has none (default: open now, close in a year).
UPDATE public.academy_exams
SET opens_at  = COALESCE(opens_at,  now()),
    closes_at = COALESCE(closes_at, COALESCE(opens_at, now()) + interval '1 year'),
    updated_at = now()
WHERE is_published
  AND (opens_at IS NULL OR closes_at IS NULL);
