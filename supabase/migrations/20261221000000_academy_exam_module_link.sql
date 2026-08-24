-- Link a quiz to the module it assesses.
--
-- academy_exams hangs off program_id only, so a programme could carry one final
-- exam but never a per-module quiz. A tiered pathway needs both: a short quiz at
-- the end of each module, and a tier assessment across several modules.
--
-- Additive and nullable by design: every existing exam keeps module_id NULL and
-- continues to behave as a programme-level assessment. Nothing is dropped,
-- renamed or narrowed.
-- ADR-PR<pr-number>

ALTER TABLE public.academy_exams
  ADD COLUMN IF NOT EXISTS module_id uuid
  REFERENCES public.academy_modules(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.academy_exams.module_id IS
  'Module this quiz assesses. NULL = a programme-level assessment (tier test or final).';

CREATE INDEX IF NOT EXISTS idx_academy_exams_module_id
  ON public.academy_exams(module_id)
  WHERE module_id IS NOT NULL;
