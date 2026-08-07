-- LR-006: versioned lab-result amendments (§4.8 / clinical governance).
--
-- A released lab result later found to be wrong must be re-issued as a NEW
-- version — the prior row is RETAINED, immutable, and marked superseded; a fresh
-- row carries the correction. This is the never-destructive amendment pattern
-- already used for triage clinical content, applied to results.
--
-- ADDITIVE-ONLY: every column is nullable or defaulted, so existing rows are
-- untouched — `version` defaults to 1 and `superseded_by` stays NULL, which means
-- every result already in the table is, correctly, the current (latest) version.
-- No DROP, no rename, no type narrowing.

ALTER TABLE public.lab_results
  ADD COLUMN IF NOT EXISTS version int NOT NULL DEFAULT 1;

-- superseded_by points from an OLD version to the version that replaced it. NULL =
-- this row is the current/latest version for its (order_id, test_id). Self-FK.
ALTER TABLE public.lab_results
  ADD COLUMN IF NOT EXISTS superseded_by uuid REFERENCES public.lab_results(id) ON DELETE SET NULL;

-- Amendment provenance (HL-12): who corrected the result, when, and why.
ALTER TABLE public.lab_results
  ADD COLUMN IF NOT EXISTS amended_by uuid REFERENCES auth.users(id) ON DELETE SET NULL;
ALTER TABLE public.lab_results
  ADD COLUMN IF NOT EXISTS amended_at timestamptz;
ALTER TABLE public.lab_results
  ADD COLUMN IF NOT EXISTS amendment_reason text NOT NULL DEFAULT '';

-- The result read and the amend supersede-lookup both fetch the CURRENT version for
-- an (order, test); index the current rows for that access path.
CREATE INDEX IF NOT EXISTS idx_lab_results_current
  ON public.lab_results (order_id, test_id)
  WHERE superseded_by IS NULL;
